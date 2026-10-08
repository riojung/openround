import {
  AuthoringJobSchema,
  RecoveryPackContentSchema,
  RecoveryPackSourceProposalSchema,
  RecoveryPackSourceReviewSchema,
  authoringDraftContentHash,
  recoveryPackContentHash,
  type AuthoringJob,
  type RecoveryPackDraft,
} from "@openround/contracts";
import { ApiClientError, apiFetch, humanError } from "./api";
import { clientUuid } from "./uuid";

export interface RecoveryPackRecord {
  id: string;
  title: string;
  draft: RecoveryPackDraft;
  draftRevision: number;
  currentVersionId: string | null;
  publishedDraftRevision: number | null;
  sourceReview?: ReturnType<typeof RecoveryPackSourceReviewSchema.parse>;
}
export type RecoveryPackSourceProposal = ReturnType<typeof RecoveryPackSourceProposalSchema.parse>;

export function newRecoveryPackInterventionCard(pack: RecoveryPackRecord, id: string) {
  return {
    id,
    title: "",
    body: "",
    citations: pack.sourceReview ? structuredClone(pack.draft.citations.slice(0, 5)) : [],
  };
}

/** Parsing may normalize strings/defaults, but must never hide an unreviewed field. */
function rejectUnknownFields(raw: unknown, parsed: unknown) {
  if (Array.isArray(raw) && Array.isArray(parsed)) {
    raw.forEach((value, index) => rejectUnknownFields(value, parsed[index]));
  } else if (raw && parsed && typeof raw === "object" && typeof parsed === "object") {
    for (const [key, value] of Object.entries(raw)) {
      if (!Object.hasOwn(parsed, key))
        throw new Error(
          "The source proposal contains an unknown field. Reload the source proposal.",
        );
      rejectUnknownFields(value, (parsed as Record<string, unknown>)[key]);
    }
  }
}

function sourceCitationGroups(draft: RecoveryPackDraft) {
  return [
    draft.citations,
    draft.diagnostic.sourceCitations ?? [],
    draft.recheck.sourceCitations ?? [],
    ...draft.interventions.map((card) => card.citations),
    ...(draft.delayedProbe ? [draft.delayedProbe.sourceCitations ?? []] : []),
  ];
}

function validateSourcePackReceipt(pack: RecoveryPackRecord) {
  const draft = RecoveryPackContentSchema.parse(pack.draft);
  const review = RecoveryPackSourceReviewSchema.parse(pack.sourceReview);
  rejectUnknownFields(pack.draft, draft);
  rejectUnknownFields(pack.sourceReview, review);
  const allowed = new Set([
    "id",
    "workspaceId",
    "title",
    "description",
    "draft",
    "draftRevision",
    "draftSchemaVersion",
    "currentVersionId",
    "publishedDraftRevision",
    "lastEditedBy",
    "createdAt",
    "updatedAt",
    "sourceReview",
  ]);
  if (Object.keys(pack).some((key) => !allowed.has(key)))
    throw new Error("The source Pack response contains an unknown field. Reload the saved Pack.");
  return { draft, review };
}

export function recoveryPackSourceGeneration(job: AuthoringJob) {
  return `${job.id}:${job.status}:${JSON.stringify(job.output)}`;
}

export function validateRecoveryPackSourceProposal(raw: unknown, job: AuthoringJob) {
  const ready = AuthoringJobSchema.safeParse(job);
  const parsed = RecoveryPackSourceProposalSchema.safeParse(raw);
  if (!ready.success || ready.data.status !== "ready" || !ready.data.output || !parsed.success)
    throw new Error("A valid ready source proposal is required. Reload the source proposal.");
  rejectUnknownFields(job.output, ready.data.output);
  rejectUnknownFields(raw, parsed.data);
  const proposal = parsed.data;
  if (
    proposal.authoringJobId !== ready.data.id ||
    proposal.sourceName !== ready.data.sourceName ||
    proposal.sourceName !== ready.data.output.sourceName ||
    proposal.sourceDigest !== ready.data.output.sourceDigest ||
    proposal.sourceOutputHash !== authoringDraftContentHash(ready.data.output) ||
    proposal.contentHash !== recoveryPackContentHash(proposal.draft)
  )
    throw new Error(
      "The Pack proposal does not match this source and content hash. Reload the source proposal.",
    );
  const groups = sourceCitationGroups(proposal.draft);
  const citations = groups.flat();
  const originalSpans = new Set(
    [
      ...ready.data.output.citations,
      ...(ready.data.output.contentSlideProposals ?? []).flatMap((card) => card.citations),
    ].map((citation) => JSON.stringify([citation.locator, citation.excerpt])),
  );
  if (
    groups.some((group) => !group.length) ||
    citations.some(
      (citation) =>
        citation.sourceName !== proposal.sourceName ||
        citation.sourceDigest !== proposal.sourceDigest ||
        !originalSpans.has(JSON.stringify([citation.locator, citation.excerpt])),
    )
  )
    throw new Error(
      "The Pack citations do not match the reviewed source. Reload the source proposal.",
    );
  return proposal;
}

export function recoveryPackSourceApproved(pack: RecoveryPackRecord) {
  if (!pack.sourceReview) return true;
  const review = RecoveryPackSourceReviewSchema.safeParse(pack.sourceReview);
  const content = RecoveryPackContentSchema.safeParse(pack.draft);
  if (!review.success || !content.success) return false;
  try {
    rejectUnknownFields(pack.draft, content.data);
  } catch {
    return false;
  }
  if (
    sourceCitationGroups(content.data).some(
      (group) =>
        !group.length ||
        group.some(
          (citation) =>
            citation.sourceName !== review.data.sourceName ||
            citation.sourceDigest !== review.data.sourceDigest,
        ),
    )
  )
    return false;
  const hash = recoveryPackContentHash(content.data);
  return (
    review.data.approved &&
    review.data.contentHash === hash &&
    review.data.approvedContentHash === hash &&
    review.data.approvedDraftRevision === pack.draftRevision &&
    Boolean(review.data.approvedAt)
  );
}

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
export interface PackSourceAuthoringState {
  proposal: RecoveryPackSourceProposal | null;
  busy: "preview" | "create" | null;
  error: string;
  status: string;
}

export function createRecoveryPackSourceAuthoring({
  job,
  canCreate,
  beforeCreate,
  onCreated,
  onState,
  request = apiFetch,
}: {
  job: AuthoringJob;
  canCreate: () => boolean;
  beforeCreate: () => boolean;
  onCreated: (pack: RecoveryPackRecord) => void;
  onState: (state: PackSourceAuthoringState) => void;
  request?: Request;
}) {
  const source = structuredClone(job);
  let generation = 0;
  let cancelled = false;
  let controller: AbortController | null = null;
  let retryBody: string | null = null;
  let retryKey: string | null = null;
  let state: PackSourceAuthoringState = { proposal: null, busy: null, error: "", status: "" };
  const publish = (next: PackSourceAuthoringState) => {
    state = next;
    onState(next);
  };
  const begin = () => {
    controller?.abort();
    controller = new AbortController();
    return { captured: ++generation, signal: controller.signal };
  };
  const current = (captured: number, signal: AbortSignal) =>
    !cancelled && captured === generation && !signal.aborted;
  return {
    state: () => state,
    cancel() {
      cancelled = true;
      generation += 1;
      controller?.abort();
    },
    async preview() {
      if (cancelled || state.busy) return;
      const { captured, signal } = begin();
      publish({
        proposal: null,
        busy: "preview",
        error: "",
        status: "Loading the source Pack proposal…",
      });
      try {
        const result = await request<{ proposal: unknown }>(
          `/v1/authoring/jobs/${encodeURIComponent(source.id)}/recovery-pack-proposal`,
          { signal },
        );
        if (!current(captured, signal)) return;
        rejectUnknownFields(result, { proposal: result.proposal });
        const proposal = validateRecoveryPackSourceProposal(result.proposal, source);
        if (retryKey && retryKey !== `${proposal.sourceOutputHash}:${proposal.contentHash}`) {
          retryBody = null;
          retryKey = null;
        }
        publish({
          proposal,
          busy: null,
          error: "",
          status:
            "Source Pack proposal ready. Create a draft to edit and review its content and citations.",
        });
      } catch (error) {
        if (current(captured, signal))
          publish({ proposal: null, busy: null, error: humanError(error), status: "" });
      }
    },
    async create() {
      if (cancelled || state.busy || !state.proposal || !canCreate() || !beforeCreate()) return;
      const proposal = state.proposal;
      const { captured, signal } = begin();
      retryBody ??= JSON.stringify({
        draft: proposal.draft,
        sourceOutputHash: proposal.sourceOutputHash,
        expectedContentHash: proposal.contentHash,
        mutationId: clientUuid(),
      });
      retryKey = `${proposal.sourceOutputHash}:${proposal.contentHash}`;
      publish({
        ...state,
        busy: "create",
        error: "",
        status: "Creating an unpublished Pack draft…",
      });
      try {
        const result = await request<{ pack: RecoveryPackRecord }>(
          `/v1/authoring/jobs/${encodeURIComponent(source.id)}/apply-recovery-pack`,
          { method: "POST", body: retryBody, signal },
        );
        if (!current(captured, signal) || !canCreate()) return;
        rejectUnknownFields(result, { pack: result.pack });
        const { pack } = result;
        validateSourcePackReceipt(pack);
        if (
          pack.currentVersionId ||
          !pack.sourceReview ||
          !RecoveryPackSourceReviewSchema.safeParse(pack.sourceReview).success ||
          !RecoveryPackSourceReviewSchema.shape.authoringJobId.safeParse(pack.id).success ||
          !Number.isInteger(pack.draftRevision) ||
          pack.draftRevision < 0 ||
          pack.sourceReview.authoringJobId !== proposal.authoringJobId ||
          pack.sourceReview.sourceName !== proposal.sourceName ||
          pack.sourceReview.sourceDigest !== proposal.sourceDigest ||
          pack.sourceReview.sourceOutputHash !== proposal.sourceOutputHash ||
          pack.sourceReview.contentHash !== proposal.contentHash ||
          pack.title !== proposal.draft.title ||
          pack.publishedDraftRevision !== null ||
          recoveryPackContentHash(pack.draft) !== proposal.contentHash ||
          pack.sourceReview.approved
        )
          throw new Error(
            "The created draft does not match the reviewed source. Reload your Packs before retrying.",
          );
        retryBody = null;
        retryKey = null;
        publish({
          ...state,
          busy: null,
          error: "",
          status:
            "Unpublished Pack draft created. Review and approve saved content and citations before publishing.",
        });
        onCreated(pack);
      } catch (error) {
        if (current(captured, signal)) {
          if (error instanceof ApiClientError && error.status === 409) {
            retryBody = null;
            retryKey = null;
          }
          publish({
            ...state,
            busy: null,
            error: humanError(error),
            status:
              "Creation was not confirmed. Retry with the same reviewed proposal or reload your Packs.",
          });
        }
      } finally {
        if (current(captured, signal) && state.busy) publish({ ...state, busy: null });
      }
    },
  };
}

/** A request identity is retained after a lost acknowledgement, and cancelled by any edit/adoption. */
export function createRecoveryPackSourceApproval({
  pack,
  canApprove,
  request = apiFetch,
}: {
  pack: RecoveryPackRecord;
  canApprove: () => boolean;
  request?: Request;
}) {
  const source = structuredClone(pack);
  const { review } = validateSourcePackReceipt(source);
  const hash = recoveryPackContentHash(source.draft);
  if (review.contentHash !== hash)
    throw new Error("The saved content hash has changed. Reload the saved Pack before approving.");
  const body = JSON.stringify({
    expectedDraftRevision: source.draftRevision,
    expectedContentHash: hash,
    sourceDigest: review.sourceDigest,
    sourceOutputHash: review.sourceOutputHash,
    mutationId: clientUuid(),
    approveContent: true,
    approveCitations: true,
  });
  let running = false;
  let cancelled = false;
  const controller = new AbortController();
  return {
    cancel() {
      cancelled = true;
      controller.abort();
    },
    async approve() {
      if (cancelled || running || !canApprove()) return null;
      running = true;
      try {
        const result = await request<{ pack: RecoveryPackRecord }>(
          `/v1/recovery-packs/${encodeURIComponent(source.id)}/source-review`,
          { method: "POST", body, signal: controller.signal },
        );
        if (cancelled || !canApprove()) return null;
        rejectUnknownFields(result, { pack: result.pack });
        validateSourcePackReceipt(result.pack);
        if (
          result.pack.id !== source.id ||
          result.pack.draftRevision !== source.draftRevision ||
          result.pack.sourceReview?.sourceDigest !== review.sourceDigest ||
          result.pack.sourceReview?.sourceOutputHash !== review.sourceOutputHash ||
          result.pack.sourceReview?.authoringJobId !== review.authoringJobId ||
          result.pack.sourceReview?.sourceName !== review.sourceName ||
          recoveryPackContentHash(result.pack.draft) !== hash ||
          !recoveryPackSourceApproved(result.pack)
        )
          throw new Error(
            "The approval does not match the saved Pack revision and source. Reload the saved Pack.",
          );
        return result.pack;
      } finally {
        running = false;
      }
    },
  };
}

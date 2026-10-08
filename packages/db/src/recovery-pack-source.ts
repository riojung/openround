import { createHash } from "node:crypto";
import {
  RecoveryPackContentSchema,
  RecoveryPackSourceReviewSchema,
  SourceCitationSchema,
  recoveryPackContentHash,
  type RecoveryPackContent,
  type RecoveryPackDraft,
  type SourceCitation,
} from "@openround/contracts";
import {
  RecoveryPackSourceCitationValidationError,
  RecoveryPackSourceReviewConflictError,
  RecoveryPackSourceReviewRequiredError,
  type RecoveryPackRecord,
  type RecoveryPackSourceApproval,
  type RecoveryPackSourceProvenance,
} from "./recovery-pack-types.js";

export interface RecoveryPackSourceRecord extends RecoveryPackSourceProvenance {
  workspaceId: string;
  packId: string;
  creationMutationId: string;
  creationRequestHash: string;
  approvedContentHash: string | null;
  approvedDraftRevision: number | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  createdAt: Date;
}

export interface RecoveryPackSourceApprovalReceipt {
  workspaceId: string;
  packId: string;
  requestHash: string;
  createdAt: Date;
}

function citationKey(citation: SourceCitation) {
  return JSON.stringify([
    citation.sourceName,
    citation.sourceDigest,
    citation.locator,
    citation.excerpt,
  ]);
}

export function assertSourceProvenance(input: RecoveryPackSourceProvenance) {
  RecoveryPackSourceReviewSchema.omit({
    schemaVersion: true,
    contentHash: true,
    approvedContentHash: true,
    approvedDraftRevision: true,
    approvedAt: true,
    approved: true,
  })
    .strict()
    .parse({
      authoringJobId: input.authoringJobId,
      sourceName: input.sourceName,
      sourceDigest: input.sourceDigest,
      sourceOutputHash: input.sourceOutputHash,
    });
  if (input.citationCatalog.length < 1 || input.citationCatalog.length > 100)
    throw new RecoveryPackSourceCitationValidationError(
      "Source citation catalog must contain 1 to 100 spans",
    );
  for (const citation of input.citationCatalog) {
    const parsed = SourceCitationSchema.strict().parse(citation);
    if (
      citationKey(parsed) !== citationKey(citation) ||
      parsed.sourceName !== input.sourceName ||
      parsed.sourceDigest !== input.sourceDigest
    )
      throw new RecoveryPackSourceCitationValidationError(
        "Citation catalog must preserve the original source name and digest",
      );
  }
}

export function assertSourceCitations(
  content: RecoveryPackContent,
  source: RecoveryPackSourceProvenance,
) {
  const catalog = new Set(source.citationCatalog.map(citationKey));
  const groups = [
    content.citations,
    content.diagnostic.sourceCitations ?? [],
    content.recheck.sourceCitations ?? [],
    ...content.interventions.map((card) => card.citations),
    ...(content.delayedProbe ? [content.delayedProbe.sourceCitations ?? []] : []),
  ];
  for (const citations of groups) {
    if (!citations.length) throw new RecoveryPackSourceCitationValidationError();
    for (const citation of citations) {
      if (
        citation.sourceName !== source.sourceName ||
        citation.sourceDigest !== source.sourceDigest ||
        !catalog.has(citationKey(citation))
      )
        throw new RecoveryPackSourceCitationValidationError(
          "A Recovery Pack citation does not match an original source span",
        );
    }
  }
}

export function validRecoveryPackContentHash(draft: RecoveryPackDraft) {
  const parsed = RecoveryPackContentSchema.safeParse(draft);
  return parsed.success ? recoveryPackContentHash(parsed.data) : null;
}

export function withRecoveryPackSourceReview(
  pack: RecoveryPackRecord,
  source?: RecoveryPackSourceRecord,
): RecoveryPackRecord {
  // Record callers cannot install source review metadata through ordinary creation or edits.
  const plain = { ...pack };
  delete plain.sourceReview;
  if (!source) return plain;
  const contentHash = validRecoveryPackContentHash(pack.draft);
  return {
    ...plain,
    sourceReview: RecoveryPackSourceReviewSchema.parse({
      schemaVersion: 1,
      authoringJobId: source.authoringJobId,
      sourceName: source.sourceName,
      sourceDigest: source.sourceDigest,
      sourceOutputHash: source.sourceOutputHash,
      contentHash,
      approvedContentHash: source.approvedContentHash,
      approvedDraftRevision: source.approvedDraftRevision,
      approvedAt: source.approvedAt?.toISOString() ?? null,
      approved:
        contentHash !== null &&
        contentHash === source.approvedContentHash &&
        pack.draftRevision === source.approvedDraftRevision,
    }),
  };
}

export function sourceApprovalRequestHash(input: RecoveryPackSourceApproval) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        workspaceId: input.workspaceId,
        packId: input.packId,
        editorId: input.editorId,
        expectedDraftRevision: input.expectedDraftRevision,
        expectedContentHash: input.expectedContentHash,
        sourceDigest: input.sourceDigest,
        sourceOutputHash: input.sourceOutputHash,
        approveContent: true,
        approveCitations: true,
      }),
    )
    .digest("hex");
}

export function assertSourceApproval(
  pack: RecoveryPackRecord,
  source: RecoveryPackSourceRecord | undefined,
  input: RecoveryPackSourceApproval,
) {
  if (
    !source ||
    source.sourceDigest !== input.sourceDigest ||
    source.sourceOutputHash !== input.sourceOutputHash ||
    validRecoveryPackContentHash(pack.draft) !== input.expectedContentHash
  )
    throw new RecoveryPackSourceReviewConflictError();
  assertSourceCitations(RecoveryPackContentSchema.parse(pack.draft), source);
}

export function assertSourcePublish(
  pack: RecoveryPackRecord,
  source: RecoveryPackSourceRecord | undefined,
  content: RecoveryPackContent,
  contentHash: string,
) {
  if (!source) return;
  const reviewed = withRecoveryPackSourceReview(pack, source).sourceReview!;
  if (
    !reviewed.approved ||
    recoveryPackContentHash(content) !== reviewed.contentHash ||
    contentHash !== reviewed.contentHash
  )
    throw new RecoveryPackSourceReviewRequiredError();
  assertSourceCitations(content, source);
}

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { z } from "zod";
import {
  QuestionDraftSchema,
  QuizDraftSchema,
  RecoveryPackContentSchema,
  RecoveryPackUpdateChoiceSchema,
  RecoveryPackUpdatePreviewSchema,
  normalizeDecimalString,
  recoveryPackContentHash,
  type QuestionDraft,
  type QuizDraft,
  type RecoveryPackContent,
  type RecoveryPackInsertion,
  type RecoveryPackUpdateChoice,
  type RecoveryPackUpdatePreview,
  type RecoveryPackUpdateRole,
} from "./index";

export interface RecoveryPackUpdateTarget {
  id: string;
  version: number;
  content: RecoveryPackContent;
}
export type RecoveryPackUpdateComparison = Omit<
  RecoveryPackUpdatePreview,
  "quizId" | "draftRevision"
>;
export type RecoveryPackUpdateErrorCode =
  | "INSERTION_NOT_FOUND"
  | "INVALID_INSERTION"
  | "TARGET_MISMATCH"
  | "REVIEW_STALE"
  | "INVALID_CHOICES"
  | "CONFLICT_CHOICE_REQUIRED"
  | "INVALID_LINKED_PAIR"
  | "QUESTION_CAPACITY_EXCEEDED";

export class RecoveryPackUpdateError extends Error {
  constructor(
    public readonly code: RecoveryPackUpdateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RecoveryPackUpdateError";
  }
}

const roles = ["diagnostic", "recheck"] as const;
const TargetSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  content: z.lazy(() => RecoveryPackContentSchema),
});
// The package entry point re-exports these helpers. Defer entry-point schema reads until calls,
// rather than evaluating them while the entry point's own schemas are still initializing.
const ComparisonSchema = z.lazy(() =>
  RecoveryPackUpdatePreviewSchema.omit({
    quizId: true,
    draftRevision: true,
  }),
);
const ChoicesSchema = z
  .array(z.lazy(() => RecoveryPackUpdateChoiceSchema))
  .max(2)
  .refine((choices) => new Set(choices.map((choice) => choice.role)).size === choices.length);

function hash(value: unknown) {
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value))));
}

function destinationId(insertion: RecoveryPackInsertion, role: RecoveryPackUpdateRole) {
  return role === "diagnostic" ? insertion.diagnosticQuestionId : insertion.recheckQuestionId;
}

function decimal(value: string) {
  try {
    return normalizeDecimalString(value);
  } catch {
    return value;
  }
}

function semanticValue(value: unknown): string {
  const sorted = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sorted);
    if (item !== null && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, child]) => [key, sorted(child)]),
      );
    return item;
  };
  return JSON.stringify(sorted(value));
}

/** IDs are copy-local, but changing delivery or the linked role is a real local edit. */
function semanticQuestion(
  question: QuestionDraft,
  roleIds: { diagnostic: string; recheck: string },
) {
  const parsed = QuestionDraftSchema.parse(question);
  const fields = Object.fromEntries(
    Object.entries(parsed).filter(([key]) => key !== "id" && key !== "recoveryPackSource"),
  );
  const linked = parsed.linkedRecheckQuestionId;
  return {
    ...fields,
    purpose:
      parsed.purpose ??
      (parsed.type === "poll" || parsed.type === "rating" ? "opinion" : "diagnostic"),
    confidence: parsed.confidence ?? "off",
    delivery: parsed.delivery ?? "main",
    conceptKeys: parsed.conceptKeys ?? [],
    sourceCitations: parsed.sourceCitations ?? [],
    linkedRecheckQuestionId: !linked
      ? null
      : linked === roleIds.recheck
        ? "role:recheck"
        : linked === roleIds.diagnostic
          ? "role:diagnostic"
          : `question:${linked}`,
    ...("choices" in parsed
      ? {
          choices: parsed.choices.map((choice) => ({
            label: choice.label,
            isCorrect: choice.isCorrect,
            feedback: choice.feedback ?? "",
            misconceptionKey: choice.misconceptionKey ?? null,
          })),
        }
      : {}),
    ...(parsed.type === "numeric"
      ? { correctValue: decimal(parsed.correctValue), tolerance: decimal(parsed.tolerance) }
      : {}),
  };
}

/** Stable comparable JSON for authoring diffs; copy IDs/provenance are not learner content. */
export function recoveryPackQuestionSemanticValue(
  question: QuestionDraft,
  roleIds: { diagnostic: string; recheck: string },
): string {
  return semanticValue(semanticQuestion(question, roleIds));
}

function context(content: RecoveryPackContent) {
  return {
    title: content.title,
    description: content.description,
    interventions: content.interventions.map((card) => ({
      title: card.title,
      body: card.body,
      citations: card.citations,
    })),
    delayedProbe: content.delayedProbe
      ? semanticQuestion(content.delayedProbe, {
          diagnostic: content.diagnostic.id,
          recheck: content.recheck.id,
        })
      : null,
    conceptKeys: content.conceptKeys,
    misconceptionKeys: content.misconceptionKeys,
    citations: content.citations,
  };
}

function resolveInsertion(draft: QuizDraft, requested: RecoveryPackInsertion) {
  const matches = (draft.recoveryPackInsertions ?? []).filter((item) => item.id === requested.id);
  if (matches.length === 0)
    throw new RecoveryPackUpdateError(
      "INSERTION_NOT_FOUND",
      "This Pack insertion is no longer in the Round",
    );
  const insertion = matches[0]!;
  if (matches.length !== 1 || insertion.diagnosticQuestionId === insertion.recheckQuestionId)
    throw new RecoveryPackUpdateError(
      "INVALID_INSERTION",
      "Pack insertion IDs must identify distinct copies",
    );
  const ids = draft.questions.map((question) => question.id);
  if (new Set(ids).size !== ids.length)
    throw new RecoveryPackUpdateError(
      "INVALID_INSERTION",
      "Checkpoint IDs must be unique before applying a Pack update",
    );
  for (const other of draft.recoveryPackInsertions ?? []) {
    if (other.id === insertion.id) continue;
    if (
      [other.diagnosticQuestionId, other.recheckQuestionId].some(
        (id) => id === insertion.diagnosticQuestionId || id === insertion.recheckQuestionId,
      )
    )
      throw new RecoveryPackUpdateError(
        "INVALID_INSERTION",
        "A checkpoint cannot belong to multiple Pack insertions",
      );
  }
  return insertion;
}

/** Source versions are selected by the server; this helper does not authenticate a source Pack. */
export function buildRecoveryPackUpdatePreview(
  draftInput: QuizDraft,
  insertionInput: RecoveryPackInsertion,
  targetInput: RecoveryPackUpdateTarget,
): RecoveryPackUpdateComparison {
  const draft = QuizDraftSchema.parse(draftInput);
  const insertion = resolveInsertion(draft, insertionInput);
  const target = TargetSchema.parse(targetInput);
  const baseline = insertion.updateBaseline?.content ?? insertion.originalContent;
  const baselineVersionId = insertion.updateBaseline?.packVersionId ?? insertion.packVersionId;
  const baselineVersion = insertion.updateBaseline?.packVersion ?? insertion.packVersion;
  const baselineHash = insertion.updateBaseline?.contentHash ?? insertion.contentHash;
  // Version numbers record creation order, not publication order: republishing identical
  // restored content legitimately selects an older immutable version through hash deduplication.
  if (
    (target.version === baselineVersion && target.id !== baselineVersionId) ||
    (target.id === baselineVersionId &&
      (target.version !== baselineVersion ||
        recoveryPackContentHash(target.content) !== baselineHash))
  )
    throw new RecoveryPackUpdateError(
      "TARGET_MISMATCH",
      "The reviewed Pack version has inconsistent immutable identity or content",
    );
  const baselineIds = { diagnostic: baseline.diagnostic.id, recheck: baseline.recheck.id };
  const localIds = {
    diagnostic: insertion.diagnosticQuestionId,
    recheck: insertion.recheckQuestionId,
  };
  const latestIds = {
    diagnostic: target.content.diagnostic.id,
    recheck: target.content.recheck.id,
  };
  const items = roles.map((role) => {
    const questionId = destinationId(insertion, role);
    const local = draft.questions.find((question) => question.id === questionId) ?? null;
    const baselineItem = baseline[role];
    const latest = target.content[role];
    const baseValue = recoveryPackQuestionSemanticValue(baselineItem, baselineIds);
    const latestValue = recoveryPackQuestionSemanticValue(latest, latestIds);
    const localValue = local ? recoveryPackQuestionSemanticValue(local, localIds) : null;
    const status =
      localValue === null
        ? "conflict"
        : localValue === latestValue
          ? "unchanged"
          : localValue === baseValue
            ? "source_changed"
            : latestValue === baseValue
              ? "local_changed"
              : "conflict";
    return { role, questionId, status, baseline: baselineItem, local, latest };
  });
  return ComparisonSchema.parse({
    insertionId: insertion.id,
    baselineVersionId,
    baselineVersion,
    latestVersionId: target.id,
    latestVersion: target.version,
    baselineContent: baseline,
    latestContent: target.content,
    items,
    contextChanged: semanticValue(context(baseline)) !== semanticValue(context(target.content)),
  });
}

function replacement(
  source: QuestionDraft,
  role: RecoveryPackUpdateRole,
  insertion: RecoveryPackInsertion,
  target: RecoveryPackUpdateTarget,
): QuestionDraft {
  const id = destinationId(insertion, role);
  const result = structuredClone(source);
  result.id = id;
  result.linkedRecheckQuestionId = role === "diagnostic" ? insertion.recheckQuestionId : null;
  result.recoveryPackSource = {
    artifactType: "recovery_pack",
    packId: insertion.packId,
    packVersionId: target.id,
    packVersion: target.version,
    sourceItemId: source.id,
    role,
    contentHash: hash(source),
  };
  if ("choices" in result)
    result.choices = result.choices.map((choice) => {
      const chars = hash(`${id}:${target.id}:${choice.id}`).slice(0, 32).split("");
      chars[12] = "5";
      chars[16] = (8 + (parseInt(chars[16]!, 16) & 3)).toString(16);
      const value = chars.join("");
      return {
        ...choice,
        id: `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`,
      };
    });
  return result;
}

/** Explain choices that would replace or restore a checkpoint without its linked counterpart. */
export function recoveryPackUpdateLinkIssue(
  preview: RecoveryPackUpdateComparison,
  choices: RecoveryPackUpdateChoice[],
): string | null {
  const actions = new Map(choices.map((choice) => [choice.role, choice.action]));
  for (const item of preview.items) {
    if (!actions.has(item.role)) {
      if (item.status === "conflict") return null; // The explicit-choice guard handles this first.
      actions.set(item.role, item.status === "source_changed" ? "use_latest" : "keep_local");
    }
  }
  // Context-only acceptance must not silently repair a deliberately unfinished local draft.
  if (![...actions.values()].includes("use_latest")) return null;
  const diagnostic = preview.items.find((item) => item.role === "diagnostic")!;
  const recheck = preview.items.find((item) => item.role === "recheck")!;
  const diagnosticExists = actions.get("diagnostic") === "use_latest" || diagnostic.local;
  if (!diagnosticExists)
    return "Restore the diagnostic too, or keep the recheck deleted. A restored recheck needs its linked diagnostic.";
  const recheckExists = actions.get("recheck") === "use_latest" || recheck.local;
  if (!recheckExists)
    return "Restore the recheck too, or keep the local diagnostic. The published diagnostic links to this recheck.";
  if (
    actions.get("diagnostic") !== "use_latest" &&
    diagnostic.local?.linkedRecheckQuestionId !== recheck.questionId
  )
    return "Choose the latest published diagnostic too, or repair its recheck link in the Round and review again. Keeping the unlinked local diagnostic would orphan the restored recheck.";
  if (actions.get("recheck") !== "use_latest" && (recheck.local?.delivery ?? "main") !== "recheck")
    return "Choose the latest published recheck too, or repair its delivery in the Round and review again. The diagnostic must link to a recheck checkpoint.";
  return null;
}

/** Apply only an exact current comparison; no client-supplied question content is trusted. */
export function applyRecoveryPackUpdate(
  draftInput: QuizDraft,
  previewInput: RecoveryPackUpdateComparison,
  targetInput: RecoveryPackUpdateTarget,
  choiceInput: RecoveryPackUpdateChoice[],
): QuizDraft {
  const draft = QuizDraftSchema.parse(draftInput);
  const insertion = (draft.recoveryPackInsertions ?? []).find(
    (item) => item.id === previewInput.insertionId,
  );
  if (!insertion)
    throw new RecoveryPackUpdateError(
      "INSERTION_NOT_FOUND",
      "This Pack insertion is no longer in the Round",
    );
  const target = TargetSchema.parse(targetInput);
  const preview = ComparisonSchema.parse(previewInput);
  const current = buildRecoveryPackUpdatePreview(draft, insertion, target);
  if (JSON.stringify(preview) !== JSON.stringify(current))
    throw new RecoveryPackUpdateError(
      "REVIEW_STALE",
      "This Round or Pack changed since its update review",
    );
  const choices = ChoicesSchema.safeParse(choiceInput);
  if (!choices.success)
    throw new RecoveryPackUpdateError(
      "INVALID_CHOICES",
      "Choose one valid action per question role",
    );
  const actions = new Map(choices.data.map((choice) => [choice.role, choice.action]));
  for (const item of current.items) {
    if (item.status === "conflict" && !actions.has(item.role))
      throw new RecoveryPackUpdateError(
        "CONFLICT_CHOICE_REQUIRED",
        "Choose whether to keep or replace every conflicting or deleted checkpoint",
      );
    if (!actions.has(item.role))
      actions.set(item.role, item.status === "source_changed" ? "use_latest" : "keep_local");
  }
  const result = structuredClone(draft);
  for (const role of roles) {
    if (actions.get(role) !== "use_latest") continue;
    const copied = replacement(target.content[role], role, insertion, target);
    const existingIndex = result.questions.findIndex((question) => question.id === copied.id);
    if (existingIndex !== -1) result.questions[existingIndex] = copied;
    else {
      if (result.questions.length >= 200)
        throw new RecoveryPackUpdateError(
          "QUESTION_CAPACITY_EXCEEDED",
          "Remove a checkpoint before restoring a deleted Pack question",
        );
      const siblingId = destinationId(insertion, role === "diagnostic" ? "recheck" : "diagnostic");
      const siblingIndex = result.questions.findIndex((question) => question.id === siblingId);
      result.questions.splice(
        siblingIndex === -1 ? result.questions.length : siblingIndex + (role === "recheck" ? 1 : 0),
        0,
        copied,
      );
    }
  }
  const linkIssue = recoveryPackUpdateLinkIssue(current, choices.data);
  if (linkIssue) throw new RecoveryPackUpdateError("INVALID_LINKED_PAIR", linkIssue);
  if ([...actions.values()].includes("use_latest")) {
    const diagnosticIndex = result.questions.findIndex(
      (question) => question.id === insertion.diagnosticQuestionId,
    );
    const recheckIndex = result.questions.findIndex(
      (question) => question.id === insertion.recheckQuestionId,
    );
    const sources = result.questions.filter(
      (question) => question.linkedRecheckQuestionId === insertion.recheckQuestionId,
    );
    if (
      diagnosticIndex >= recheckIndex ||
      sources.length !== 1 ||
      sources[0]!.id !== insertion.diagnosticQuestionId
    )
      throw new RecoveryPackUpdateError(
        "INVALID_LINKED_PAIR",
        "Place the Pack diagnostic before its recheck and remove any other diagnostic links to that recheck, then review again.",
      );
  }
  result.recoveryPackInsertions = result.recoveryPackInsertions!.map((item) =>
    item.id !== insertion.id
      ? item
      : {
          ...item,
          updateBaseline: {
            packVersionId: target.id,
            packVersion: target.version,
            contentHash: recoveryPackContentHash(target.content),
            content: target.content,
          },
        },
  );
  return QuizDraftSchema.parse(result);
}

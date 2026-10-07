import {
  ProductEventSchema,
  QuestionSchema,
  RecoveryPackPracticeSequenceSchema,
  RecoveryPackPracticeSourceSchema,
  QuizContentSchema,
} from "@openround/contracts";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  RecoveryPackPracticeAssignmentConflictError,
  type AuditEventRecord,
  type FollowupRecord,
  type ProductEventRecord,
  type RecoveryPackPracticeCreationContext,
} from "./types.js";
import type { RecoveryPackVersionRecord } from "./recovery-pack-types.js";

export function assertRecoveryPackPracticeInput(input: FollowupRecord) {
  if (
    input.purpose !== "assignment" ||
    input.sourceQuizVersionId !== null ||
    input.sourceSessionId !== null ||
    input.sourceReportId !== null ||
    input.conceptKeys.length !== 0 ||
    !input.creationMutation
  )
    throw new TypeError("Pack practice requires a frozen Pack assignment and creation receipt");
  const source = RecoveryPackPracticeSourceSchema.parse(input.recoveryPackSource);
  RecoveryPackPracticeSourceSchema.shape.packId.parse(input.creationMutation.mutationId);
  if (!/^[0-9a-f]{64}$/.test(input.creationMutation.requestHash))
    throw new TypeError("Practice request hash must be SHA-256");
  const content = QuizContentSchema.parse(input.content);
  const question = content.questions[0];
  if (source.role === "full_sequence") {
    RecoveryPackPracticeSequenceSchema.parse(input.recoveryPackSequence);
    const recheck = content.questions[1];
    if (
      content.questions.length !== 2 ||
      !question ||
      !recheck ||
      (question.delivery ?? "main") !== "main" ||
      recheck.delivery !== "recheck" ||
      question.linkedRecheckQuestionId !== recheck.id ||
      recheck.linkedRecheckQuestionId ||
      question.recoveryPackSource?.sourceItemId !== source.sourceItemId
    )
      throw new TypeError("Pack sequence requires a diagnostic linked to its copied recheck");
    for (const [index, role] of ["diagnostic", "recheck"].entries()) {
      const provenance = content.questions[index]!.recoveryPackSource;
      if (
        !provenance ||
        provenance.packId !== source.packId ||
        provenance.packVersionId !== source.packVersionId ||
        provenance.packVersion !== source.packVersion ||
        provenance.role !== role
      )
        throw new TypeError("Pack sequence checkpoint provenance must match its frozen source");
    }
    return source;
  }
  if (input.recoveryPackSequence != null)
    throw new TypeError("Delayed-probe practice cannot contain an intervention sequence");
  if (
    content.questions.length !== 1 ||
    !question ||
    (question.delivery ?? "main") !== "main" ||
    question.linkedRecheckQuestionId
  ) {
    throw new TypeError("Pack practice contains exactly one standalone delayed probe");
  }
  const provenance = question.recoveryPackSource;
  if (
    !provenance ||
    provenance.packId !== source.packId ||
    provenance.packVersionId !== source.packVersionId ||
    provenance.packVersion !== source.packVersion ||
    provenance.sourceItemId !== source.sourceItemId ||
    provenance.role !== "delayed_probe"
  ) {
    throw new TypeError("Pack practice checkpoint provenance must match its frozen source");
  }
  return source;
}

/** ID regeneration changes identity, never authored content or answer semantics. */
function semanticQuestion(value: unknown) {
  // Validate the contract, but compare raw stored semantics so unknown fields or whitespace
  // cannot enter frozen memory records when the PostgreSQL JSONB source guard rejects them.
  QuestionSchema.parse(value);
  const question = structuredClone(value) as Record<string, unknown>;
  for (const field of ["id", "delivery", "linkedRecheckQuestionId", "recoveryPackSource"])
    delete question[field];
  if (Array.isArray(question.choices))
    question.choices = question.choices.map((value: Record<string, unknown>) => {
      const choice = { ...value };
      delete choice.id;
      return choice;
    });
  return question;
}

export function assertFollowupAdvanceReceipts(value: Record<string, number> = {}) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Advance receipts must be a bounded UUID-to-version map");
  const entries = Object.entries(value);
  if (entries.length > 256) throw new TypeError("Advance receipts are limited to 256 entries");
  for (const [key, version] of entries) {
    RecoveryPackPracticeSourceSchema.shape.packId.parse(key);
    if (!Number.isInteger(version) || version < 0 || version > 2_147_483_647)
      throw new TypeError("Advance receipt versions must be non-negative integers");
  }
  return value;
}

export function recoveryPackPracticeSourceMatches(
  input: FollowupRecord,
  version: RecoveryPackVersionRecord,
) {
  const source = assertRecoveryPackPracticeInput(input);
  if (!(
    source.packId === version.packId &&
    source.packVersionId === version.id &&
    source.packVersion === version.version &&
    source.contentHash === version.contentHash &&
    source.packTitle === version.content.title &&
    source.publishedAt === version.publishedAt.toISOString()
  ))
    return false;
  if (source.role === "delayed_probe")
    return source.sourceItemId === version.content.delayedProbe?.id;
  if (source.sourceItemId !== version.content.diagnostic.id) return false;
  const sequence = RecoveryPackPracticeSequenceSchema.parse(input.recoveryPackSequence);
  const expected = RecoveryPackPracticeSequenceSchema.parse({
    schemaVersion: 1,
    interventions: version.content.interventions,
    citations: version.content.citations,
  });
  if (JSON.stringify(sequence) !== JSON.stringify(expected)) return false;
  const questions = QuizContentSchema.parse(input.content).questions;
  return (["diagnostic", "recheck"] as const).every((role, index) => {
    const original = QuestionSchema.parse(version.content[role]);
    const copied = questions[index]!;
    return (
      copied.recoveryPackSource?.sourceItemId === original.id &&
      copied.recoveryPackSource.contentHash ===
        createHash("sha256").update(JSON.stringify(original)).digest("hex") &&
      isDeepStrictEqual(
        semanticQuestion(input.content.questions[index]!),
        semanticQuestion(original),
      )
    );
  });
}

export function matchRecoveryPackPracticeReceipt(
  record: FollowupRecord,
  packId: string,
  mutationId: string,
  requestHash: string,
) {
  if (
    record.recoveryPackSource?.packId !== packId ||
    record.creationMutation?.requestHash !== requestHash
  ) {
    throw new RecoveryPackPracticeAssignmentConflictError(mutationId);
  }
  return structuredClone(record);
}

/** Only fixed aggregate evidence belongs to the atomic assignment creation milestone. */
export function recoveryPackPracticeCreationEvidence(
  input: FollowupRecord,
  personalPasses: number,
  context: RecoveryPackPracticeCreationContext,
) {
  const source = assertRecoveryPackPracticeInput(input);
  const audit: AuditEventRecord = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    actorId: input.createdBy,
    action: "recovery_pack.practice_assignment.create",
    targetType: "practice_assignment",
    targetId: input.id,
    requestId: context.requestId,
    createdAt: new Date(input.createdAt),
    metadata: {
      sourcePackId: source.packId,
      sourcePackVersionId: source.packVersionId,
      sourceRole: source.role,
      personalPasses,
      timeMode: input.timeMode,
    },
  };
  const productEvent: ProductEventRecord = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    ...ProductEventSchema.parse({
      name: "practice_assignment_created",
      occurredAt: input.createdAt.toISOString(),
      dimensions: {
        betaVersion: "p0-2026",
        ...(context.segment ? { segment: context.segment } : {}),
      },
    }),
    expiresAt: new Date(input.createdAt.getTime() + 30 * 24 * 60 * 60_000),
    createdAt: new Date(input.createdAt),
  };
  return { audit, productEvent };
}

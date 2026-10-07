import {
  ProductEventSchema,
  RecoveryPackPracticeSourceSchema,
  QuizContentSchema,
} from "@openround/contracts";
import { randomUUID } from "node:crypto";
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

export function recoveryPackPracticeSourceMatches(
  input: FollowupRecord,
  version: RecoveryPackVersionRecord,
) {
  const source = assertRecoveryPackPracticeInput(input);
  return (
    source.packId === version.packId &&
    source.packVersionId === version.id &&
    source.packVersion === version.version &&
    source.contentHash === version.contentHash &&
    source.packTitle === version.content.title &&
    source.publishedAt === version.publishedAt.toISOString() &&
    source.sourceItemId === version.content.delayedProbe?.id
  );
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
      sourceRole: "delayed_probe",
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

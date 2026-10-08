import { PresentationContentSchema, type PresentationCompanionCommand } from "@openround/contracts";
import {
  recoveryPackTextOnlyLiveEligible,
  type PresentationSessionRecord,
  type RecoveryPackVersionRecord,
} from "@openround/db";
import type { AppConfig } from "./config.js";
import { PRESENTATION_PACK_INSERTION_DRAFT_LIMIT } from "./draft-limits.js";
import { recoveryPackCopyId, recoveryPackQuestions } from "./recovery-pack-copies.js";
import { PresentationSessionServiceError } from "./presentation-session-errors.js";
import {
  evidenceWorkspaceFeatureEnabled,
  professionalWorkspaceFeatureEnabled,
} from "./workspace-rollout.js";

export function presentationRecoveryPackLiveInsertionEnabled(
  config: AppConfig,
  workspaceId: string,
) {
  return (
    professionalWorkspaceFeatureEnabled(config, workspaceId, "presentations") &&
    evidenceWorkspaceFeatureEnabled(config, workspaceId, "presentationCompanion") &&
    evidenceWorkspaceFeatureEnabled(config, workspaceId, "recoveryPacks") &&
    evidenceWorkspaceFeatureEnabled(config, workspaceId, "recoveryPackLiveCards")
  );
}

export function presentationCanInsertRecoveryPack(session: PresentationSessionRecord) {
  if (
    session.status !== "active" ||
    !session.recoveryPackCardsEnabled ||
    session.content.blocks.length + 2 > 100 ||
    (session.content.recoveryPackInsertions?.length ?? 0) + 1 > 100
  )
    return false;
  if (session.phase === "lobby") return true;
  const block = session.content.blocks[session.currentBlockIndex];
  if (
    session.phase !== "content" &&
    !(session.phase === "question_reveal" && block?.kind === "question")
  )
    return false;
  const pendingQuestions = new Set(
    session.content.blocks
      .slice(session.currentBlockIndex + 1)
      .filter((item) => item.kind === "question")
      .map((item) => item.question.id),
  );
  // A valid Presentation may put slides or standalone checkpoints between a linked source and
  // its linked recheck. The whole pending pair stays indivisible, not just the current block.
  return !session.content.blocks
    .slice(0, session.currentBlockIndex + 1)
    .some(
      (item) =>
        item.kind === "question" &&
        typeof item.question.linkedRecheckQuestionId === "string" &&
        pendingQuestions.has(item.question.linkedRecheckQuestionId),
    );
}

export function presentationRecoveryPackInsertionTransition(
  session: PresentationSessionRecord,
  version: RecoveryPackVersionRecord,
  input: Extract<PresentationCompanionCommand, { action: "insert_recovery_pack" }>,
) {
  if (!recoveryPackTextOnlyLiveEligible(version.content)) {
    throw new PresentationSessionServiceError(
      422,
      "VALIDATION_ERROR",
      "Only text-only Recovery Packs can be inserted into this live session",
    );
  }
  const questions = recoveryPackQuestions(version, input.commandId);
  const insertedBlocks = questions.map((question, index) => ({
    id: recoveryPackCopyId(
      `${input.commandId}:presentation-block:${index === 0 ? "diagnostic" : "recheck"}:${version.id}`,
    ),
    kind: "question" as const,
    question,
  }));
  const insertionIndex = session.phase === "lobby" ? 0 : session.currentBlockIndex + 1;
  const blocks = [...session.content.blocks];
  blocks.splice(insertionIndex, 0, ...insertedBlocks);
  const content = PresentationContentSchema.parse({
    ...session.content,
    schemaVersion: 3,
    blocks,
    recoveryPackInsertions: [
      ...(session.content.recoveryPackInsertions ?? []),
      {
        id: input.commandId,
        packId: version.packId,
        packVersionId: version.id,
        packVersion: version.version,
        contentHash: version.contentHash,
        diagnosticQuestionId: questions[0]!.id,
        recheckQuestionId: questions[1]!.id,
        originalContent: version.content,
      },
    ],
  });
  if (
    Buffer.byteLength(JSON.stringify(content), "utf8") > PRESENTATION_PACK_INSERTION_DRAFT_LIMIT
  ) {
    throw new PresentationSessionServiceError(
      422,
      "VALIDATION_ERROR",
      "This Recovery Pack would make the live presentation too large",
    );
  }
  return {
    content,
    phase: "question_open" as const,
    currentBlockIndex: insertionIndex,
    status: "active" as const,
    event: {
      type: "question.launched" as const,
      blockIndex: insertionIndex,
      blockId: insertedBlocks[0]!.id,
    },
  };
}

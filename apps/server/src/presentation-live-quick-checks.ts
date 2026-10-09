import {
  PresentationContentSchema,
  PresentationQuickCheckInputSchema,
  type PresentationCompanionCommand,
} from "@openround/contracts";
import type { PresentationSessionRecord } from "@openround/db";
import { recoveryPackCopyId } from "./recovery-pack-copies.js";
import {
  assertPresentationLiveInsertionSize,
  presentationClosedInsertionBoundary,
  presentationLiveInsertionIndex,
} from "./presentation-live-insertion.js";

export function presentationCanInsertQuickCheck(session: PresentationSessionRecord) {
  return (
    !session.content.liveQuickCheck &&
    session.content.blocks.length + 1 <= 100 &&
    presentationClosedInsertionBoundary(session)
  );
}

export function presentationQuickCheckInsertionTransition(
  session: PresentationSessionRecord,
  input: Extract<PresentationCompanionCommand, { action: "insert_quick_check" }>,
) {
  const quickCheck = PresentationQuickCheckInputSchema.parse(input.quickCheck);
  const blockId = recoveryPackCopyId(`${input.commandId}:quick-check:block`);
  const block = {
    id: blockId,
    kind: "question" as const,
    question: {
      id: recoveryPackCopyId(`${input.commandId}:quick-check:question`),
      type: "poll" as const,
      prompt: quickCheck.prompt,
      choices: quickCheck.choices.map((label, index) => ({
        id: recoveryPackCopyId(`${input.commandId}:quick-check:choice:${index}`),
        label,
        isCorrect: false,
      })),
      purpose: "opinion" as const,
      confidence: "off" as const,
      delivery: "main" as const,
      conceptKeys: [],
      linkedRecheckQuestionId: null,
      timeLimitSeconds: quickCheck.timeLimitSeconds,
      basePoints: 0,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
    },
  };
  const insertionIndex = presentationLiveInsertionIndex(session);
  const blocks = [...session.content.blocks];
  blocks.splice(insertionIndex, 0, block);
  const content = PresentationContentSchema.parse({
    ...session.content,
    blocks,
    liveQuickCheck: { commandId: input.commandId, blockId },
  });
  assertPresentationLiveInsertionSize(content);
  return {
    content,
    phase: "question_open" as const,
    currentBlockIndex: insertionIndex,
    status: "active" as const,
    event: { type: "question.launched" as const, blockIndex: insertionIndex, blockId },
  };
}

import type {
  ApplyPresentationRecoveryPackUpdate,
  ApplyRecoveryPackUpdate,
  PresentationDraft,
  PresentationRecoveryPackUpdatePreview,
  RecoveryPackUpdatePreview,
} from "@openround/contracts";

/** Adapt only the document envelope; comparison and explicit-choice semantics stay shared. */
export function presentationPackReviewForPanel(
  review: PresentationRecoveryPackUpdatePreview,
): RecoveryPackUpdatePreview {
  const { presentationId, ...comparison } = review;
  return { ...comparison, quizId: presentationId };
}

export function presentationPackUpdateFromPanel(
  input: ApplyRecoveryPackUpdate,
): ApplyPresentationRecoveryPackUpdate {
  return {
    insertionId: input.insertionId,
    packVersionId: input.packVersionId,
    expectedRevision: input.expectedRevision,
    mutationId: input.mutationId,
    choices: input.choices,
  };
}

export function presentationPackDraftIsCurrent({
  expectedSignature,
  currentSignature,
  savedSignature,
  expectedRevision,
  currentRevision,
}: {
  expectedSignature: string;
  currentSignature: string;
  savedSignature: string;
  expectedRevision: number;
  currentRevision: number;
}) {
  return (
    expectedSignature === currentSignature &&
    expectedSignature === savedSignature &&
    expectedRevision === currentRevision
  );
}

/** Keep the selected block if present; a deleted copy falls back near its previous position. */
export function presentationPackSelectedBlock(
  before: PresentationDraft,
  after: PresentationDraft,
  selectedBlockId: string | null,
) {
  if (after.blocks.some((block) => block.id === selectedBlockId)) return selectedBlockId;
  const index = Math.max(
    0,
    before.blocks.findIndex((block) => block.id === selectedBlockId),
  );
  return after.blocks[Math.min(index, after.blocks.length - 1)]?.id ?? null;
}

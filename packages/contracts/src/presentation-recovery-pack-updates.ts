import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  PresentationDraftSchema,
  type InteractiveQuestionBlockDraft,
  type PresentationDraft,
  type QuizDraft,
  type RecoveryPackInsertion,
  type RecoveryPackUpdateChoice,
  type RecoveryPackUpdateRole,
} from "./index";
import {
  RecoveryPackUpdateError,
  applyRecoveryPackUpdate,
  buildRecoveryPackUpdatePreview,
  recoveryPackUpdateLinkIssue,
  type RecoveryPackUpdateComparison,
  type RecoveryPackUpdateTarget,
} from "./recovery-pack-updates";

/** The comparison is artifact-independent; IDs and draft revision are supplied by the server. */
export type PresentationRecoveryPackUpdateComparison = RecoveryPackUpdateComparison;

function presentationMessage(message: string) {
  return message.replace(/\bRound\b/g, "Presentation");
}

function withPresentationErrors<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof RecoveryPackUpdateError)
      throw new RecoveryPackUpdateError(error.code, presentationMessage(error.message));
    throw error;
  }
}

function project(draft: PresentationDraft): QuizDraft {
  return {
    title: draft.title,
    description: draft.description,
    experiencePreset: draft.experiencePreset,
    questions: draft.blocks.flatMap((block) => (block.kind === "question" ? [block.question] : [])),
    recoveryPackInsertions: draft.recoveryPackInsertions,
  };
}

function destinationId(insertion: RecoveryPackInsertion, role: RecoveryPackUpdateRole) {
  return role === "diagnostic" ? insertion.diagnosticQuestionId : insertion.recheckQuestionId;
}

function restoredBlockId(insertion: RecoveryPackInsertion, role: RecoveryPackUpdateRole) {
  const value = `presentation-recovery-pack-restore:${insertion.id}:${destinationId(insertion, role)}`;
  const chars = bytesToHex(sha256(new TextEncoder().encode(value)))
    .slice(0, 32)
    .split("");
  chars[12] = "5";
  chars[16] = (8 + (parseInt(chars[16]!, 16) & 3)).toString(16);
  const id = chars.join("");
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

/** Source ownership and immutable target selection remain server responsibilities. */
export function buildPresentationRecoveryPackUpdatePreview(
  draftInput: PresentationDraft,
  insertion: RecoveryPackInsertion,
  target: RecoveryPackUpdateTarget,
): PresentationRecoveryPackUpdateComparison {
  return withPresentationErrors(() => {
    const draft = PresentationDraftSchema.parse(draftInput);
    return buildRecoveryPackUpdatePreview(project(draft), insertion, target);
  });
}

export function presentationRecoveryPackUpdateLinkIssue(
  preview: PresentationRecoveryPackUpdateComparison,
  choices: RecoveryPackUpdateChoice[],
): string | null {
  const issue = recoveryPackUpdateLinkIssue(preview, choices);
  return issue ? presentationMessage(issue) : null;
}

/**
 * Merge checkpoints through the Round engine, then adapt only their questions and frozen context.
 * Quiz category/defaults never enter the Presentation, and unrelated blocks are not reconstructed.
 */
export function applyPresentationRecoveryPackUpdate(
  draftInput: PresentationDraft,
  preview: PresentationRecoveryPackUpdateComparison,
  target: RecoveryPackUpdateTarget,
  choices: RecoveryPackUpdateChoice[],
): PresentationDraft {
  return withPresentationErrors(() => {
    const draft = PresentationDraftSchema.parse(draftInput);
    const merged = applyRecoveryPackUpdate(project(draft), preview, target, choices);
    const insertion = draft.recoveryPackInsertions!.find(
      (item) => item.id === preview.insertionId,
    )!;
    const destinationIds = new Set([insertion.diagnosticQuestionId, insertion.recheckQuestionId]);
    const questions = new Map(merged.questions.map((question) => [question.id, question]));
    const blocks = draft.blocks.map((block) => {
      if (block.kind !== "question" || !destinationIds.has(block.question.id)) return block;
      const question = questions.get(block.question.id)!;
      return JSON.stringify(question) === JSON.stringify(block.question)
        ? block
        : { ...block, question };
    });
    // The shared merge handles choices and pair validity. Place only explicitly restored questions
    // next to their sibling; if both were deleted, append diagnostic then recheck after all slides.
    for (const role of ["diagnostic", "recheck"] as const) {
      const questionId = destinationId(insertion, role);
      const question = questions.get(questionId);
      if (
        !question ||
        blocks.some((block) => block.kind === "question" && block.question.id === questionId)
      )
        continue;
      if (blocks.length >= 200)
        throw new RecoveryPackUpdateError(
          "QUESTION_CAPACITY_EXCEEDED",
          "Remove a Presentation block before restoring a deleted Pack checkpoint",
        );
      const id = restoredBlockId(insertion, role);
      if (blocks.some((block) => block.id === id))
        throw new RecoveryPackUpdateError(
          "INVALID_INSERTION",
          "The restored Pack block ID conflicts with another block in this Presentation",
        );
      const siblingId = destinationId(insertion, role === "diagnostic" ? "recheck" : "diagnostic");
      const siblingIndex = blocks.findIndex(
        (block) => block.kind === "question" && block.question.id === siblingId,
      );
      const block: InteractiveQuestionBlockDraft = { id, kind: "question", question };
      blocks.splice(
        siblingIndex === -1 ? blocks.length : siblingIndex + (role === "recheck" ? 1 : 0),
        0,
        block,
      );
    }
    return PresentationDraftSchema.parse({
      ...draft,
      blocks,
      recoveryPackInsertions: merged.recoveryPackInsertions,
    });
  });
}

import {
  recoveryPackQuestionSemanticValue,
  recoveryPackUpdateLinkIssue,
  type QuestionDraft,
  type RecoveryPackUpdateChoice,
  type RecoveryPackUpdatePreview,
} from "@openround/contracts";

export type RecoveryPackSelections = Partial<
  Record<RecoveryPackUpdateChoice["role"], RecoveryPackUpdateChoice["action"]>
>;

export function recoveryPackUpdateAvailable(review: RecoveryPackUpdatePreview) {
  return review.latestVersionId !== review.baselineVersionId;
}

export function recoveryPackDefaultSelections(
  review: RecoveryPackUpdatePreview,
): RecoveryPackSelections {
  return Object.fromEntries(
    review.items.flatMap((item) =>
      item.status === "conflict"
        ? []
        : [[item.role, item.status === "source_changed" ? "use_latest" : "keep_local"]],
    ),
  );
}

export function recoveryPackSelectedChoices(
  review: RecoveryPackUpdatePreview,
  selections: RecoveryPackSelections,
) {
  const choices = review.items.flatMap((item) =>
    selections[item.role] ? [{ role: item.role, action: selections[item.role]! }] : [],
  );
  return choices.length === review.items.length ? choices : null;
}

export function recoveryPackSelectedLinkIssue(
  review: RecoveryPackUpdatePreview,
  choices: RecoveryPackUpdateChoice[] | null,
) {
  return choices ? recoveryPackUpdateLinkIssue(review, choices) : null;
}

export function recoveryPackReviewIsCurrent(
  review: RecoveryPackUpdatePreview,
  draftRevision: number,
  reviewedDraft: string,
  currentDraft: string,
) {
  return review.draftRevision === draftRevision && reviewedDraft === currentDraft;
}

export function recoveryPackUndoIsCurrent(
  undo: { appliedRevision: number; draftSignature: string } | null,
  currentDraftRevision: number,
  draftSignature: string,
) {
  return Boolean(
    undo && undo.appliedRevision === currentDraftRevision && undo.draftSignature === draftSignature,
  );
}

/** Includes every persisted question field, not only the prompt/answer visible in the editor. */
export function recoveryPackChangedFields(
  baseline: QuestionDraft,
  candidate: QuestionDraft | null,
  baselineRoleIds: { diagnostic: string; recheck: string },
  candidateRoleIds: { diagnostic: string; recheck: string },
) {
  if (!candidate) return ["checkpoint deleted"];
  const before = JSON.parse(recoveryPackQuestionSemanticValue(baseline, baselineRoleIds)) as Record<
    string,
    unknown
  >;
  const after = JSON.parse(
    recoveryPackQuestionSemanticValue(candidate, candidateRoleIds),
  ) as Record<string, unknown>;
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
}

import {
  PresentationQuickCheckInputSchema,
  type PresentationQuickCheckInput,
} from "@openround/contracts";

export interface CompanionQuickCheckDraft {
  prompt: string;
  choices: string[];
  timeLimitSeconds: string;
}

export function createCompanionQuickCheckDraft(): CompanionQuickCheckDraft {
  return { prompt: "", choices: ["", ""], timeLimitSeconds: "30" };
}

export function addCompanionQuickCheckChoice(draft: CompanionQuickCheckDraft) {
  if (draft.choices.length >= 6) return draft;
  return { ...draft, choices: [...draft.choices, ""] };
}

export function removeCompanionQuickCheckChoice(draft: CompanionQuickCheckDraft, index: number) {
  if (
    draft.choices.length <= 2 ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= draft.choices.length
  )
    return draft;
  return { ...draft, choices: draft.choices.filter((_, choiceIndex) => choiceIndex !== index) };
}

export type CompanionQuickCheckValidation =
  | { success: true; quickCheck: PresentationQuickCheckInput }
  | {
      success: false;
      field: "prompt" | "choices" | "timeLimitSeconds";
      messageKey:
        | "live.companion.quickCheck.promptInvalid"
        | "live.companion.quickCheck.choicesInvalid"
        | "live.companion.quickCheck.choicesDuplicate"
        | "live.companion.quickCheck.timeInvalid";
    };

/** Use the same trimming, bounds, and canonical choice comparison as the server. */
export function validateCompanionQuickCheckDraft(
  draft: CompanionQuickCheckDraft,
): CompanionQuickCheckValidation {
  const result = PresentationQuickCheckInputSchema.safeParse({
    prompt: draft.prompt,
    choices: draft.choices,
    timeLimitSeconds: Number(draft.timeLimitSeconds),
  });
  if (result.success) return { success: true, quickCheck: result.data };
  const issue = result.error.issues[0];
  if (issue?.path[0] === "prompt")
    return {
      success: false,
      field: "prompt",
      messageKey: "live.companion.quickCheck.promptInvalid",
    };
  if (issue?.path[0] === "timeLimitSeconds")
    return {
      success: false,
      field: "timeLimitSeconds",
      messageKey: "live.companion.quickCheck.timeInvalid",
    };
  return {
    success: false,
    field: "choices",
    messageKey:
      issue?.code === "custom"
        ? "live.companion.quickCheck.choicesDuplicate"
        : "live.companion.quickCheck.choicesInvalid",
  };
}

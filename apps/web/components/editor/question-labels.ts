import type { QuestionType } from "@openround/contracts";

export function responseTypeLabel(type: QuestionType) {
  return {
    single_select: "Single select",
    true_false: "True or false",
    multi_select: "Multiple select",
    numeric: "Numeric response",
    rating: "Rating",
    poll: "Poll",
  }[type];
}

export function editorTypeLabel(type: QuestionType, uxBeta: boolean) {
  return !uxBeta && type === "numeric" ? "Numeric" : responseTypeLabel(type);
}

export const responseTypeGuidance: Record<QuestionType, string> = {
  single_select: "Use when one answer best reveals understanding or a misconception.",
  true_false: "Use for a fast check of one precise claim.",
  multi_select: "Use when learners need to identify every valid option.",
  numeric: "Use for calculations or measurements with an optional tolerance and unit.",
  rating: "Use for an unscored confidence, sentiment, or reflection scale.",
  poll: "Use for an unscored preference or discussion opener.",
};

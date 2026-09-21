import { QUESTION_TYPE_REGISTRY, type QuestionType } from "@openround/contracts";

export function responseTypeLabel(type: QuestionType) {
  return QUESTION_TYPE_REGISTRY[type].editorLabel;
}

export function editorTypeLabel(type: QuestionType, uxBeta: boolean) {
  return !uxBeta && type === "numeric" ? "Numeric" : responseTypeLabel(type);
}

export const responseTypeGuidance = Object.fromEntries(
  Object.values(QUESTION_TYPE_REGISTRY).map(({ type, description }) => [type, description]),
) as Record<QuestionType, string>;

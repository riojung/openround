import type { QuizDraft } from "@openround/contracts";

export function removeQuestionById(draft: QuizDraft, questionId: string): QuizDraft {
  return {
    ...draft,
    questions: draft.questions
      .filter((question) => question.id !== questionId)
      .map((question) =>
        question.linkedRecheckQuestionId === questionId
          ? { ...question, linkedRecheckQuestionId: null }
          : question,
      ),
  };
}

export function moveQuestionById(
  draft: QuizDraft,
  questionId: string,
  direction: -1 | 1,
): QuizDraft {
  const source = draft.questions.findIndex((question) => question.id === questionId);
  const target = source + direction;
  if (source < 0 || target < 0 || target >= draft.questions.length) return draft;
  const questions = [...draft.questions];
  [questions[source], questions[target]] = [questions[target]!, questions[source]!];
  return { ...draft, questions };
}

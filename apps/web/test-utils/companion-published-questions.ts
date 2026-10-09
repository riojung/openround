import type { PresentationCompanionPublishedQuestion } from "@openround/contracts";

export const publishedQuestion = {
  sourceQuizId: "22222222-2222-4222-8222-222222222222",
  sourceQuizVersionId: "33333333-3333-4333-8333-333333333333",
  sourceQuizVersion: 2,
  sourceQuestionId: "44444444-4444-4444-8444-444444444444",
  contentHash: "a".repeat(64),
  title: "Published <Round>",
  prompt: "Which comparison should we discuss?",
  type: "poll",
} satisfies PresentationCompanionPublishedQuestion;

export const publishedQuestionCatalog = { questions: [publishedQuestion], hasMore: false };

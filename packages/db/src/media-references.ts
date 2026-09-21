import type { PresentationContent, PresentationDraft, QuizDraft } from "@openround/contracts";

function uniqueMediaIds(mediaIds: Array<string | null | undefined>) {
  return [...new Set(mediaIds.filter((mediaId): mediaId is string => Boolean(mediaId)))];
}

export function quizMediaIds(content: QuizDraft) {
  return uniqueMediaIds(content.questions.map((question) => question.mediaId));
}

export function presentationMediaIds(content: PresentationDraft | PresentationContent) {
  return uniqueMediaIds(
    content.blocks.map((block) =>
      block.kind === "content" ? block.mediaId : block.question.mediaId,
    ),
  );
}

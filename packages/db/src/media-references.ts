import type {
  PresentationContent,
  PresentationDraft,
  QuizDraft,
  RecoveryPackDraft,
} from "@openround/contracts";

function uniqueMediaIds(mediaIds: Array<string | null | undefined>) {
  return [...new Set(mediaIds.filter((mediaId): mediaId is string => Boolean(mediaId)))];
}

export function quizMediaIds(content: QuizDraft) {
  return uniqueMediaIds([
    ...content.questions.map((question) => question.mediaId),
    ...(content.recoveryPackInsertions ?? []).flatMap((insertion) =>
      recoveryPackMediaIds(insertion.originalContent),
    ),
  ]);
}

export function recoveryPackMediaIds(content: RecoveryPackDraft) {
  return uniqueMediaIds([
    content.diagnostic.mediaId,
    content.recheck.mediaId,
    content.delayedProbe?.mediaId,
  ]);
}

export function presentationMediaIds(content: PresentationDraft | PresentationContent) {
  return uniqueMediaIds(
    content.blocks.map((block) =>
      block.kind === "content" ? block.mediaId : block.question.mediaId,
    ),
  );
}

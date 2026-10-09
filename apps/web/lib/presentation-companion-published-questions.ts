import {
  PresentationCompanionPublishedQuestionCatalogSchema,
  type PresentationPublishedQuestionSelection,
} from "@openround/contracts";
import { apiFetch } from "./api";

export type CompanionPublishedQuestionCatalog = ReturnType<
  typeof PresentationCompanionPublishedQuestionCatalogSchema.parse
>;

/** Search the scoped metadata catalog without sending creator cookies or fetching question bodies. */
export async function fetchPresentationCompanionPublishedQuestions(
  sessionId: string,
  companionToken: string,
  search = "",
) {
  const query = search.trim();
  if (query.length > 100) throw new Error("Search must be no longer than 100 characters.");
  const searchParams = query ? `?${new URLSearchParams({ search: query }).toString()}` : "";
  const response = await apiFetch(
    `/v1/presentation-sessions/${encodeURIComponent(sessionId)}/companion-published-questions${searchParams}`,
    { credentials: "omit", headers: { authorization: `Bearer ${companionToken}` } },
  );
  return PresentationCompanionPublishedQuestionCatalogSchema.parse(response);
}

export function publishedQuestionSelection(
  question: CompanionPublishedQuestionCatalog["questions"][number],
): PresentationPublishedQuestionSelection {
  return {
    sourceQuizVersionId: question.sourceQuizVersionId,
    sourceQuestionId: question.sourceQuestionId,
    contentHash: question.contentHash,
  };
}

/** A refreshed catalog must still contain the exact selected immutable version, question, and hash. */
export function selectedPublishedQuestion(
  catalog: CompanionPublishedQuestionCatalog | null,
  selection: PresentationPublishedQuestionSelection | null,
) {
  if (!selection) return undefined;
  return catalog?.questions.find(
    (question) =>
      question.sourceQuizVersionId === selection.sourceQuizVersionId &&
      question.sourceQuestionId === selection.sourceQuestionId &&
      question.contentHash === selection.contentHash,
  );
}

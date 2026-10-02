import type { QuizDraft } from "@openround/contracts";

/** Prevent a health mutation from racing a local autosave or a newer server revision. */
export function matchesSavedHealthDraft(
  localDraft: QuizDraft | null,
  savedDraftJson: string,
  actualRevision: number,
  expectedRevision: number,
): boolean {
  return (
    localDraft !== null &&
    actualRevision === expectedRevision &&
    JSON.stringify(localDraft) === savedDraftJson
  );
}

/** A server result may replace editor state only if no local keystroke followed the request. */
export function mayAdoptHealthDraft(
  localDraft: QuizDraft | null,
  capturedDraftJson: string,
): boolean {
  return localDraft !== null && JSON.stringify(localDraft) === capturedDraftJson;
}

/** A replayed receipt must not make an older revision look like the current saved draft. */
export function matchesLatestHealthDraft(
  mutation: { draft: QuizDraft; draftRevision: number },
  latest: { draft: QuizDraft; draftRevision: number },
): boolean {
  return (
    mutation.draftRevision === latest.draftRevision &&
    JSON.stringify(mutation.draft) === JSON.stringify(latest.draft)
  );
}

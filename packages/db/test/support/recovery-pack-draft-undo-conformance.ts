import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  QuizDraftMutationConflictError,
  QuizDraftRevisionConflictError,
  type QuizDraftUpdate,
  type Repository,
} from "../../src/index.js";

/** Exercise Pack update receipt identity and source retention through both public backends. */
export async function expectRecoveryPackDraftUndoConformance(input: {
  repository: Repository;
  workspaceId: string;
  editorId: string;
}) {
  const { repository, workspaceId, editorId } = input;
  const now = new Date();
  const oldDate = new Date(now.getTime() - 31 * 86_400_000);
  const mediaId = randomUUID();
  await repository.createMediaAsset({
    id: mediaId,
    workspaceId,
    objectKey: `media/${workspaceId}/${mediaId}.png`,
    mimeType: "image/png",
    sizeBytes: 10,
    scanStatus: "clean",
    altText: "Original instruction diagram",
    createdAt: oldDate,
  });
  const original = {
    title: "Before Pack update",
    description: "",
    questions: [
      {
        id: randomUUID(),
        type: "numeric" as const,
        prompt: "How many equal parts?",
        correctValue: "4",
        tolerance: "0",
        unit: null,
        timeLimitSeconds: 30,
        basePoints: 100,
        explanation: "The parts are equal.",
        mediaId,
        mediaAlt: "Original instruction diagram",
      },
    ],
  };
  const quiz = await repository.createQuiz({
    id: randomUUID(),
    workspaceId,
    title: original.title,
    description: original.description,
    draft: original,
    status: "draft",
    draftRevision: 0,
    draftSchemaVersion: 1,
    currentVersionId: null,
    publishedDraftRevision: null,
    lastEditedBy: editorId,
    createdAt: oldDate,
    updatedAt: oldDate,
  });
  const changed = {
    ...quiz.draft,
    title: "After Pack update",
    questions: quiz.draft.questions.map((question) => ({
      ...question,
      mediaId: null,
      mediaAlt: null,
    })),
  };
  const apply: QuizDraftUpdate = {
    workspaceId,
    quizId: quiz.id,
    draft: changed,
    expectedRevision: 0,
    mutationId: randomUUID(),
    editorId,
    schemaVersion: 1,
    draftHash: "pack-update",
    recoveryPackUpdateSourceRevision: 0,
  };
  expect(await repository.updateQuizDraft(apply)).toMatchObject({
    draftRevision: 1,
    draft: { title: changed.title },
  });
  const history = await repository.listQuizDraftHistory(workspaceId, quiz.id);
  expect(history.map((snapshot) => snapshot.revision)).toEqual([1, 0]);
  expect(history.find((snapshot) => snapshot.revision === 0)?.createdAt).toEqual(oldDate);
  expect(await repository.claimMediaAssetDeletion(workspaceId, mediaId)).toBeNull();
  expect(await repository.deleteMediaAsset(workspaceId, mediaId)).toBe(false);
  expect(await repository.listMediaReferences(workspaceId, mediaId)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        ownerType: "quiz_history",
        ownerId: history.find((snapshot) => snapshot.revision === 0)!.id,
      }),
    ]),
  );
  expect(await repository.updateQuizDraft(apply)).toMatchObject({ draftRevision: 1 });
  await expect(
    repository.updateQuizDraft({ ...apply, recoveryPackUpdateSourceRevision: undefined }),
  ).rejects.toBeInstanceOf(QuizDraftMutationConflictError);
  await expect(
    repository.updateQuizDraft({ ...apply, recoveryPackUpdateSourceRevision: 1 }),
  ).rejects.toBeInstanceOf(QuizDraftMutationConflictError);
  await expect(
    repository.updateQuizDraft({
      ...apply,
      expectedRevision: 1,
      recoveryPackUpdateSourceRevision: 1,
      mutationId: randomUUID(),
    }),
  ).rejects.toBeInstanceOf(QuizDraftMutationConflictError);
  await expect(
    repository.updateQuizDraft({
      ...apply,
      draft: { ...changed, title: "Invalid marker" },
      expectedRevision: 1,
      recoveryPackUpdateSourceRevision: 0,
      mutationId: randomUUID(),
    }),
  ).rejects.toBeInstanceOf(QuizDraftMutationConflictError);

  const undo = {
    workspaceId,
    quizId: quiz.id,
    historyRevision: 0,
    expectedRevision: 1,
    mutationId: randomUUID(),
    editorId,
  };
  expect(await repository.restoreQuizDraftHistory(undo)).toMatchObject({
    draftRevision: 2,
    draft: { title: original.title, questions: [{ mediaId }] },
  });
  expect(await repository.restoreQuizDraftHistory(undo)).toMatchObject({ draftRevision: 2 });
  expect(
    (await repository.listQuizDraftHistory(workspaceId, quiz.id)).map(
      (snapshot) => snapshot.revision,
    ),
  ).not.toContain(0);

  // A later unrelated edit must not be overwritten by Undo of an earlier Pack update.
  const fresh = await repository.createQuiz({
    id: randomUUID(),
    workspaceId,
    title: "Fresh Round",
    description: "",
    draft: { ...original, title: "Fresh Round" },
    status: "draft",
    draftRevision: 0,
    draftSchemaVersion: 1,
    currentVersionId: null,
    lastEditedBy: editorId,
    createdAt: now,
    updatedAt: now,
  });
  const freshApply = {
    ...apply,
    quizId: fresh.id,
    draft: { ...fresh.draft, title: "Pack applied" },
    mutationId: randomUUID(),
    draftHash: "fresh-pack-update",
  };
  await repository.updateQuizDraft(freshApply);
  await repository.updateQuizDraft({
    ...freshApply,
    draft: { ...freshApply.draft, title: "Unrelated edit" },
    expectedRevision: 1,
    mutationId: randomUUID(),
    draftHash: "unrelated",
    recoveryPackUpdateSourceRevision: undefined,
  });
  await expect(
    repository.restoreQuizDraftHistory({ ...undo, quizId: fresh.id, mutationId: randomUUID() }),
  ).rejects.toBeInstanceOf(QuizDraftRevisionConflictError);
  expect((await repository.getQuiz(workspaceId, fresh.id))?.draft.title).toBe("Unrelated edit");

  // A restore-looking hash cannot let a marked Pack receipt masquerade as a history restore.
  const collision = {
    ...freshApply,
    expectedRevision: 2,
    recoveryPackUpdateSourceRevision: 2,
    draft: { ...freshApply.draft, title: "New Pack update" },
    mutationId: randomUUID(),
    draftHash: "restore:0",
  };
  await repository.updateQuizDraft(collision);
  await expect(
    repository.restoreQuizDraftHistory({
      ...undo,
      quizId: fresh.id,
      expectedRevision: 2,
      mutationId: collision.mutationId,
    }),
  ).rejects.toBeInstanceOf(QuizDraftMutationConflictError);
  const ordinary = {
    ...freshApply,
    expectedRevision: 3,
    draft: { ...freshApply.draft, title: "Ordinary save" },
    mutationId: randomUUID(),
    draftHash: "ordinary",
    recoveryPackUpdateSourceRevision: undefined,
  };
  await repository.updateQuizDraft(ordinary);
  await expect(
    repository.updateQuizDraft({ ...ordinary, recoveryPackUpdateSourceRevision: 3 }),
  ).rejects.toBeInstanceOf(QuizDraftMutationConflictError);
}

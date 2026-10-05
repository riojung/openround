import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  RecoveryPackContentSchema,
  recoveryPackContentHash,
  type QuizDraft,
} from "@openround/contracts";
import {
  createRecoveryPackRepository,
  MEDIA_DELETION_TOMBSTONE_HOLD_MS,
  type Repository,
} from "../../src/index.js";
import { recoveryPackDraft, recoveryPackRecord } from "./recovery-pack-conformance.js";

/** Both the memory graph and PostgreSQL JSON extractor must retain updated probe-only media. */
export async function expectRecoveryPackUpdateMediaConformance(input: {
  repository: Repository;
  workspaceId: string;
  editorId: string;
}) {
  const { repository, workspaceId, editorId } = input;
  const packs = createRecoveryPackRepository(repository);
  const now = new Date();
  const mediaId = randomUUID();
  await repository.createMediaAsset({
    id: mediaId,
    workspaceId,
    objectKey: `media/${workspaceId}/${mediaId}.png`,
    mimeType: "image/png",
    sizeBytes: 10,
    scanStatus: "clean",
    altText: "Delayed fraction diagram",
    createdAt: now,
  });
  const originalContent = RecoveryPackContentSchema.parse(recoveryPackDraft());
  const pack = await packs.createRecoveryPack(
    recoveryPackRecord(workspaceId, editorId, originalContent),
  );
  const originalVersion = await packs.publishRecoveryPack(
    {
      id: randomUUID(),
      workspaceId,
      packId: pack.id,
      version: 1,
      content: originalContent,
      contentHash: recoveryPackContentHash(originalContent),
      sourceDraftRevision: 0,
      publishedAt: now,
    },
    0,
  );
  const updatedContent = RecoveryPackContentSchema.parse({
    ...originalContent,
    delayedProbe: {
      ...originalContent.diagnostic,
      id: randomUUID(),
      prompt: "Use a new fraction comparison after one week",
      delivery: "main",
      linkedRecheckQuestionId: null,
      mediaId,
      mediaAlt: "Delayed fraction diagram",
    },
  });
  await packs.updateRecoveryPackDraft({
    workspaceId,
    packId: pack.id,
    draft: updatedContent,
    expectedRevision: 0,
    mutationId: randomUUID(),
    editorId,
    draftHash: "new-probe",
  });
  const updatedVersion = await packs.publishRecoveryPack(
    {
      id: randomUUID(),
      workspaceId,
      packId: pack.id,
      version: 2,
      content: updatedContent,
      contentHash: recoveryPackContentHash(updatedContent),
      sourceDraftRevision: 1,
      publishedAt: now,
    },
    1,
  );
  const insertion = {
    id: randomUUID(),
    packId: pack.id,
    packVersionId: originalVersion.id,
    packVersion: originalVersion.version,
    contentHash: originalVersion.contentHash,
    diagnosticQuestionId: originalContent.diagnostic.id,
    recheckQuestionId: originalContent.recheck.id,
    originalContent,
  };
  const originalDraft: QuizDraft = {
    title: "Round with reusable recovery",
    description: "",
    questions: [originalContent.diagnostic, originalContent.recheck],
    recoveryPackInsertions: [insertion],
  };
  const quiz = await repository.createQuiz({
    id: randomUUID(),
    workspaceId,
    title: originalDraft.title,
    description: "",
    draft: originalDraft,
    status: "draft",
    currentVersionId: null,
    draftRevision: 0,
    lastEditedBy: editorId,
    createdAt: now,
    updatedAt: now,
  });
  expect(
    (await repository.listMediaReferences(workspaceId, mediaId)).filter((reference) =>
      reference.ownerType.startsWith("quiz_"),
    ),
  ).toEqual([]);
  const updatedDraft: QuizDraft = {
    ...originalDraft,
    recoveryPackInsertions: [
      {
        ...insertion,
        updateBaseline: {
          packVersionId: updatedVersion.id,
          packVersion: updatedVersion.version,
          contentHash: updatedVersion.contentHash,
          content: updatedContent,
        },
      },
    ],
  };
  const saved = (await repository.updateQuizDraft({
    workspaceId,
    quizId: quiz.id,
    draft: updatedDraft,
    expectedRevision: 0,
    mutationId: randomUUID(),
    editorId,
    schemaVersion: 1,
    draftHash: "updated-baseline",
    recoveryPackUpdateSourceRevision: 0,
  }))!;
  expect(saved.draft.recoveryPackInsertions?.[0]?.originalContent).toEqual(originalContent);
  expect(
    saved.draft.recoveryPackInsertions?.[0]?.updateBaseline?.content.delayedProbe?.mediaId,
  ).toBe(mediaId);
  const version = await repository.publishQuiz(
    {
      id: randomUUID(),
      workspaceId,
      quizId: quiz.id,
      version: 1,
      content: updatedDraft,
      contentHash: "updated-baseline-round",
      publishedAt: now,
    },
    null,
    1,
  );
  expect(await packs.deleteRecoveryPack(workspaceId, pack.id)).toBe(true);
  const references = await repository.listMediaReferences(workspaceId, mediaId);
  expect(references).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ ownerType: "quiz_draft", ownerId: quiz.id }),
      expect.objectContaining({ ownerType: "quiz_history" }),
      expect.objectContaining({ ownerType: "quiz_version", ownerId: version.id }),
    ]),
  );
  expect(references.some((reference) => reference.ownerType.startsWith("recovery_pack_"))).toBe(
    false,
  );
  expect(await repository.claimMediaAssetDeletion(workspaceId, mediaId)).toBeNull();
  expect(await repository.deleteMediaAsset(workspaceId, mediaId)).toBe(false);
  expect(
    (await repository.getQuizVersion(workspaceId, version.id))?.content.recoveryPackInsertions?.[0]
      ?.updateBaseline?.content.delayedProbe?.mediaId,
  ).toBe(mediaId);

  await repository.updateQuizDraft({
    workspaceId,
    quizId: quiz.id,
    draft: { ...updatedDraft, recoveryPackInsertions: [] },
    expectedRevision: 1,
    mutationId: randomUUID(),
    editorId,
    schemaVersion: 1,
    draftHash: "remove-current-baseline",
  });
  const retainedReferences = await repository.listMediaReferences(workspaceId, mediaId);
  expect(retainedReferences.some((reference) => reference.ownerType === "quiz_draft")).toBe(false);
  expect(retainedReferences.some((reference) => reference.ownerType === "quiz_history")).toBe(true);
  expect(retainedReferences.some((reference) => reference.ownerType === "quiz_version")).toBe(true);
  await repository.archiveQuiz(workspaceId, quiz.id, true);
  expect(await repository.deleteQuiz(workspaceId, quiz.id)).toBe("deleted");
  expect(await repository.listMediaReferences(workspaceId, mediaId)).toEqual([]);
  expect(await repository.claimMediaAssetDeletion(workspaceId, mediaId, now)).not.toBeNull();
  expect(
    await repository.deleteMediaAsset(
      workspaceId,
      mediaId,
      new Date(now.getTime() + MEDIA_DELETION_TOMBSTONE_HOLD_MS + 1),
    ),
  ).toBe(true);
}

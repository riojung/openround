import { randomUUID } from "node:crypto";
import type { PresentationDraft, QuizDraft } from "@openround/contracts";
import {
  createCollaborationGroupRepository,
  createLibraryMetadataRepository,
  createPresentationRepository,
  type CreatorContext,
  type Repository,
} from "../../src/index.js";

export async function createLibraryDeletionFixture(
  repository: Repository,
  owner: CreatorContext,
  secondUserId: string,
) {
  const now = new Date();
  const mediaId = randomUUID();
  await repository.createMediaAsset({
    id: mediaId,
    workspaceId: owner.workspaceId,
    objectKey: `quarantine/${owner.workspaceId}/${mediaId}.png`,
    mimeType: "image/png",
    sizeBytes: 128,
    scanStatus: "pending",
    altText: "Deletion fixture chart",
    createdAt: now,
  });
  const content: QuizDraft = {
    title: "Delete published Round",
    description: "",
    questions: [
      {
        id: randomUUID(),
        type: "numeric",
        prompt: "How many?",
        correctValue: "2",
        tolerance: "0",
        unit: null,
        timeLimitSeconds: 30,
        basePoints: 1_000,
        explanation: "Two",
        mediaId,
        mediaAlt: "Deletion fixture chart",
      },
    ],
  };
  const round = await repository.createQuiz({
    id: randomUUID(),
    workspaceId: owner.workspaceId,
    title: content.title,
    description: content.description,
    status: "draft",
    draft: content,
    currentVersionId: null,
    createdAt: now,
    updatedAt: now,
  });
  await repository.updateQuizDraft({
    workspaceId: owner.workspaceId,
    quizId: round.id,
    draft: { ...content, title: "Saved Round" },
    expectedRevision: 0,
    schemaVersion: 1,
    mutationId: randomUUID(),
    editorId: owner.userId,
    draftHash: randomUUID(),
  });
  const roundVersion = await repository.publishQuiz({
    id: randomUUID(),
    workspaceId: owner.workspaceId,
    quizId: round.id,
    version: 1,
    content,
    contentHash: randomUUID(),
    publishedAt: now,
  });

  const presentations = createPresentationRepository(repository);
  const presentationContent: PresentationDraft = {
    title: "Delete published Presentation",
    description: "",
    schemaVersion: 2,
    experiencePreset: { id: "focus", version: 1 },
    blocks: [{ id: randomUUID(), kind: "question", question: content.questions[0]! }],
  };
  const presentation = await presentations.createPresentation({
    id: randomUUID(),
    workspaceId: owner.workspaceId,
    title: presentationContent.title,
    description: "",
    status: "draft",
    draft: presentationContent,
    draftRevision: 0,
    draftSchemaVersion: 2,
    currentVersionId: null,
    folderId: null,
    publishedDraftRevision: null,
    lastEditedBy: owner.userId,
    createdAt: now,
    updatedAt: now,
  });
  await presentations.updatePresentationDraft({
    workspaceId: owner.workspaceId,
    presentationId: presentation.id,
    draft: { ...presentationContent, title: "Saved Presentation" },
    expectedRevision: 0,
    mutationId: randomUUID(),
    editorId: owner.userId,
    draftHash: randomUUID(),
  });
  const presentationVersion = await presentations.publishPresentation(
    {
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      presentationId: presentation.id,
      version: 1,
      content: presentationContent,
      contentHash: randomUUID(),
      sourceDraftRevision: 1,
      publishedAt: now,
    },
    1,
  );

  const favorites = createLibraryMetadataRepository(repository);
  const groups = createCollaborationGroupRepository(repository);
  const groupId = randomUUID();
  const group = await groups.createGroup(
    {
      id: groupId,
      workspaceId: owner.workspaceId,
      name: "Deletion fixture Group",
      description: "",
      createdBy: owner.userId,
      createdAt: now,
      updatedAt: now,
    },
    {
      workspaceId: owner.workspaceId,
      groupId,
      userId: owner.userId,
      role: "owner",
      joinedAt: now,
    },
  );
  for (const [artifactType, artifactId] of [
    ["round", round.id],
    ["presentation", presentation.id],
  ] as const) {
    for (const userId of [owner.userId, secondUserId]) {
      await favorites.setFavorite({
        workspaceId: owner.workspaceId,
        userId,
        artifactType,
        artifactId,
        favorite: true,
        now,
      });
    }
    await groups.addArtifact({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      groupId: group.id,
      artifactType,
      artifactId,
      addedBy: owner.userId,
      createdAt: now,
    });
    await groups.addSchedule({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      groupId: group.id,
      artifactType,
      artifactId,
      kind: "live_session",
      scheduledFor: now,
      note: "",
      createdBy: owner.userId,
      createdAt: now,
    });
  }
  return {
    now,
    mediaId,
    round,
    roundVersion,
    content,
    presentation,
    presentationVersion,
    presentationContent,
    presentations,
    favorites,
    groups,
    group,
  };
}

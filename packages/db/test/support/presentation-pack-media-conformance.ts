import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  PresentationContentSchema,
  RecoveryPackContentSchema,
  recoveryPackContentHash,
  type PresentationDraft,
  type RecoveryPackContent,
} from "@openround/contracts";
import {
  createPresentationRepository,
  createRecoveryPackRepository,
  MEDIA_DELETION_TOMBSTONE_HOLD_MS,
  type Repository,
} from "../../src/index.js";
import { recoveryPackDraft, recoveryPackRecord } from "./recovery-pack-conformance.js";

export function presentationPackContent(mediaIds: string[]): RecoveryPackContent {
  const draft = recoveryPackDraft();
  draft.diagnostic.mediaId = mediaIds[0]!;
  draft.diagnostic.mediaAlt = "Original diagnostic diagram";
  draft.recheck.mediaId = mediaIds[1]!;
  draft.recheck.mediaAlt = "Original recheck diagram";
  draft.delayedProbe = {
    ...draft.diagnostic,
    id: randomUUID(),
    prompt: "Compare these fractions after a week",
    linkedRecheckQuestionId: null,
    mediaId: mediaIds[2]!,
    mediaAlt: "Delayed probe diagram",
  };
  return RecoveryPackContentSchema.parse(draft);
}

export function presentationPackMediaDraft(content: RecoveryPackContent): PresentationDraft {
  const insertionId = randomUUID();
  const diagnosticQuestionId = randomUUID();
  const recheckQuestionId = randomUUID();
  const packId = randomUUID();
  const packVersionId = randomUUID();
  const contentHash = recoveryPackContentHash(content);
  return {
    title: "Presentation with frozen Recovery Pack media",
    description: "",
    experiencePreset: { id: "focus", version: 1 },
    schemaVersion: 3,
    blocks: [
      { role: "diagnostic" as const, question: content.diagnostic, id: diagnosticQuestionId },
      { role: "recheck" as const, question: content.recheck, id: recheckQuestionId },
    ].map(({ role, question, id }) => ({
      id: randomUUID(),
      kind: "question" as const,
      question: {
        ...question,
        id,
        linkedRecheckQuestionId: role === "diagnostic" ? recheckQuestionId : null,
        mediaId: null,
        mediaAlt: null,
        recoveryPackSource: {
          artifactType: "recovery_pack" as const,
          packId,
          packVersionId,
          packVersion: 1,
          contentHash,
          sourceItemId: question.id,
          role,
        },
      },
    })),
    recoveryPackInsertions: [
      {
        id: insertionId,
        packId,
        packVersionId,
        packVersion: 1,
        contentHash,
        diagnosticQuestionId,
        recheckQuestionId,
        originalContent: content,
      },
    ],
  };
}

async function createMedia(repository: Repository, workspaceId: string, id: string) {
  await repository.createMediaAsset({
    id,
    workspaceId,
    objectKey: `media/${workspaceId}/${id}.png`,
    mimeType: "image/png",
    sizeBytes: 10,
    scanStatus: "clean",
    altText: "Frozen Pack diagram",
    createdAt: new Date(),
  });
}

async function createPresentation(
  repository: Repository,
  workspaceId: string,
  editorId: string,
  draft: PresentationDraft,
) {
  const now = new Date();
  return createPresentationRepository(repository).createPresentation({
    id: randomUUID(),
    workspaceId,
    title: draft.title,
    description: draft.description,
    status: "draft",
    draft,
    draftRevision: 0,
    draftSchemaVersion: draft.schemaVersion,
    currentVersionId: null,
    folderId: null,
    publishedDraftRevision: null,
    lastEditedBy: editorId,
    createdAt: now,
    updatedAt: now,
  });
}

/** The memory graph and SQL triggers must retain full baselines, not just current blocks. */
export async function expectPresentationPackMediaConformance(input: {
  repository: Repository;
  workspaceId: string;
  editorId: string;
}) {
  const { repository, workspaceId, editorId } = input;
  const presentations = createPresentationRepository(repository);
  const packs = createRecoveryPackRepository(repository);
  const now = new Date();
  const originalIds = Array.from({ length: 3 }, () => randomUUID());
  const acceptedIds = Array.from({ length: 3 }, () => randomUUID());
  const localMediaId = randomUUID();
  for (const id of [...originalIds, ...acceptedIds, localMediaId]) {
    await createMedia(repository, workspaceId, id);
  }
  const originalContent = presentationPackContent(originalIds);
  const pack = await packs.createRecoveryPack(
    recoveryPackRecord(workspaceId, editorId, originalContent),
  );
  const sourceVersion = await packs.publishRecoveryPack(
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
  const draft = presentationPackMediaDraft(originalContent);
  const insertion = draft.recoveryPackInsertions![0]!;
  Object.assign(insertion, { packId: pack.id, packVersionId: sourceVersion.id });
  for (const block of draft.blocks) {
    if (block.kind === "question" && block.question.recoveryPackSource) {
      Object.assign(block.question.recoveryPackSource, {
        packId: pack.id,
        packVersionId: sourceVersion.id,
      });
    }
  }
  const presentation = await createPresentation(repository, workspaceId, editorId, draft);
  const acceptedContent = presentationPackContent(acceptedIds);
  await packs.updateRecoveryPackDraft({
    workspaceId,
    packId: pack.id,
    draft: acceptedContent,
    expectedRevision: 0,
    mutationId: randomUUID(),
    editorId,
    draftHash: "accepted-media-source",
  });
  const acceptedVersion = await packs.publishRecoveryPack(
    {
      id: randomUUID(),
      workspaceId,
      packId: pack.id,
      version: 2,
      content: acceptedContent,
      contentHash: recoveryPackContentHash(acceptedContent),
      sourceDraftRevision: 1,
      publishedAt: now,
    },
    1,
  );
  const updatedDraft: PresentationDraft = {
    ...draft,
    // Delete the copied diagnostic and replace the recheck's visible media locally.
    blocks: draft.blocks
      .slice(1)
      .map((block) =>
        block.kind === "question"
          ? { ...block, question: { ...block.question, mediaId: localMediaId, mediaAlt: "Local" } }
          : block,
      ),
    recoveryPackInsertions: [
      {
        ...insertion,
        updateBaseline: {
          packVersionId: acceptedVersion.id,
          packVersion: acceptedVersion.version,
          contentHash: acceptedVersion.contentHash,
          content: acceptedContent,
        },
      },
    ],
  };
  const updated = (await presentations.updatePresentationDraft({
    workspaceId,
    presentationId: presentation.id,
    draft: updatedDraft,
    expectedRevision: 0,
    mutationId: randomUUID(),
    editorId,
    draftHash: "accepted-baseline-and-local-media",
  }))!;
  expect(updated.draftSchemaVersion).toBe(3);
  expect(updated.draft.recoveryPackInsertions![0]!.originalContent).toEqual(originalContent);
  for (const mediaId of [...originalIds, ...acceptedIds]) {
    expect(await repository.listMediaReferences(workspaceId, mediaId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ownerType: "presentation_draft", ownerId: presentation.id }),
      ]),
    );
  }
  // Restore a valid linked pair before publication; the draft-only deletion above still
  // needs its complete frozen baselines for later restore/update review.
  const restoredDraft: PresentationDraft = {
    ...updatedDraft,
    blocks: draft.blocks.map((block) =>
      block.kind === "question" && block.question.delivery === "recheck"
        ? { ...block, question: { ...block.question, mediaId: localMediaId, mediaAlt: "Local" } }
        : block,
    ),
  };
  await presentations.updatePresentationDraft({
    workspaceId,
    presentationId: presentation.id,
    draft: restoredDraft,
    expectedRevision: 1,
    mutationId: randomUUID(),
    editorId,
    draftHash: "restore-diagnostic-for-publication",
  });
  const version = await presentations.publishPresentation(
    {
      id: randomUUID(),
      workspaceId,
      presentationId: presentation.id,
      version: 1,
      content: PresentationContentSchema.parse(restoredDraft),
      // Omitted storage metadata must infer embedded Pack schema 3, not ordinary schema 2.
      contentHash: "presentation-pack-snapshots",
      sourceDraftRevision: 2,
      publishedAt: now,
    },
    2,
  );
  expect(version.contentSchemaVersion).toBe(3);
  expect(await packs.deleteRecoveryPack(workspaceId, pack.id)).toBe(true);
  for (const mediaId of [...originalIds, ...acceptedIds, localMediaId]) {
    const references = await repository.listMediaReferences(workspaceId, mediaId);
    expect(references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ownerType: "presentation_draft", ownerId: presentation.id }),
        expect.objectContaining({ ownerType: "presentation_history" }),
        expect.objectContaining({ ownerType: "presentation_version", ownerId: version.id }),
      ]),
    );
    expect(references.some(({ ownerType }) => ownerType.startsWith("recovery_pack_"))).toBe(false);
    expect(await repository.claimMediaAssetDeletion(workspaceId, mediaId)).toBeNull();
    expect(await repository.deleteMediaAsset(workspaceId, mediaId)).toBe(false);
  }
  // Existing account exports use camelCase in memory and raw SQL names in PostgreSQL.
  const accountExport = await repository.exportAccount(editorId);
  expect(accountExport.presentationVersions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: version.id,
        content: expect.objectContaining({
          recoveryPackInsertions: updatedDraft.recoveryPackInsertions,
        }),
      }),
    ]),
  );
  const exportedReferences = accountExport.mediaReferences as Array<Record<string, unknown>>;
  expect(
    exportedReferences.map((reference) => ({
      mediaId: reference.mediaId ?? reference.media_id,
      ownerType: reference.ownerType ?? reference.owner_type,
    })),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ mediaId: originalIds[2], ownerType: "presentation_version" }),
      expect.objectContaining({ mediaId: acceptedIds[2], ownerType: "presentation_version" }),
    ]),
  );
  expect(
    (await presentations.getPresentationVersion(workspaceId, version.id))?.content
      .recoveryPackInsertions,
  ).toEqual(updatedDraft.recoveryPackInsertions);

  await presentations.updatePresentationDraft({
    workspaceId,
    presentationId: presentation.id,
    draft: { ...updatedDraft, schemaVersion: 2, blocks: [], recoveryPackInsertions: [] },
    expectedRevision: 2,
    mutationId: randomUUID(),
    editorId,
    draftHash: "remove-pack",
  });
  for (const mediaId of [...originalIds, ...acceptedIds, localMediaId]) {
    const retained = await repository.listMediaReferences(workspaceId, mediaId);
    expect(retained.some(({ ownerType }) => ownerType === "presentation_draft")).toBe(false);
    expect(retained.some(({ ownerType }) => ownerType === "presentation_history")).toBe(true);
    expect(retained.some(({ ownerType }) => ownerType === "presentation_version")).toBe(true);
  }
  await presentations.archivePresentation(workspaceId, presentation.id, true);
  expect(await presentations.deletePresentation(workspaceId, presentation.id)).toBe("deleted");
  for (const mediaId of [...originalIds, ...acceptedIds, localMediaId]) {
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
}

export async function expectPresentationPackInvalidMediaConformance(input: {
  repository: Repository;
  workspaceId: string;
  otherWorkspaceId: string;
  editorId: string;
}) {
  const { repository, workspaceId, otherWorkspaceId, editorId } = input;
  const presentations = createPresentationRepository(repository);
  const mediaIds = Array.from({ length: 3 }, () => randomUUID());
  for (const id of mediaIds) await createMedia(repository, workspaceId, id);
  const content = presentationPackContent(mediaIds);
  const valid = await createPresentation(
    repository,
    workspaceId,
    editorId,
    presentationPackMediaDraft(content),
  );
  const foreignId = randomUUID();
  await createMedia(repository, otherWorkspaceId, foreignId);
  const deletingId = randomUUID();
  await createMedia(repository, workspaceId, deletingId);
  expect(await repository.claimMediaAssetDeletion(workspaceId, deletingId)).not.toBeNull();
  for (const invalidId of [foreignId, randomUUID(), deletingId]) {
    const invalidContent = presentationPackContent([mediaIds[0]!, mediaIds[1]!, invalidId]);
    await expect(
      createPresentation(
        repository,
        workspaceId,
        editorId,
        presentationPackMediaDraft(invalidContent),
      ),
    ).rejects.toThrow(/unavailable in (?:this )?workspace/);
    const invalidDraft: PresentationDraft = {
      ...valid.draft,
      recoveryPackInsertions: valid.draft.recoveryPackInsertions!.map((insertion) => ({
        ...insertion,
        updateBaseline: {
          packVersionId: randomUUID(),
          packVersion: 2,
          contentHash: recoveryPackContentHash(invalidContent),
          content: invalidContent,
        },
      })),
    };
    await expect(
      presentations.updatePresentationDraft({
        workspaceId,
        presentationId: valid.id,
        draft: invalidDraft,
        expectedRevision: 0,
        mutationId: randomUUID(),
        editorId,
        draftHash: `invalid-baseline-${invalidId}`,
      }),
    ).rejects.toThrow(/unavailable in (?:this )?workspace/);
    const invalidVersionId = randomUUID();
    await expect(
      presentations.publishPresentation(
        {
          id: invalidVersionId,
          workspaceId,
          presentationId: valid.id,
          version: 1,
          content: PresentationContentSchema.parse(invalidDraft),
          contentHash: `invalid-version-${invalidId}`,
          sourceDraftRevision: 0,
          publishedAt: new Date(),
        },
        0,
      ),
    ).rejects.toThrow(/unavailable in (?:this )?workspace/);
    expect(await presentations.getPresentationVersion(workspaceId, invalidVersionId)).toBeNull();
  }
  expect(await presentations.getPresentation(workspaceId, valid.id)).toMatchObject({
    draftRevision: 0,
    draft: valid.draft,
    status: "draft",
    currentVersionId: null,
  });
  expect(await presentations.listPresentationHistory(workspaceId, valid.id)).toHaveLength(1);
  for (const mediaId of mediaIds) {
    expect(await repository.listMediaReferences(workspaceId, mediaId)).toHaveLength(2);
  }
  expect(await repository.listMediaReferences(workspaceId, foreignId)).toEqual([]);
  expect(await repository.listMediaReferences(workspaceId, deletingId)).toEqual([]);
  await repository.deleteAccount(editorId);
  expect(await presentations.getPresentation(workspaceId, valid.id)).toBeNull();
  expect(await repository.listMediaReferences(workspaceId)).toEqual([]);
  for (const mediaId of mediaIds) {
    expect(await repository.getMediaAsset(workspaceId, mediaId)).toBeNull();
  }
  expect(await repository.getMediaAsset(otherWorkspaceId, foreignId)).not.toBeNull();
}

export async function expectPresentationPackHistoryMediaConformance(input: {
  repository: Repository;
  workspaceId: string;
  editorId: string;
}) {
  const { repository, workspaceId, editorId } = input;
  const presentations = createPresentationRepository(repository);
  const mediaId = randomUUID();
  await createMedia(repository, workspaceId, mediaId);
  const draft = presentationPackMediaDraft(presentationPackContent([mediaId, mediaId, mediaId]));
  const presentation = await createPresentation(repository, workspaceId, editorId, draft);
  const cleared: PresentationDraft = {
    ...draft,
    schemaVersion: 2,
    blocks: [],
    recoveryPackInsertions: [],
  };
  for (let expectedRevision = 0; expectedRevision < 20; expectedRevision += 1) {
    await presentations.updatePresentationDraft({
      workspaceId,
      presentationId: presentation.id,
      draft: { ...cleared, title: `History revision ${expectedRevision + 1}` },
      expectedRevision,
      mutationId: randomUUID(),
      editorId,
      draftHash: `history-${expectedRevision + 1}`,
    });
    if (expectedRevision === 0) {
      expect(await repository.listMediaReferences(workspaceId, mediaId)).toMatchObject([
        { ownerType: "presentation_history" },
      ]);
    }
  }
  const history = await presentations.listPresentationHistory(workspaceId, presentation.id);
  expect(history).toHaveLength(20);
  expect(history.at(-1)?.revision).toBe(1);
  expect(await repository.listMediaReferences(workspaceId, mediaId)).toEqual([]);
  expect(await repository.claimMediaAssetDeletion(workspaceId, mediaId)).not.toBeNull();
}

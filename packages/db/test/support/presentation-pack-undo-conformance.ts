import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { recoveryPackContentHash, type PresentationDraft } from "@openround/contracts";
import {
  createPresentationRepository,
  PresentationDraftConflictError,
  PresentationMutationConflictError,
  type PresentationDraftUpdate,
  type PresentationRecord,
  type PresentationRepository,
  type Repository,
} from "../../src/index.js";
import {
  presentationPackContent,
  presentationPackMediaDraft,
} from "./presentation-pack-media-conformance.js";

export function presentationPackUndoRecord(
  workspaceId: string,
  editorId: string,
  draft: PresentationDraft,
  createdAt = new Date(),
): PresentationRecord {
  return {
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
    createdAt,
    updatedAt: createdAt,
  };
}

function plainDraft(): PresentationDraft {
  return {
    title: "Before Pack update",
    description: "",
    experiencePreset: { id: "focus", version: 1 },
    schemaVersion: 2,
    blocks: [],
  };
}

/** Receipt identity, tenant scoping, retained media, and fenced Undo match on both backends. */
export async function expectPresentationPackUndoConformance(input: {
  repository: Repository;
  workspaceId: string;
  otherWorkspaceId: string;
  editorId: string;
}) {
  const { repository, workspaceId, otherWorkspaceId, editorId } = input;
  const presentations = createPresentationRepository(repository);
  const oldDate = new Date(Date.now() - 31 * 86_400_000);
  const originalIds = Array.from({ length: 3 }, () => randomUUID());
  const acceptedIds = Array.from({ length: 3 }, () => randomUUID());
  const localMediaId = randomUUID();
  for (const id of [...originalIds, ...acceptedIds, localMediaId]) {
    await repository.createMediaAsset({
      id,
      workspaceId,
      objectKey: `media/${workspaceId}/${id}.png`,
      mimeType: "image/png",
      sizeBytes: 10,
      scanStatus: "clean",
      altText: "Pack undo diagram",
      createdAt: oldDate,
    });
  }
  const original = presentationPackMediaDraft(presentationPackContent(originalIds));
  const originalBlock = original.blocks[0]!;
  if (originalBlock.kind !== "question") throw new Error("Expected Pack diagnostic fixture");
  originalBlock.question.mediaId = localMediaId;
  originalBlock.question.mediaAlt = "Local diagram before accepted update";
  const presentation = await presentations.createPresentation(
    presentationPackUndoRecord(workspaceId, editorId, original, oldDate),
  );
  const changed = structuredClone(presentation.draft);
  changed.title = "After Pack update";
  const changedBlock = changed.blocks[0]!;
  if (changedBlock.kind !== "question") throw new Error("Expected Pack diagnostic fixture");
  changedBlock.question.mediaId = null;
  changedBlock.question.mediaAlt = null;
  const acceptedContent = presentationPackContent(acceptedIds);
  changed.recoveryPackInsertions![0]!.updateBaseline = {
    packVersionId: randomUUID(),
    packVersion: 2,
    contentHash: recoveryPackContentHash(acceptedContent),
    content: acceptedContent,
  };
  const apply: PresentationDraftUpdate = {
    workspaceId,
    presentationId: presentation.id,
    draft: changed,
    expectedRevision: 0,
    mutationId: randomUUID(),
    editorId,
    draftHash: "accepted-pack-update",
    recoveryPackUpdateSourceRevision: 0,
  };
  expect(await presentations.updatePresentationDraft(apply)).toMatchObject({
    draftRevision: 1,
    draft: changed,
  });
  const history = await presentations.listPresentationHistory(workspaceId, presentation.id);
  expect(history.map(({ revision }) => revision)).toEqual([1, 0]);
  const source = history.find(({ revision }) => revision === 0)!;
  expect(source.createdAt).toEqual(oldDate);
  expect(await repository.claimMediaAssetDeletion(workspaceId, localMediaId)).toBeNull();
  expect(await repository.deleteMediaAsset(workspaceId, localMediaId)).toBe(false);
  expect(await repository.listMediaReferences(workspaceId, localMediaId)).toEqual([
    expect.objectContaining({ ownerType: "presentation_history", ownerId: source.id }),
  ]);
  for (const id of acceptedIds) {
    expect(await repository.listMediaReferences(workspaceId, id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ownerType: "presentation_draft", ownerId: presentation.id }),
        expect.objectContaining({ ownerType: "presentation_history", ownerId: history[0]!.id }),
      ]),
    );
  }

  expect(await presentations.updatePresentationDraft(apply)).toMatchObject({ draftRevision: 1 });
  for (const recoveryPackUpdateSourceRevision of [undefined, null, 1]) {
    await expect(
      presentations.updatePresentationDraft({ ...apply, recoveryPackUpdateSourceRevision }),
    ).rejects.toBeInstanceOf(PresentationMutationConflictError);
  }
  for (const recoveryPackUpdateSourceRevision of [
    -1,
    0.5,
    Number.MAX_SAFE_INTEGER + 1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    0,
  ]) {
    await expect(
      presentations.updatePresentationDraft({
        ...apply,
        expectedRevision: 1,
        draft: { ...changed, title: "Invalid metadata" },
        recoveryPackUpdateSourceRevision,
        mutationId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(PresentationMutationConflictError);
  }
  await expect(
    presentations.updatePresentationDraft({
      ...apply,
      expectedRevision: 1,
      recoveryPackUpdateSourceRevision: 1,
      mutationId: randomUUID(),
    }),
  ).rejects.toBeInstanceOf(PresentationMutationConflictError);
  expect(await presentations.getPresentation(otherWorkspaceId, presentation.id)).toBeNull();
  expect(await presentations.listPresentationHistory(otherWorkspaceId, presentation.id)).toEqual(
    [],
  );
  expect(
    await presentations.updatePresentationDraft({ ...apply, workspaceId: otherWorkspaceId }),
  ).toBeNull();

  const undo = {
    workspaceId,
    presentationId: presentation.id,
    historyRevision: 0,
    expectedRevision: 1,
    mutationId: randomUUID(),
    editorId,
  };
  expect(
    await presentations.restorePresentationHistory({ ...undo, workspaceId: otherWorkspaceId }),
  ).toBeNull();
  expect(await presentations.restorePresentationHistory(undo)).toMatchObject({
    draftRevision: 2,
    draft: presentation.draft,
  });
  expect(await presentations.restorePresentationHistory(undo)).toMatchObject({ draftRevision: 2 });
  expect(
    (await presentations.listPresentationHistory(workspaceId, presentation.id)).map(
      ({ revision }) => revision,
    ),
  ).not.toContain(0);
  expect(await repository.listMediaReferences(workspaceId, localMediaId)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ ownerType: "presentation_draft", ownerId: presentation.id }),
    ]),
  );

  const fresh = await presentations.createPresentation(
    presentationPackUndoRecord(workspaceId, editorId, plainDraft()),
  );
  const freshApply = {
    ...apply,
    presentationId: fresh.id,
    draft: { ...fresh.draft, title: "Fresh Pack update" },
    mutationId: randomUUID(),
  };
  await presentations.updatePresentationDraft(freshApply);
  const noOp = {
    ...freshApply,
    expectedRevision: 1,
    recoveryPackUpdateSourceRevision: null,
    mutationId: randomUUID(),
  };
  expect(await presentations.updatePresentationDraft(noOp)).toMatchObject({ draftRevision: 1 });
  expect(
    await presentations.updatePresentationDraft({
      ...noOp,
      recoveryPackUpdateSourceRevision: undefined,
    }),
  ).toMatchObject({ draftRevision: 1 });
  await expect(
    presentations.updatePresentationDraft({ ...noOp, recoveryPackUpdateSourceRevision: 1 }),
  ).rejects.toBeInstanceOf(PresentationMutationConflictError);
  await presentations.updatePresentationDraft({
    ...noOp,
    draft: { ...noOp.draft, title: "Unrelated edit" },
    mutationId: randomUUID(),
    draftHash: "unrelated-edit",
  });
  await expect(
    presentations.restorePresentationHistory({
      ...undo,
      presentationId: fresh.id,
      mutationId: randomUUID(),
    }),
  ).rejects.toBeInstanceOf(PresentationDraftConflictError);
  expect((await presentations.getPresentation(workspaceId, fresh.id))?.draft.title).toBe(
    "Unrelated edit",
  );
  const collision = {
    ...freshApply,
    draft: { ...freshApply.draft, title: "Pack update with restore-looking hash" },
    expectedRevision: 2,
    recoveryPackUpdateSourceRevision: 2,
    mutationId: randomUUID(),
    draftHash: "restore:0",
  };
  await presentations.updatePresentationDraft(collision);
  await expect(
    presentations.restorePresentationHistory({
      ...undo,
      presentationId: fresh.id,
      expectedRevision: 2,
      mutationId: collision.mutationId,
    }),
  ).rejects.toBeInstanceOf(PresentationMutationConflictError);
  await expect(
    presentations.updatePresentationDraft({ ...apply, presentationId: fresh.id }),
  ).rejects.toBeInstanceOf(PresentationMutationConflictError);

  const old = await presentations.createPresentation(
    presentationPackUndoRecord(workspaceId, editorId, plainDraft(), oldDate),
  );
  const oldApply = {
    ...apply,
    presentationId: old.id,
    draft: { ...old.draft, title: "Old source updated" },
    mutationId: randomUUID(),
  };
  await presentations.updatePresentationDraft(oldApply);
  await presentations.updatePresentationDraft({
    ...oldApply,
    expectedRevision: 1,
    recoveryPackUpdateSourceRevision: null,
    mutationId: randomUUID(),
  });
  expect(
    (await presentations.listPresentationHistory(workspaceId, old.id)).map(
      ({ revision }) => revision,
    ),
  ).toEqual([1, 0]);
  await presentations.updatePresentationDraft({
    ...oldApply,
    draft: { ...oldApply.draft, title: "Later ordinary edit" },
    expectedRevision: 1,
    recoveryPackUpdateSourceRevision: null,
    mutationId: randomUUID(),
  });
  expect(
    (await presentations.listPresentationHistory(workspaceId, old.id)).map(
      ({ revision }) => revision,
    ),
  ).toEqual([2, 1]);
}

export interface PresentationPackUndoRetentionHarness {
  /** Seed imported future history so the current source lies outside the latest twenty. */
  ageReceiptAndOverflowHistory(
    presentation: PresentationRecord,
    mutationIds: string[],
  ): Promise<void>;
  /** Run the backend's real retention implementation twice without advancing its draft. */
  prune(presentationId: string): Promise<void>;
  historyRevisions(presentationId: string): Promise<number[]>;
  receiptSource(mutationId: string): Promise<number | null | undefined>;
}

/** Stress retention with aged receipts and out-of-window sources, then restore by exact revision. */
export async function expectPresentationPackUndoRetentionConformance(input: {
  presentations: PresentationRepository;
  workspaceId: string;
  editorId: string;
  harness: PresentationPackUndoRetentionHarness;
}) {
  const { presentations, workspaceId, editorId, harness } = input;
  const oldDate = new Date(Date.now() - 31 * 86_400_000);
  const original = await presentations.createPresentation(
    presentationPackUndoRecord(workspaceId, editorId, plainDraft(), oldDate),
  );
  const apply: PresentationDraftUpdate = {
    workspaceId,
    presentationId: original.id,
    draft: { ...original.draft, title: "Protected Pack update" },
    expectedRevision: 0,
    mutationId: randomUUID(),
    editorId,
    draftHash: "protected-update",
    recoveryPackUpdateSourceRevision: 0,
  };
  const current = (await presentations.updatePresentationDraft(apply))!;
  const ordinaryNoOp = {
    ...apply,
    expectedRevision: 1,
    mutationId: randomUUID(),
    recoveryPackUpdateSourceRevision: null,
  };
  await presentations.updatePresentationDraft(ordinaryNoOp);
  await harness.ageReceiptAndOverflowHistory(current, [apply.mutationId, ordinaryNoOp.mutationId]);
  await harness.prune(original.id);
  await harness.prune(original.id);
  expect((await harness.historyRevisions(original.id)).sort((a, b) => a - b)).toEqual([
    0,
    ...Array.from({ length: 20 }, (_, index) => 105 + index),
  ]);
  expect(await harness.receiptSource(apply.mutationId)).toBe(0);
  expect(await harness.receiptSource(ordinaryNoOp.mutationId)).toBeUndefined();
  const listed = await presentations.listPresentationHistory(workspaceId, original.id);
  expect(listed).toHaveLength(20);
  expect(listed.map(({ revision }) => revision)).not.toContain(0);
  expect(await presentations.updatePresentationDraft(apply)).toMatchObject({ draftRevision: 1 });
  const undo = {
    workspaceId,
    presentationId: original.id,
    historyRevision: 0,
    expectedRevision: 1,
    mutationId: randomUUID(),
    editorId,
  };
  expect(await presentations.restorePresentationHistory(undo)).toMatchObject({
    draftRevision: 2,
    draft: original.draft,
  });
  expect(await presentations.restorePresentationHistory(undo)).toMatchObject({ draftRevision: 2 });
  expect(await harness.historyRevisions(original.id)).toHaveLength(20);
  expect(await harness.historyRevisions(original.id)).not.toContain(0);
  expect(await harness.receiptSource(apply.mutationId)).toBeUndefined();
}

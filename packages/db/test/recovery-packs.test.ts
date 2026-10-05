import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { RecoveryPackContentSchema, type QuestionDraft } from "@openround/contracts";
import {
  createRecoveryPackRepository,
  MemoryRepository,
  UnsupportedArtifactSchemaVersionError,
  upcastRecoveryPackContent,
  upcastRecoveryPackDraft,
  WorkspaceDeletionInProgressError,
  type Repository,
} from "../src/index.js";
import {
  expectRecoveryPackRepositoryConformance,
  recoveryPackDraft,
  recoveryPackRecord,
} from "./support/recovery-pack-conformance.js";
import { expectRecoveryPackUpdateMediaConformance } from "./support/recovery-pack-update-media-conformance.js";

async function creator(repository: MemoryRepository) {
  const tokenHash = randomUUID();
  await repository.createMagicToken({
    id: randomUUID(),
    email: `${randomUUID()}@example.com`,
    segment: "education",
    tokenHash,
    policyVersion: "test-v1",
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  });
  return (await repository.consumeMagicToken(tokenHash, new Date()))!;
}

describe("Recovery Pack repositories", () => {
  it("retains updated probe-only media across source deletion and immutable Round copies", async () => {
    const repository = new MemoryRepository();
    const owner = await creator(repository);
    await expectRecoveryPackUpdateMediaConformance({
      repository,
      workspaceId: owner.workspaceId,
      editorId: owner.userId,
    });
  });

  it("drains in-flight creations before account cleanup and fences queued/stale writes", async () => {
    const repository = new MemoryRepository();
    const packs = createRecoveryPackRepository(repository);
    const owner = await creator(repository);
    const pending = packs.createRecoveryPack(recoveryPackRecord(owner.workspaceId, owner.userId));
    // The creation has acquired its lock but has not installed the parent/history yet.
    await Promise.resolve();
    await repository.claimWorkspaceMediaDeletion(owner.workspaceId);
    await repository.deleteAccount(owner.userId);
    await pending;
    expect(repository.workspaces.has(owner.workspaceId)).toBe(false);
    expect(await packs.listRecoveryPacks(owner.workspaceId)).toEqual([]);
    expect(await repository.listMediaReferences(owner.workspaceId)).toEqual([]);
    await expect(
      packs.createRecoveryPack(recoveryPackRecord(owner.workspaceId, owner.userId)),
    ).rejects.toBeInstanceOf(WorkspaceDeletionInProgressError);
  });
  it("fences new writes during workspace deletion while retaining reads, mutation replay and removal", async () => {
    const repository = new MemoryRepository();
    const packs = createRecoveryPackRepository(repository);
    const owner = await creator(repository);
    const initial = await packs.createRecoveryPack(
      recoveryPackRecord(owner.workspaceId, owner.userId),
    );
    const mutation = {
      workspaceId: owner.workspaceId,
      packId: initial.id,
      draft: { ...initial.draft, title: "Saved" },
      expectedRevision: 0,
      mutationId: randomUUID(),
      editorId: owner.userId,
      draftHash: "saved",
    };
    const saved = (await packs.updateRecoveryPackDraft(mutation))!;
    await repository.claimWorkspaceMediaDeletion(owner.workspaceId);
    await expect(
      packs.createRecoveryPack(recoveryPackRecord(owner.workspaceId, owner.userId)),
    ).rejects.toBeInstanceOf(WorkspaceDeletionInProgressError);
    await expect(
      packs.updateRecoveryPackDraft({
        ...mutation,
        draft: { ...saved.draft, title: "Blocked" },
        expectedRevision: 1,
        mutationId: randomUUID(),
        draftHash: "blocked",
      }),
    ).rejects.toBeInstanceOf(WorkspaceDeletionInProgressError);
    await expect(
      packs.publishRecoveryPack(
        {
          id: randomUUID(),
          workspaceId: owner.workspaceId,
          packId: initial.id,
          version: 1,
          content: RecoveryPackContentSchema.parse(saved.draft),
          contentHash: "saved",
          sourceDraftRevision: 1,
          publishedAt: new Date(),
        },
        1,
      ),
    ).rejects.toBeInstanceOf(WorkspaceDeletionInProgressError);
    expect(await packs.replayRecoveryPackMutation(mutation)).toMatchObject({ draftRevision: 1 });
    expect(await packs.updateRecoveryPackDraft(mutation)).toMatchObject({ draftRevision: 1 });
    expect(await packs.getRecoveryPack(owner.workspaceId, initial.id)).toMatchObject({
      draftRevision: 1,
    });
    expect(await packs.deleteRecoveryPack(owner.workspaceId, initial.id)).toBe(true);
  });
  it("preserves tenant boundaries, CAS, original mutation results and immutable version ordering", async () => {
    const repository = new MemoryRepository();
    await expectRecoveryPackRepositoryConformance({
      repository: createRecoveryPackRepository(repository),
      workspaceId: randomUUID(),
      otherWorkspaceId: randomUUID(),
      editorId: randomUUID(),
    });
  });

  it("reuses the lifecycle extension and fails closed for unsupported repositories", () => {
    const repository = new MemoryRepository();
    expect(createRecoveryPackRepository(repository)).toBe(createRecoveryPackRepository(repository));
    expect(() => createRecoveryPackRepository({} as Repository)).toThrow("supported");
  });

  it("validates schema versions while preserving incomplete drafts", () => {
    const draft = { ...recoveryPackDraft(), interventions: [] };
    expect(upcastRecoveryPackDraft(draft, 1)).toMatchObject({ interventions: [] });
    expect(() => upcastRecoveryPackContent(draft, 1)).toThrow();
    expect(() => upcastRecoveryPackDraft(draft, 2)).toThrow(UnsupportedArtifactSchemaVersionError);
    expect(() => upcastRecoveryPackContent(draft, "1")).toThrow(
      UnsupportedArtifactSchemaVersionError,
    );
  });

  it("keeps source snapshots and mutation media referenced, and exports and deletes Pack data", async () => {
    const repository = new MemoryRepository();
    const packs = createRecoveryPackRepository(repository);
    const owner = await creator(repository);
    const mediaId = randomUUID();
    const now = new Date();
    await repository.createMediaAsset({
      id: mediaId,
      workspaceId: owner.workspaceId,
      objectKey: `media/${mediaId}.png`,
      mimeType: "image/png",
      sizeBytes: 10,
      scanStatus: "clean",
      altText: "Diagram",
      createdAt: now,
    });
    const draft = recoveryPackDraft();
    const probe: QuestionDraft = {
      ...draft.diagnostic,
      id: randomUUID(),
      prompt: "Apply this idea again next week",
      delivery: "main",
      linkedRecheckQuestionId: null,
      mediaId,
      mediaAlt: "Diagram for the delayed probe",
    };
    draft.delayedProbe = probe;
    const pack = await packs.createRecoveryPack(
      recoveryPackRecord(owner.workspaceId, owner.userId, draft),
    );
    const content = RecoveryPackContentSchema.parse(draft);
    const contentHash = createHash("sha256").update(JSON.stringify(content)).digest("hex");
    const version = await packs.publishRecoveryPack(
      {
        id: randomUUID(),
        workspaceId: owner.workspaceId,
        packId: pack.id,
        version: 1,
        content,
        contentHash,
        sourceDraftRevision: 0,
        publishedAt: now,
      },
      0,
    );
    const quiz = await repository.createQuiz({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      title: "Destination",
      description: "",
      status: "draft",
      draft: {
        title: "Destination",
        description: "",
        questions: [draft.diagnostic, draft.recheck],
        recoveryPackInsertions: [
          {
            id: randomUUID(),
            packId: pack.id,
            packVersionId: version.id,
            packVersion: version.version,
            contentHash,
            diagnosticQuestionId: draft.diagnostic.id,
            recheckQuestionId: draft.recheck.id,
            originalContent: content,
          },
        ],
      },
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    expect(
      (await repository.listMediaReferences(owner.workspaceId, mediaId)).map(
        (item) => item.ownerType,
      ),
    ).toEqual(
      expect.arrayContaining([
        "recovery_pack_draft",
        "recovery_pack_version",
        "recovery_pack_history",
        "quiz_draft",
        "quiz_history",
      ]),
    );
    const exported = await repository.exportAccount(owner.userId);
    expect(exported.recoveryPacks).toHaveLength(1);
    expect(exported.recoveryPackVersions).toHaveLength(1);
    expect(exported.recoveryPackDraftHistory).toHaveLength(1);
    await packs.deleteRecoveryPack(owner.workspaceId, pack.id);
    expect(
      (await repository.getQuiz(owner.workspaceId, quiz.id))?.draft.recoveryPackInsertions?.[0]
        ?.originalContent,
    ).toEqual(content);
    expect(await repository.deleteMediaAsset(owner.workspaceId, mediaId)).toBe(false);

    const receiptPack = await packs.createRecoveryPack(
      recoveryPackRecord(owner.workspaceId, owner.userId, draft),
    );
    const mutationId = randomUUID();
    await packs.updateRecoveryPackDraft({
      workspaceId: owner.workspaceId,
      packId: receiptPack.id,
      draft: { ...draft, title: "Acknowledged media" },
      expectedRevision: 0,
      mutationId,
      editorId: owner.userId,
      draftHash: "with-media",
    });
    expect(await repository.listMediaReferences(owner.workspaceId, mediaId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ownerType: "recovery_pack_mutation", ownerId: mutationId }),
      ]),
    );
    await repository.purgeExpired(new Date(now.getTime() + 31 * 86_400_000));
    expect(
      (await repository.listMediaReferences(owner.workspaceId, mediaId)).some(
        (item) => item.ownerType === "recovery_pack_mutation",
      ),
    ).toBe(false);
    expect(await packs.listRecoveryPackHistory(owner.workspaceId, receiptPack.id)).toEqual([]);
    await repository.deleteAccount(owner.userId);
    expect(await packs.listRecoveryPacks(owner.workspaceId)).toEqual([]);
    expect(await repository.listMediaReferences(owner.workspaceId)).toEqual([]);
  });

  it("allows pending media drafts but rejects publishing or cross-workspace media", async () => {
    const repository = new MemoryRepository();
    const packs = createRecoveryPackRepository(repository);
    const workspaceId = randomUUID();
    const mediaId = randomUUID();
    await repository.createMediaAsset({
      id: mediaId,
      workspaceId,
      objectKey: `media/${mediaId}.png`,
      mimeType: "image/png",
      sizeBytes: 10,
      scanStatus: "pending",
      altText: "Diagram",
      createdAt: new Date(),
    });
    const draft = recoveryPackDraft();
    draft.diagnostic.mediaId = mediaId;
    draft.diagnostic.mediaAlt = "Pending diagram";
    const pack = await packs.createRecoveryPack(
      recoveryPackRecord(workspaceId, randomUUID(), draft),
    );
    const content = RecoveryPackContentSchema.parse(draft);
    await expect(
      packs.publishRecoveryPack(
        {
          id: randomUUID(),
          workspaceId,
          packId: pack.id,
          version: 1,
          content,
          contentHash: "pending",
          sourceDraftRevision: 0,
          publishedAt: new Date(),
        },
        0,
      ),
    ).rejects.toThrow("clean");
    await expect(
      packs.createRecoveryPack(recoveryPackRecord(randomUUID(), randomUUID(), draft)),
    ).rejects.toThrow("unavailable");
    expect((await packs.getRecoveryPack(workspaceId, pack.id))?.currentVersionId).toBeNull();
  });
});

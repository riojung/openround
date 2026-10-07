import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  MemoryRepository,
  WorkspaceDeletionInProgressError,
  type ProductEventRecord,
} from "../src/index.js";
import {
  expectRecoveryPackPracticeConformance,
  expectRecoveryPackPracticeMediaLifecycle,
  packPracticeFixture,
} from "./support/recovery-pack-practice-conformance.js";

async function creator(repository: MemoryRepository) {
  const tokenHash = randomUUID();
  await repository.createMagicToken({
    id: randomUUID(),
    email: `${randomUUID()}@example.com`,
    segment: "education",
    tokenHash,
    policyVersion: "test",
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  });
  return (await repository.consumeMagicToken(tokenHash, new Date()))!;
}

async function mediaFixture(repository: MemoryRepository) {
  const owner = await creator(repository);
  const mediaId = randomUUID();
  await repository.createMediaAsset({
    id: mediaId,
    workspaceId: owner.workspaceId,
    objectKey: `media/${owner.workspaceId}/${mediaId}.png`,
    mimeType: "image/png",
    sizeBytes: 10,
    scanStatus: "clean",
    altText: "Delayed fraction diagram",
    createdAt: new Date(),
  });
  return {
    owner,
    mediaId,
    ...(await packPracticeFixture(repository, owner.workspaceId, owner.userId, mediaId)),
  };
}

async function expectNoCreation(
  repository: MemoryRepository,
  f: Awaited<ReturnType<typeof mediaFixture>>,
) {
  expect(await repository.getFollowup(f.owner.workspaceId, f.input.id)).toBeNull();
  expect(await repository.listFollowupAccess(f.owner.workspaceId, f.input.id)).toEqual([]);
  expect(
    await repository.getRecoveryPackPracticeAssignment(
      f.owner.workspaceId,
      f.pack.id,
      f.input.creationMutation!.mutationId,
      f.input.creationMutation!.requestHash,
    ),
  ).toBeNull();
  expect(
    (await repository.listMediaReferences(f.owner.workspaceId, f.mediaId)).filter(
      ({ ownerType }) => ownerType === "followup",
    ),
  ).toEqual([]);
  expect(repository.audits.filter(({ targetId }) => targetId === f.input.id)).toEqual([]);
  expect(
    repository.productEvents.filter(
      ({ workspaceId, name }) =>
        workspaceId === f.owner.workspaceId && name === "practice_assignment_created",
    ),
  ).toEqual([]);
}

describe("Recovery Pack practice persistence", () => {
  it("freezes direct Pack practice, fences current-version creation and replays concurrent/mismatched intents", async () => {
    const repository = new MemoryRepository();
    const owner = await creator(repository);
    const other = await creator(repository);
    await expectRecoveryPackPracticeConformance(
      repository,
      owner.workspaceId,
      other.workspaceId,
      owner.userId,
    );
    expect(
      repository.productEvents.filter(
        ({ workspaceId, name }) =>
          workspaceId === owner.workspaceId && name === "practice_assignment_created",
      ),
    ).toHaveLength(1);
  });
  it.each(["recordAudit", "recordProductEvents"] as const)(
    "publishes no partial assignment when %s fails and allows an exact retry",
    async (method) => {
      const repository = new MemoryRepository();
      const f = await mediaFixture(repository);
      const spy = vi.spyOn(repository, method).mockRejectedValueOnce(new Error("evidence failed"));
      await expect(
        repository.createRecoveryPackPracticeAssignment(f.pack.id, f.input, f.access, f.context),
      ).rejects.toThrow("evidence failed");
      await expectNoCreation(repository, f);
      spy.mockRestore();

      const created = await repository.createRecoveryPackPracticeAssignment(
        f.pack.id,
        f.input,
        f.access,
        f.context,
      );
      expect(created).toMatchObject({ created: true, followup: { id: f.input.id } });
      expect(created!.productEvent).not.toBeNull();
      expect(repository.audits.filter(({ targetId }) => targetId === f.input.id)).toHaveLength(1);
      expect(repository.productEvents).toEqual([created!.productEvent]);
      expect(await repository.listFollowupAccess(f.owner.workspaceId, f.input.id)).toHaveLength(1);
      expect(
        (await repository.listMediaReferences(f.owner.workspaceId, f.mediaId)).filter(
          ({ ownerType }) => ownerType === "followup",
        ),
      ).toHaveLength(1);
      expect(
        await repository.createRecoveryPackPracticeAssignment(f.pack.id, f.input, f.access, {
          requestId: randomUUID(),
        }),
      ).toMatchObject({ created: false, productEvent: null });
      expect(repository.productEvents).toHaveLength(1);
      expect(repository.audits.filter(({ targetId }) => targetId === f.input.id)).toHaveLength(1);
    },
  );
  it("keeps a pending receipt invisible and preserves unrelated concurrent workspace evidence on rollback", async () => {
    const repository = new MemoryRepository();
    const f = await mediaFixture(repository);
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    const started = new Promise<void>((resolve) => (entered = resolve));
    vi.spyOn(repository, "recordProductEvents").mockImplementationOnce(async () => {
      entered();
      await pending;
      throw new Error("event insert failed");
    });
    const creation = repository
      .createRecoveryPackPracticeAssignment(f.pack.id, f.input, f.access, f.context)
      .then(
        () => null,
        (error: unknown) => error,
      );
    await started;
    await expectNoCreation(repository, f);

    const requestId = randomUUID();
    await repository.recordAudit({
      workspaceId: f.owner.workspaceId,
      actorId: f.owner.userId,
      action: "workspace.concurrent.read",
      targetType: "workspace",
      targetId: f.owner.workspaceId,
      requestId,
      metadata: {},
    });
    const now = new Date();
    const unrelated: ProductEventRecord = {
      id: randomUUID(),
      workspaceId: f.owner.workspaceId,
      name: "report_viewed",
      occurredAt: now.toISOString(),
      dimensions: { betaVersion: "p0-2026" },
      createdAt: now,
      expiresAt: new Date(now.getTime() + 30 * 86_400_000),
    };
    await repository.recordProductEvents([unrelated]);
    release();
    expect(await creation).toMatchObject({ message: "event insert failed" });
    await expectNoCreation(repository, f);
    expect(repository.audits.filter((audit) => audit.requestId === requestId)).toHaveLength(1);
    expect(repository.productEvents).toEqual([unrelated]);

    const created = await repository.createRecoveryPackPracticeAssignment(
      f.pack.id,
      f.input,
      f.access,
      f.context,
    );
    expect(created!.created).toBe(true);
    expect(repository.productEvents).toEqual([unrelated, created!.productEvent]);
  });
  it("retains frozen source media after Pack deletion until assignment expiry", async () => {
    const repository = new MemoryRepository();
    const owner = await creator(repository);
    await expectRecoveryPackPracticeMediaLifecycle(repository, owner.workspaceId, owner.userId);
  });
  it("allows receipt replay during workspace deletion but fences new writes and deletes the assignment tree", async () => {
    const repository = new MemoryRepository();
    const owner = await creator(repository);
    const f = await packPracticeFixture(repository, owner.workspaceId, owner.userId);
    const created = await repository.createRecoveryPackPracticeAssignment(
      f.pack.id,
      f.input,
      f.access,
      f.context,
    );
    const saved = created!.followup;
    await repository.claimWorkspaceMediaDeletion(owner.workspaceId);
    expect(
      (await repository.createRecoveryPackPracticeAssignment(
        f.pack.id,
        f.input,
        f.access,
        f.context,
      ))!.followup.id,
    ).toBe(saved!.id);
    await expect(
      repository.createRecoveryPackPracticeAssignment(
        f.pack.id,
        {
          ...f.input,
          id: randomUUID(),
          creationMutation: { mutationId: randomUUID(), requestHash: "d".repeat(64) },
        },
        [],
        f.context,
      ),
    ).rejects.toBeInstanceOf(WorkspaceDeletionInProgressError);
    await repository.deleteAccount(owner.userId);
    expect(await repository.getFollowup(owner.workspaceId, saved!.id)).toBeNull();
    expect(await repository.listFollowupAccess(owner.workspaceId, saved!.id)).toEqual([]);
    expect(
      await repository.getRecoveryPackPracticeAssignment(
        owner.workspaceId,
        f.pack.id,
        f.input.creationMutation!.mutationId,
        f.input.creationMutation!.requestHash,
      ),
    ).toBeNull();
  });
});

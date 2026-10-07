import { createHash, randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  RecoveryPackContentSchema,
  recoveryPackContentHash,
  type RecoveryPackContent,
} from "@openround/contracts";
import {
  createRecoveryPackRepository,
  RecoveryPackPracticeAssignmentConflictError,
  type Repository,
  type FollowupRecord,
  type FollowupAccessRecord,
  type RecoveryPackVersionRecord,
} from "../../src/index.js";
import { recoveryPackDraft, recoveryPackRecord } from "./recovery-pack-conformance.js";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function packPracticeInput(
  workspaceId: string,
  editorId: string,
  version: RecoveryPackVersionRecord,
) {
  const now = new Date();
  const sourceProbe = version.content.delayedProbe ?? {
    ...version.content.diagnostic,
    linkedRecheckQuestionId: null,
  };
  const probe = structuredClone(sourceProbe);
  probe.id = randomUUID();
  probe.delivery = "main";
  probe.linkedRecheckQuestionId = null;
  if ("choices" in probe)
    probe.choices = probe.choices.map((choice) => ({ ...choice, id: randomUUID() }));
  probe.recoveryPackSource = {
    artifactType: "recovery_pack",
    packId: version.packId,
    packVersionId: version.id,
    packVersion: version.version,
    sourceItemId: sourceProbe.id,
    role: "delayed_probe",
    contentHash: hash(sourceProbe),
  };
  const input: Extract<FollowupRecord, { purpose: "assignment" }> = {
    id: randomUUID(),
    workspaceId,
    purpose: "assignment",
    sourceQuizVersionId: null,
    sourceSessionId: null,
    sourceReportId: null,
    recoveryPackSource: {
      artifactType: "recovery_pack",
      packId: version.packId,
      packVersionId: version.id,
      packVersion: version.version,
      contentHash: version.contentHash,
      packTitle: version.content.title,
      publishedAt: version.publishedAt.toISOString(),
      sourceItemId: sourceProbe.id,
      role: "delayed_probe",
    },
    creationMutation: { mutationId: randomUUID(), requestHash: hash(randomUUID()) },
    title: "Frozen fraction practice",
    content: { title: "Frozen fraction practice", description: "", questions: [probe] },
    conceptKeys: [],
    timeMode: "flex",
    genericTokenHash: hash(randomUUID()),
    opensAt: now,
    closesAt: new Date(now.getTime() + 86_400_000),
    expiresAt: new Date(now.getTime() + 2 * 86_400_000),
    closedAt: null,
    createdBy: editorId,
    createdAt: now,
  };
  const access: FollowupAccessRecord[] = [
    {
      id: randomUUID(),
      workspaceId,
      followupId: input.id,
      sourceParticipantId: null,
      kind: "assignment_personal",
      label: "Ada",
      tokenHash: hash(randomUUID()),
      timeMultiplier: 1,
      expiresAt: input.closesAt,
      revokedAt: null,
      createdAt: now,
    },
  ];
  return { input, access };
}

export async function packPracticeFixture(
  repository: Repository,
  workspaceId: string,
  editorId: string,
  mediaId?: string,
) {
  const packs = createRecoveryPackRepository(repository);
  const draft = recoveryPackDraft();
  draft.delayedProbe = {
    ...draft.diagnostic,
    id: randomUUID(),
    prompt: "Compare a different fraction pair after practice",
    linkedRecheckQuestionId: null,
    mediaId: mediaId ?? null,
    mediaAlt: mediaId ? "Delayed fraction diagram" : null,
  };
  const content = RecoveryPackContentSchema.parse(draft);
  const pack = await packs.createRecoveryPack(recoveryPackRecord(workspaceId, editorId, content));
  const publish = async (next: RecoveryPackContent, revision: number) =>
    packs.publishRecoveryPack(
      {
        id: randomUUID(),
        workspaceId,
        packId: pack.id,
        version: 1,
        content: next,
        contentHash: recoveryPackContentHash(next),
        sourceDraftRevision: revision,
        publishedAt: new Date(),
      },
      revision,
    );
  const version = await publish(content, 0);
  return {
    packs,
    pack,
    version,
    content,
    publish,
    context: { requestId: randomUUID(), segment: "education" as const },
    ...packPracticeInput(workspaceId, editorId, version),
  };
}

export async function expectRecoveryPackPracticeConformance(
  repository: Repository,
  workspaceId: string,
  otherWorkspaceId: string,
  editorId: string,
) {
  const f = await packPracticeFixture(repository, workspaceId, editorId);
  expect(
    await repository.getRecoveryPackPracticeAssignment(
      workspaceId,
      f.pack.id,
      f.input.creationMutation!.mutationId,
      f.input.creationMutation!.requestHash,
    ),
  ).toBeNull();
  expect(
    await repository.createRecoveryPackPracticeAssignment(
      f.pack.id,
      { ...f.input, workspaceId: otherWorkspaceId },
      [],
      f.context,
    ),
  ).toBeNull();
  const [created, duplicate] = await Promise.all([
    repository.createRecoveryPackPracticeAssignment(f.pack.id, f.input, f.access, f.context),
    repository.createRecoveryPackPracticeAssignment(
      f.pack.id,
      { ...f.input, id: randomUUID(), genericTokenHash: hash(randomUUID()) },
      [],
      { ...f.context, requestId: randomUUID() },
    ),
  ]);
  expect(created).not.toBeNull();
  expect(created!.created).toBe(true);
  expect(duplicate!.created).toBe(false);
  expect(created!.productEvent).toMatchObject({
    workspaceId,
    name: "practice_assignment_created",
    dimensions: { betaVersion: "p0-2026", segment: "education" },
    occurredAt: f.input.createdAt.toISOString(),
    createdAt: f.input.createdAt,
    expiresAt: new Date(f.input.createdAt.getTime() + 30 * 86_400_000),
  });
  expect(duplicate!.productEvent).toBeNull();
  const first = created!.followup;
  expect(duplicate!.followup.id).toBe(first.id);
  expect(await repository.listFollowupAccess(workspaceId, first!.id)).toHaveLength(1);
  expect(await repository.getFollowup(otherWorkspaceId, first!.id)).toBeNull();
  expect(
    await repository.getRecoveryPackPracticeAssignment(
      otherWorkspaceId,
      f.pack.id,
      f.input.creationMutation!.mutationId,
      f.input.creationMutation!.requestHash,
    ),
  ).toBeNull();
  for (const packId of [f.pack.id, randomUUID()]) {
    await expect(
      repository.getRecoveryPackPracticeAssignment(
        workspaceId,
        packId,
        f.input.creationMutation!.mutationId,
        "b".repeat(64),
      ),
    ).rejects.toBeInstanceOf(RecoveryPackPracticeAssignmentConflictError);
  }
  await expect(
    repository.getRecoveryPackPracticeAssignment(
      workspaceId,
      randomUUID(),
      f.input.creationMutation!.mutationId,
      f.input.creationMutation!.requestHash,
    ),
  ).rejects.toBeInstanceOf(RecoveryPackPracticeAssignmentConflictError);
  await expect(
    repository.createRecoveryPackPracticeAssignment(
      f.pack.id,
      {
        ...f.input,
        creationMutation: { ...f.input.creationMutation!, requestHash: "b".repeat(64) },
      },
      [],
      f.context,
    ),
  ).rejects.toBeInstanceOf(RecoveryPackPracticeAssignmentConflictError);
  const changed = RecoveryPackContentSchema.parse({
    ...f.content,
    title: "New source title",
    delayedProbe: null,
  });
  await f.packs.updateRecoveryPackDraft({
    workspaceId,
    packId: f.pack.id,
    draft: changed,
    expectedRevision: 0,
    mutationId: randomUUID(),
    editorId,
    draftHash: hash(changed),
  });
  const latest = await f.publish(changed, 1);
  const stale = {
    ...f.input,
    id: randomUUID(),
    creationMutation: { mutationId: randomUUID(), requestHash: hash(randomUUID()) },
  };
  expect(
    await repository.createRecoveryPackPracticeAssignment(f.pack.id, stale, [], f.context),
  ).toBeNull();
  expect(
    await repository.createRecoveryPackPracticeAssignment(
      f.pack.id,
      packPracticeInput(workspaceId, editorId, latest).input,
      [],
      f.context,
    ),
  ).toBeNull();
  expect(
    (await repository.createRecoveryPackPracticeAssignment(
      f.pack.id,
      f.input,
      f.access,
      f.context,
    ))!.followup.id,
  ).toBe(first!.id);
  expect(await f.packs.deleteRecoveryPack(workspaceId, f.pack.id)).toBe(true);
  expect((await repository.getFollowup(workspaceId, first!.id))!.recoveryPackSource).toEqual(
    f.input.recoveryPackSource,
  );
  expect(
    (await repository.getFollowupByGenericToken(first!.id, f.input.genericTokenHash, new Date()))!
      .id,
  ).toBe(first!.id);
  expect(
    (await repository.getRecoveryPackPracticeAssignment(
      workspaceId,
      f.pack.id,
      f.input.creationMutation!.mutationId,
      f.input.creationMutation!.requestHash,
    ))!.id,
  ).toBe(first!.id);
  expect(
    (await repository.createRecoveryPackPracticeAssignment(
      f.pack.id,
      f.input,
      f.access,
      f.context,
    ))!.followup.id,
  ).toBe(first!.id);
  const history = await repository.listFollowupHistory(workspaceId, { limit: 50, now: new Date() });
  expect(history.items.find(({ id }) => id === first!.id)).toMatchObject({
    quizId: null,
    sourceQuizVersionId: null,
    recoveryPackSource: f.input.recoveryPackSource,
    checkpointCount: 1,
  });
  expect(
    (
      await repository.listFollowupHistory(workspaceId, {
        limit: 50,
        quizId: randomUUID(),
        now: new Date(),
      })
    ).items.some(({ id }) => id === first!.id),
  ).toBe(false);
  await repository.closeFollowup(workspaceId, first!.id, new Date());
  const audits = (await repository.listAuditEvents(workspaceId, null, 100)).filter(
    ({ action, targetId }) =>
      action === "recovery_pack.practice_assignment.create" && targetId === first.id,
  );
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    actorId: editorId,
    targetType: "practice_assignment",
    requestId: f.context.requestId,
    createdAt: f.input.createdAt,
  });
  expect(audits[0]!.metadata).toEqual({
    sourcePackId: f.pack.id,
    sourcePackVersionId: f.version.id,
    sourceRole: "delayed_probe",
    personalPasses: 1,
    timeMode: "flex",
  });
  expect(
    (await repository.getRecoveryPackPracticeAssignment(
      workspaceId,
      f.pack.id,
      f.input.creationMutation!.mutationId,
      f.input.creationMutation!.requestHash,
    ))!.id,
  ).toBe(first!.id);
}

export async function expectRecoveryPackPracticeMediaLifecycle(
  repository: Repository,
  workspaceId: string,
  editorId: string,
) {
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
  const f = await packPracticeFixture(repository, workspaceId, editorId, mediaId);
  const saved = (await repository.createRecoveryPackPracticeAssignment(
    f.pack.id,
    f.input,
    f.access,
    f.context,
  ))!.followup;
  await f.packs.deleteRecoveryPack(workspaceId, f.pack.id);
  expect(await repository.listMediaReferences(workspaceId, mediaId)).toEqual([
    expect.objectContaining({ ownerType: "followup", ownerId: saved.id }),
  ]);
  expect(
    (await repository.listUnattachedMedia(new Date(now.getTime() + 1), 100)).some(
      ({ id }) => id === mediaId,
    ),
  ).toBe(false);
  const exported = (await repository.exportAccount(editorId)) as {
    followups: Array<{ id: string; recoveryPackSource?: unknown; recovery_pack_source?: unknown }>;
    mediaReferences: Array<{ ownerId?: string; owner_id?: string }>;
  };
  expect(exported.followups).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: saved.id })]),
  );
  expect(
    exported.mediaReferences.some(
      (reference) => (reference.ownerId ?? reference.owner_id) === saved.id,
    ),
  ).toBe(true);
  const exportedAssignment = exported.followups.find(({ id }) => id === saved.id)!;
  expect(exportedAssignment.recoveryPackSource ?? exportedAssignment.recovery_pack_source).toEqual(
    f.input.recoveryPackSource,
  );
  expect(JSON.stringify(exported.followups)).not.toContain(f.input.genericTokenHash);
  expect(JSON.stringify(exported.followups)).not.toContain(f.input.creationMutation!.requestHash);
  expect(
    await repository.purgeExpiredPracticeAssignments(new Date(f.input.expiresAt.getTime() + 1)),
  ).toBeGreaterThanOrEqual(1);
  expect(await repository.getFollowup(workspaceId, saved.id)).toBeNull();
  expect(await repository.listFollowupAccess(workspaceId, saved.id)).toEqual([]);
  expect(await repository.listMediaReferences(workspaceId, mediaId)).toEqual([]);
  expect(
    (await repository.listUnattachedMedia(new Date(now.getTime() + 1), 100)).some(
      ({ id }) => id === mediaId,
    ),
  ).toBe(true);
}

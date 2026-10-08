import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  RecoveryPackContentSchema,
  recoveryPackContentHash,
  type RecoveryPackDraft,
} from "@openround/contracts";
import {
  RecoveryPackDraftConflictError,
  RecoveryPackMutationConflictError,
  RecoveryPackNotFoundError,
  RecoveryPackSourceCitationValidationError,
  RecoveryPackSourceReviewConflictError,
  RecoveryPackSourceReviewRequiredError,
  type RecoveryPackRepository,
  type RecoveryPackSourceProvenance,
  type Repository,
} from "../../src/index.js";
import { recoveryPackDraft, recoveryPackRecord } from "./recovery-pack-conformance.js";

export function sourcePackFixture(workspaceId: string, editorId: string) {
  const citation = {
    sourceName: "Original fractions source",
    sourceDigest: "a".repeat(64),
    locator: "paragraph 1",
    excerpt: "Compare fractions using equal units.",
  };
  const draft = recoveryPackDraft();
  draft.diagnostic.sourceCitations = [citation];
  draft.recheck.sourceCitations = [citation];
  draft.interventions[0]!.citations = [citation];
  draft.citations = [citation];
  draft.delayedProbe = {
    ...draft.diagnostic,
    id: randomUUID(),
    prompt: "Compare this new pair next week",
    delivery: "main",
    linkedRecheckQuestionId: null,
  };
  const record = recoveryPackRecord(workspaceId, editorId, draft);
  const provenance: RecoveryPackSourceProvenance = {
    authoringJobId: randomUUID(),
    sourceName: citation.sourceName,
    sourceDigest: citation.sourceDigest,
    sourceOutputHash: "b".repeat(64),
    citationCatalog: [citation],
  };
  return { record, provenance, content: RecoveryPackContentSchema.parse(record.draft) };
}

export async function createExpiringSourceJob(
  repository: Repository,
  fixture: ReturnType<typeof sourcePackFixture>,
) {
  const now = new Date();
  await repository.createAuthoringJob({
    id: fixture.provenance.authoringJobId,
    workspaceId: fixture.record.workspaceId,
    createdBy: fixture.record.lastEditedBy,
    sourceType: "pasted_text",
    sourceName: fixture.provenance.sourceName,
    sourceDigest: fixture.provenance.sourceDigest,
    sourceMimeType: null,
    sourceText: fixture.provenance.citationCatalog[0]!.excerpt,
    sourceBlob: null,
    status: "ready",
    attempts: 1,
    appliedQuizId: null,
    availableAt: now,
    output: null,
    lastError: null,
    expiresAt: new Date(now.getTime() + 86_400_000),
    createdAt: now,
    updatedAt: now,
  });
}

export async function expectRecoveryPackSourceConformance(input: {
  repository: RecoveryPackRepository;
  workspaceId: string;
  otherWorkspaceId: string;
  editorId: string;
}) {
  const { repository, workspaceId, otherWorkspaceId, editorId } = input;
  const fixture = sourcePackFixture(workspaceId, editorId);
  const mutationId = randomUUID();
  const requestHash = "c".repeat(64);
  const results = await Promise.all([
    repository.createSourceRecoveryPack(
      fixture.record,
      fixture.provenance,
      mutationId,
      requestHash,
    ),
    repository.createSourceRecoveryPack(
      { ...fixture.record, id: randomUUID() },
      fixture.provenance,
      mutationId,
      requestHash,
    ),
  ]);
  const created = results[0]!;
  const contentHash = recoveryPackContentHash(fixture.content);
  expect(results[1]?.id).toBe(created.id);
  expect(created.sourceReview).toMatchObject({
    authoringJobId: fixture.provenance.authoringJobId,
    sourceDigest: fixture.provenance.sourceDigest,
    contentHash,
    approved: false,
  });
  expect(created).not.toHaveProperty("citationCatalog");
  expect(created.sourceReview).not.toHaveProperty("citationCatalog");
  expect(created.draft).not.toHaveProperty("sourceReview");
  expect(
    await repository.replaySourceRecoveryPack(workspaceId, mutationId, requestHash),
  ).toMatchObject({ id: created.id, sourceReview: { contentHash } });
  expect(
    await repository.replaySourceRecoveryPack(otherWorkspaceId, mutationId, requestHash),
  ).toBeNull();
  expect(await repository.getRecoveryPack(otherWorkspaceId, created.id)).toBeNull();
  expect(
    (await repository.listRecoveryPacks(workspaceId)).find((item) => item.id === created.id)
      ?.sourceReview?.approved,
  ).toBe(false);
  await expect(
    repository.replaySourceRecoveryPack(workspaceId, mutationId, "d".repeat(64)),
  ).rejects.toBeInstanceOf(RecoveryPackMutationConflictError);
  await expect(
    repository.createSourceRecoveryPack(
      fixture.record,
      fixture.provenance,
      mutationId,
      "d".repeat(64),
    ),
  ).rejects.toBeInstanceOf(RecoveryPackMutationConflictError);

  const publish = (draft: RecoveryPackDraft, revision: number) => {
    const content = RecoveryPackContentSchema.parse(draft);
    return repository.publishRecoveryPack(
      {
        id: randomUUID(),
        workspaceId,
        packId: created.id,
        version: 1,
        content,
        contentHash: recoveryPackContentHash(content),
        sourceDraftRevision: revision,
        publishedAt: new Date(),
      },
      revision,
    );
  };
  await expect(publish(created.draft, 0)).rejects.toBeInstanceOf(
    RecoveryPackSourceReviewRequiredError,
  );
  const approval = {
    workspaceId,
    packId: created.id,
    editorId,
    expectedDraftRevision: 0,
    expectedContentHash: contentHash,
    sourceDigest: fixture.provenance.sourceDigest,
    sourceOutputHash: fixture.provenance.sourceOutputHash,
    mutationId: randomUUID(),
  };
  await expect(
    repository.approveRecoveryPackSource({ ...approval, workspaceId: otherWorkspaceId }),
  ).rejects.toBeInstanceOf(RecoveryPackNotFoundError);
  for (const field of ["expectedContentHash", "sourceDigest", "sourceOutputHash"] as const)
    await expect(
      repository.approveRecoveryPackSource({
        ...approval,
        [field]: "e".repeat(64),
        mutationId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(RecoveryPackSourceReviewConflictError);
  await expect(
    repository.approveRecoveryPackSource({
      ...approval,
      expectedDraftRevision: 1,
      mutationId: randomUUID(),
    }),
  ).rejects.toBeInstanceOf(RecoveryPackDraftConflictError);
  const approved = await repository.approveRecoveryPackSource(approval);
  expect(approved.sourceReview).toMatchObject({
    approved: true,
    approvedContentHash: contentHash,
    approvedDraftRevision: 0,
  });
  expect(approved.sourceReview?.approvedAt).toBeTruthy();
  expect(await repository.approveRecoveryPackSource({ ...approval, now: new Date(0) })).toEqual(
    approved,
  );
  for (const changed of [
    { packId: randomUUID() },
    { expectedDraftRevision: 1 },
    { expectedContentHash: "e".repeat(64) },
    { sourceDigest: "e".repeat(64) },
    { sourceOutputHash: "e".repeat(64) },
    { editorId: randomUUID() },
  ])
    await expect(
      repository.approveRecoveryPackSource({ ...approval, ...changed }),
    ).rejects.toBeInstanceOf(RecoveryPackMutationConflictError);
  const version = await publish(created.draft, 0);
  expect(version).not.toHaveProperty("sourceReview");
  expect(version.content).not.toHaveProperty("sourceReview");
  expect((await publish(created.draft, 0)).id).toBe(version.id);

  const unchanged = {
    workspaceId,
    packId: created.id,
    draft: created.draft,
    expectedRevision: 0,
    mutationId: randomUUID(),
    editorId,
    draftHash: "unchanged",
  };
  expect(await repository.updateRecoveryPackDraft(unchanged)).toMatchObject({
    draftRevision: 0,
    sourceReview: { approved: true },
  });
  const edit = {
    ...unchanged,
    draft: { ...created.draft, title: "Reviewed then edited" },
    mutationId: randomUUID(),
    draftHash: "changed",
  };
  const edited = (await repository.updateRecoveryPackDraft(edit))!;
  expect(edited.sourceReview).toMatchObject({
    approved: false,
    contentHash: recoveryPackContentHash(edited.draft),
    approvedDraftRevision: 0,
  });
  expect(await repository.approveRecoveryPackSource(approval)).toMatchObject({
    draftRevision: 1,
    sourceReview: { approved: false },
  });
  expect(
    await repository.replaySourceRecoveryPack(workspaceId, mutationId, requestHash),
  ).toMatchObject({ draftRevision: 1, sourceReview: { approved: false } });
  const historical = await repository.replayRecoveryPackMutation(unchanged);
  expect(historical).toMatchObject({
    draftRevision: 0,
    sourceReview: { contentHash, approved: true },
  });
  await expect(publish(edited.draft, 1)).rejects.toBeInstanceOf(
    RecoveryPackSourceReviewRequiredError,
  );

  const restored = (await repository.updateRecoveryPackDraft({
    ...unchanged,
    expectedRevision: 1,
    mutationId: randomUUID(),
    draftHash: "restore",
  }))!;
  expect(restored.sourceReview).toMatchObject({ contentHash, approved: false });
  await expect(publish(restored.draft, 2)).rejects.toBeInstanceOf(
    RecoveryPackSourceReviewRequiredError,
  );
  await repository.approveRecoveryPackSource({
    ...approval,
    expectedDraftRevision: 2,
    mutationId: randomUUID(),
  });
  expect((await publish(restored.draft, 2)).id).toBe(version.id);

  const incomplete = (await repository.updateRecoveryPackDraft({
    ...unchanged,
    draft: { ...created.draft, title: "" },
    expectedRevision: 2,
    mutationId: randomUUID(),
    draftHash: "incomplete",
  }))!;
  expect(incomplete.sourceReview).toMatchObject({ contentHash: null, approved: false });
  await expect(
    repository.approveRecoveryPackSource({
      ...approval,
      expectedDraftRevision: 3,
      mutationId: randomUUID(),
    }),
  ).rejects.toBeInstanceOf(RecoveryPackSourceReviewConflictError);
  const forgedDraft = structuredClone(created.draft);
  forgedDraft.interventions[0]!.citations[0]!.excerpt = "An invented source span";
  await repository.updateRecoveryPackDraft({
    ...unchanged,
    draft: forgedDraft,
    expectedRevision: 3,
    mutationId: randomUUID(),
    draftHash: "forged",
  });
  await expect(
    repository.approveRecoveryPackSource({
      ...approval,
      expectedDraftRevision: 4,
      expectedContentHash: recoveryPackContentHash(forgedDraft),
      mutationId: randomUUID(),
    }),
  ).rejects.toBeInstanceOf(RecoveryPackSourceCitationValidationError);

  // Creation and approval verify all per-item/global citations, including the optional probe.
  const badCitations: RecoveryPackDraft[] = [];
  for (const field of ["diagnostic", "recheck", "delayedProbe"] as const) {
    const draft = structuredClone(created.draft);
    draft[field]!.sourceCitations = [];
    badCitations.push(draft);
  }
  const noCardCitation = structuredClone(created.draft);
  noCardCitation.interventions[0]!.citations = [];
  badCitations.push(noCardCitation, { ...created.draft, citations: [] });
  for (const changedCitation of [
    { sourceName: "Renamed source" },
    { sourceDigest: "f".repeat(64) },
    { locator: "invented paragraph" },
    { excerpt: "invented excerpt" },
  ]) {
    const draft = structuredClone(created.draft);
    draft.citations[0] = { ...draft.citations[0]!, ...changedCitation };
    badCitations.push(draft);
  }
  for (const draft of badCitations) {
    await expect(
      repository.createSourceRecoveryPack(
        { ...fixture.record, id: randomUUID(), draft },
        fixture.provenance,
        randomUUID(),
        requestHash,
      ),
    ).rejects.toBeInstanceOf(RecoveryPackSourceCitationValidationError);
    await repository.updateRecoveryPackDraft({
      ...unchanged,
      draft,
      expectedRevision: (await repository.getRecoveryPack(workspaceId, created.id))!.draftRevision,
      mutationId: randomUUID(),
      draftHash: randomUUID(),
    });
    const current = (await repository.getRecoveryPack(workspaceId, created.id))!;
    await expect(
      repository.approveRecoveryPackSource({
        ...approval,
        expectedDraftRevision: current.draftRevision,
        expectedContentHash: recoveryPackContentHash(draft),
        mutationId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(RecoveryPackSourceCitationValidationError);
  }

  const beforeRace = (await repository.updateRecoveryPackDraft({
    ...unchanged,
    expectedRevision: (await repository.getRecoveryPack(workspaceId, created.id))!.draftRevision,
    mutationId: randomUUID(),
    draftHash: "race restore",
  }))!;
  await repository.approveRecoveryPackSource({
    ...approval,
    expectedDraftRevision: beforeRace.draftRevision,
    mutationId: randomUUID(),
  });
  const concurrent = await Promise.allSettled([
    repository.updateRecoveryPackDraft({
      ...unchanged,
      draft: { ...created.draft, title: "Race edit" },
      expectedRevision: beforeRace.draftRevision,
      mutationId: randomUUID(),
      draftHash: "race",
    }),
    publish(created.draft, beforeRace.draftRevision),
  ]);
  expect(concurrent[0]?.status).toBe("fulfilled");
  if (concurrent[1]?.status === "rejected")
    expect(concurrent[1].reason).toBeInstanceOf(RecoveryPackDraftConflictError);
  expect((await repository.getRecoveryPack(workspaceId, created.id))!.sourceReview?.approved).toBe(
    false,
  );
  expect(await repository.deleteRecoveryPack(otherWorkspaceId, created.id)).toBe(false);
  expect(await repository.deleteRecoveryPack(workspaceId, created.id)).toBe(true);
  expect(
    await repository.replaySourceRecoveryPack(workspaceId, mutationId, requestHash),
  ).toBeNull();
  await expect(repository.approveRecoveryPackSource(approval)).rejects.toBeInstanceOf(
    RecoveryPackNotFoundError,
  );
  expect(await repository.getRecoveryPackVersion(workspaceId, version.id)).toBeNull();
}

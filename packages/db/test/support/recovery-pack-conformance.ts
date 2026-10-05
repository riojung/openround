import { createHash, randomUUID } from "node:crypto";
import { expect } from "vitest";
import { RecoveryPackContentSchema, type RecoveryPackDraft } from "@openround/contracts";
import {
  RecoveryPackDraftConflictError,
  RecoveryPackMutationConflictError,
  type RecoveryPackRecord,
  type RecoveryPackRepository,
} from "../../src/index.js";

export function recoveryPackDraft(title = "Comparing fractions"): RecoveryPackDraft {
  const diagnosticId = randomUUID();
  const recheckId = randomUUID();
  const question = (id: string, prompt: string) => ({
    id,
    type: "numeric" as const,
    prompt,
    purpose: "diagnostic" as const,
    confidence: "optional" as const,
    conceptKeys: ["fractions.comparison"],
    correctValue: "1",
    tolerance: "0",
    unit: null,
    timeLimitSeconds: 30,
    basePoints: 1_000,
    explanation: "Compare the same unit.",
    mediaId: null,
    mediaAlt: null,
  });
  return {
    schemaVersion: 1,
    title,
    description: "A reusable recovery loop",
    diagnostic: {
      ...question(diagnosticId, "Which fraction is larger?"),
      delivery: "main",
      linkedRecheckQuestionId: recheckId,
    },
    interventions: [
      {
        id: randomUUID(),
        title: "Use a shared denominator",
        body: "Compare both fractions in the same units.",
        citations: [],
      },
    ],
    recheck: {
      ...question(recheckId, "Which fraction is smaller in this new pair?"),
      delivery: "recheck",
      linkedRecheckQuestionId: null,
    },
    delayedProbe: null,
    conceptKeys: ["fractions.comparison"],
    misconceptionKeys: ["fractions.denominator-size"],
    citations: [],
  };
}

export function recoveryPackRecord(
  workspaceId: string,
  editorId: string,
  draft = recoveryPackDraft(),
): RecoveryPackRecord {
  const now = new Date();
  return {
    id: randomUUID(),
    workspaceId,
    title: draft.title,
    description: draft.description,
    draft,
    draftRevision: 0,
    draftSchemaVersion: 1,
    currentVersionId: null,
    publishedDraftRevision: null,
    lastEditedBy: editorId,
    createdAt: now,
    updatedAt: now,
  };
}

export async function expectRecoveryPackRepositoryConformance(input: {
  repository: RecoveryPackRepository;
  workspaceId: string;
  otherWorkspaceId: string;
  editorId: string;
}) {
  const { repository, workspaceId, otherWorkspaceId, editorId } = input;
  const initial = await repository.createRecoveryPack(recoveryPackRecord(workspaceId, editorId));
  expect(
    (await repository.listRecoveryPacks(workspaceId)).some((pack) => pack.id === initial.id),
  ).toBe(true);
  expect(await repository.getRecoveryPack(otherWorkspaceId, initial.id)).toBeNull();
  expect(await repository.listRecoveryPackHistory(otherWorkspaceId, initial.id)).toEqual([]);
  expect(await repository.deleteRecoveryPack(otherWorkspaceId, initial.id)).toBe(false);

  const unchanged = {
    workspaceId,
    packId: initial.id,
    draft: initial.draft,
    expectedRevision: 0,
    mutationId: randomUUID(),
    editorId,
    draftHash: "unchanged",
  };
  expect((await repository.updateRecoveryPackDraft(unchanged))?.draftRevision).toBe(0);
  expect(
    await repository.replayRecoveryPackMutation({ ...unchanged, mutationId: randomUUID() }),
  ).toBeNull();
  expect(await repository.replayRecoveryPackMutation(unchanged)).toMatchObject({
    draftRevision: 0,
  });
  expect((await repository.updateRecoveryPackDraft(unchanged))?.draftRevision).toBe(0);
  const first = {
    ...unchanged,
    draft: { ...initial.draft, title: "Revision 1" },
    mutationId: randomUUID(),
    draftHash: "first",
  };
  const competing = {
    ...first,
    draft: { ...initial.draft, title: "Competing" },
    mutationId: randomUUID(),
    draftHash: "competing",
  };
  const writes = await Promise.allSettled([
    repository.updateRecoveryPackDraft(first),
    repository.updateRecoveryPackDraft(competing),
  ]);
  expect(writes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(writes.find((result) => result.status === "rejected")).toMatchObject({
    reason: expect.any(RecoveryPackDraftConflictError),
  });
  const winner = writes[0]?.status === "fulfilled" ? first : competing;
  const firstResult = await repository.updateRecoveryPackDraft(winner);
  expect(firstResult?.draftRevision).toBe(1);
  await expect(
    repository.updateRecoveryPackDraft({ ...winner, draftHash: "another payload" }),
  ).rejects.toBeInstanceOf(RecoveryPackMutationConflictError);
  expect(
    await repository.updateRecoveryPackDraft({ ...winner, workspaceId: otherWorkspaceId }),
  ).toBeNull();

  for (let expectedRevision = 1; expectedRevision < 25; expectedRevision += 1) {
    await repository.updateRecoveryPackDraft({
      ...winner,
      draft: { ...initial.draft, title: `Revision ${expectedRevision + 1}` },
      expectedRevision,
      mutationId: randomUUID(),
      draftHash: `revision-${expectedRevision + 1}`,
    });
  }
  const history = await repository.listRecoveryPackHistory(workspaceId, initial.id);
  expect(history).toHaveLength(20);
  expect(history[0]?.revision).toBe(25);
  expect(history.at(-1)?.revision).toBe(6);
  // Mutation replay is independent of history pruning and subsequent saves.
  expect(await repository.updateRecoveryPackDraft(winner)).toMatchObject({
    draftRevision: 1,
    draft: { title: winner.draft.title },
  });
  expect(await repository.updateRecoveryPackDraft(unchanged)).toMatchObject({
    draftRevision: 0,
    draft: { title: initial.draft.title },
  });
  expect(await repository.replayRecoveryPackMutation(winner)).toMatchObject({ draftRevision: 1 });
  await expect(
    repository.replayRecoveryPackMutation({ ...winner, draftHash: "changed" }),
  ).rejects.toBeInstanceOf(RecoveryPackMutationConflictError);
  expect((await repository.getRecoveryPack(workspaceId, initial.id))?.draftRevision).toBe(25);

  const publish = async (draft: RecoveryPackDraft, expectedRevision: number) => {
    const content = RecoveryPackContentSchema.parse(draft);
    return repository.publishRecoveryPack(
      {
        id: randomUUID(),
        workspaceId,
        packId: initial.id,
        version: 1,
        content,
        contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
        sourceDraftRevision: expectedRevision,
        publishedAt: new Date(),
      },
      expectedRevision,
    );
  };
  const current = (await repository.getRecoveryPack(workspaceId, initial.id))!;
  await expect(publish(current.draft, 24)).rejects.toBeInstanceOf(RecoveryPackDraftConflictError);
  const versionOne = await publish(current.draft, 25);
  expect(versionOne.version).toBe(1);
  expect(await publish(current.draft, 25)).toMatchObject({ id: versionOne.id, version: 1 });
  const secondDraft = { ...current.draft, title: "Second content" };
  await repository.updateRecoveryPackDraft({
    ...winner,
    draft: secondDraft,
    expectedRevision: 25,
    mutationId: randomUUID(),
    draftHash: "second-content",
  });
  const versionTwo = await publish(secondDraft, 26);
  expect(versionTwo.version).toBe(2);
  await repository.updateRecoveryPackDraft({
    ...winner,
    draft: current.draft,
    expectedRevision: 26,
    mutationId: randomUUID(),
    draftHash: "revert",
  });
  expect((await publish(current.draft, 27)).id).toBe(versionOne.id);
  const thirdDraft = { ...current.draft, title: "Novel after a revert" };
  await repository.updateRecoveryPackDraft({
    ...winner,
    draft: thirdDraft,
    expectedRevision: 27,
    mutationId: randomUUID(),
    draftHash: "third-content",
  });
  expect((await publish(thirdDraft, 28)).version).toBe(3);
  expect(await repository.getRecoveryPackVersion(workspaceId, versionOne.id)).toMatchObject({
    content: { title: current.draft.title },
  });
  expect(await repository.getRecoveryPackVersion(otherWorkspaceId, versionOne.id)).toBeNull();
  expect(await repository.deleteRecoveryPack(workspaceId, initial.id)).toBe(true);
  expect(await repository.getRecoveryPackVersion(workspaceId, versionTwo.id)).toBeNull();
  expect(await repository.replayRecoveryPackMutation(winner)).toBeNull();
  expect(await repository.listRecoveryPackHistory(workspaceId, initial.id)).toEqual([]);
}

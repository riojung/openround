import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { FollowupAnswerRecord, FollowupAttemptRecord, Repository } from "../../src/index.js";
import { packPracticeFixture } from "./recovery-pack-practice-conformance.js";

export async function expectRecoveryPackSequencePracticeConformance(
  repository: Repository,
  workspaceId: string,
  otherWorkspaceId: string,
  editorId: string,
) {
  const mediaId = randomUUID();
  await repository.createMediaAsset({
    id: mediaId,
    workspaceId,
    objectKey: `media/${workspaceId}/${mediaId}.png`,
    mimeType: "image/png",
    sizeBytes: 10,
    scanStatus: "clean",
    altText: "Fraction diagram",
    createdAt: new Date(),
  });
  const f = await packPracticeFixture(repository, workspaceId, editorId, mediaId, "full_sequence");
  expect(f.version.content.delayedProbe).toBeNull();
  expect(
    await repository.createRecoveryPackPracticeAssignment(
      f.pack.id,
      { ...f.input, workspaceId: otherWorkspaceId },
      [],
      f.context,
    ),
  ).toBeNull();
  for (const change of [
    "prompt",
    "sourceHash",
    "sourceItem",
    "cards",
    "citations",
    "unknownQuestionField",
    "untrimmed",
  ] as const) {
    const spoofed = structuredClone(f.input);
    const question = spoofed.content.questions[0]!;
    if (change === "prompt") question.prompt = "A different diagnostic under legitimate provenance";
    if (change === "sourceHash") question.recoveryPackSource!.contentHash = "b".repeat(64);
    if (change === "sourceItem") question.recoveryPackSource!.sourceItemId = randomUUID();
    if (change === "cards")
      spoofed.recoveryPackSequence!.interventions[0]!.body = "A different card";
    if (change === "citations")
      spoofed.recoveryPackSequence!.citations[0]!.excerpt = "A different citation";
    if (change === "unknownQuestionField") Object.assign(question, { privateField: "extra" });
    if (change === "untrimmed") question.prompt = ` ${question.prompt} `;
    // A source-item mismatch is rejected at the input boundary; the other valid shapes fail current-source matching.
    if (change === "sourceItem") {
      await expect(
        repository.createRecoveryPackPracticeAssignment(f.pack.id, spoofed, [], f.context),
      ).rejects.toThrow();
    } else {
      expect(
        await repository.createRecoveryPackPracticeAssignment(f.pack.id, spoofed, [], f.context),
      ).toBeNull();
    }
  }
  const results = await Promise.all([
    repository.createRecoveryPackPracticeAssignment(f.pack.id, f.input, f.access, f.context),
    repository.createRecoveryPackPracticeAssignment(f.pack.id, f.input, f.access, f.context),
  ]);
  expect(results.map((result) => result!.created).sort()).toEqual([false, true]);
  const frozen = results.find((result) => result!.created)!.followup;
  expect(frozen.content).toEqual(f.input.content);
  expect(frozen.recoveryPackSequence).toEqual(f.input.recoveryPackSequence);
  expect(
    (await repository.listAuditEvents(workspaceId, null, 100)).find(
      ({ targetId }) => targetId === frozen.id,
    )!.metadata,
  ).toMatchObject({ sourceRole: "full_sequence" });
  expect(await repository.getFollowup(otherWorkspaceId, frozen.id)).toBeNull();

  const now = f.input.createdAt;
  let attempt: FollowupAttemptRecord = await repository.createOrGetFollowupAttempt({
    id: randomUUID(),
    workspaceId,
    followupId: frozen.id,
    accessTokenId: f.access[0]!.id,
    sourceParticipantId: null,
    attemptTokenHash: randomUUID(),
    status: "in_progress",
    phase: "question_open",
    currentIndex: 0,
    version: 0,
    timeMultiplier: 1,
    questionOpenedAt: now,
    deadlineAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  expect(attempt).toMatchObject({ interventionIndex: null, advanceReceipts: {} });
  const diagnosticAnswer: FollowupAnswerRecord = {
    id: randomUUID(),
    workspaceId,
    followupId: frozen.id,
    attemptId: attempt.id,
    checkpointId: frozen.content.questions[0]!.id,
    response: { kind: "numeric", value: "1" },
    confidence: 2,
    correct: true,
    idempotencyKey: "diagnostic-answer",
    submittedVersion: 0,
    acceptedAt: now,
  };
  await repository.commitFollowupAnswer(
    { ...attempt, phase: "answer_reveal", version: 1 },
    diagnosticAnswer,
    0,
  );
  attempt = (await repository.getFollowupAttemptByToken(frozen.id, attempt.attemptTokenHash, now))!;
  const receipts: Record<string, number> = {};
  const firstKey = randomUUID();
  const firstAdvance = {
    ...attempt,
    phase: "intervention" as const,
    interventionIndex: 0,
    version: 2,
    workspaceId: otherWorkspaceId,
    followupId: randomUUID(),
    accessTokenId: randomUUID(),
    createdAt: new Date(0),
  };
  expect(
    (
      await Promise.all([
        repository.advanceFollowupAttempt(firstAdvance, 1, firstKey),
        repository.advanceFollowupAttempt(firstAdvance, 1, firstKey),
      ])
    ).sort(),
  ).toEqual([false, true]);
  receipts[firstKey] = 1;
  attempt = (await repository.getFollowupAttemptByToken(frozen.id, attempt.attemptTokenHash, now))!;
  expect(attempt).toMatchObject({
    phase: "intervention",
    interventionIndex: 0,
    advanceReceipts: receipts,
    workspaceId,
    followupId: frozen.id,
    accessTokenId: f.access[0]!.id,
    createdAt: now,
  });
  // Reusing a receipt at a new valid fence must not overwrite its original fence or advance again.
  expect(await repository.advanceFollowupAttempt({ ...attempt, version: 3 }, 2, firstKey)).toBe(
    false,
  );
  await expect(
    repository.advanceFollowupAttempt(
      { ...attempt, interventionIndex: 2, version: 3 },
      2,
      randomUUID(),
    ),
  ).rejects.toThrow();
  for (const next of [
    { phase: "intervention" as const, interventionIndex: 1, currentIndex: 0 },
    { phase: "question_open" as const, interventionIndex: null, currentIndex: 1 },
  ]) {
    const key = randomUUID();
    const fence = attempt.version;
    expect(
      await repository.advanceFollowupAttempt(
        {
          ...attempt,
          ...next,
          advanceReceipts: {},
          version: fence + 1,
        },
        fence,
        key,
      ),
    ).toBe(true);
    receipts[key] = fence;
    attempt = (await repository.getFollowupAttemptByToken(
      frozen.id,
      attempt.attemptTokenHash,
      now,
    ))!;
    expect(attempt.advanceReceipts).toEqual(receipts);
  }
  expect(
    await repository.getFollowupAnswerByIdempotencyKey(attempt.id, "diagnostic-answer"),
  ).toMatchObject({
    id: diagnosticAnswer.id,
    checkpointId: diagnosticAnswer.checkpointId,
    submittedVersion: 0,
  });
  expect(
    await repository.getFollowupAnswerByIdempotencyKey(randomUUID(), "diagnostic-answer"),
  ).toBeNull();
  const recheckAnswer = {
    ...diagnosticAnswer,
    id: randomUUID(),
    checkpointId: frozen.content.questions[1]!.id,
    idempotencyKey: "recheck-answer",
    submittedVersion: attempt.version,
  };
  await repository.commitFollowupAnswer(
    { ...attempt, advanceReceipts: {}, phase: "answer_reveal", version: attempt.version + 1 },
    recheckAnswer,
    attempt.version,
  );
  attempt = (await repository.getFollowupAttemptByToken(frozen.id, attempt.attemptTokenHash, now))!;
  expect(attempt.advanceReceipts).toEqual(receipts);
  const completionKey = randomUUID();
  expect(
    await repository.advanceFollowupAttempt(
      {
        ...attempt,
        phase: "completed",
        status: "completed",
        completedAt: now,
        version: attempt.version + 1,
      },
      attempt.version,
      completionKey,
    ),
  ).toBe(true);
  receipts[completionKey] = attempt.version;
  attempt = (await repository.getFollowupAttemptByToken(frozen.id, attempt.attemptTokenHash, now))!;
  expect(await repository.commitFollowupAnswer(attempt, diagnosticAnswer, 0)).toMatchObject({
    id: diagnosticAnswer.id,
    submittedVersion: 0,
  });

  expect(await f.packs.deleteRecoveryPack(workspaceId, f.pack.id)).toBe(true);
  expect((await repository.getFollowup(workspaceId, frozen.id))!.recoveryPackSequence).toEqual(
    f.input.recoveryPackSequence,
  );
  expect((await repository.getFollowup(workspaceId, frozen.id))!.content).toEqual(f.input.content);
  expect(await repository.listMediaReferences(workspaceId, mediaId)).toEqual([
    expect.objectContaining({ ownerType: "followup", ownerId: frozen.id }),
  ]);
  expect(
    await repository.createRecoveryPackPracticeAssignment(f.pack.id, f.input, [], f.context),
  ).toMatchObject({ created: false, followup: { id: frozen.id } });
  const exported = (await repository.exportAccount(editorId)) as {
    followups: Array<Record<string, unknown>>;
    followupAttempts: Array<Record<string, unknown>>;
    followupAnswers: Array<Record<string, unknown>>;
  };
  const exportedFollowup = exported.followups.find(({ id }) => id === frozen.id)!;
  expect(exportedFollowup.recoveryPackSequence ?? exportedFollowup.recovery_pack_sequence).toEqual(
    f.input.recoveryPackSequence,
  );
  const exportedAttempt = exported.followupAttempts.find(({ id }) => id === attempt.id)!;
  expect(exportedAttempt.advanceReceipts ?? exportedAttempt.advance_receipts).toEqual(receipts);
  const exportedAnswer = exported.followupAnswers.find(({ id }) => id === diagnosticAnswer.id)!;
  expect(exportedAnswer.submittedVersion ?? exportedAnswer.submitted_version).toBe(0);
  expect(JSON.stringify(exported)).not.toContain(attempt.attemptTokenHash);
  expect(JSON.stringify(exported)).not.toContain(f.input.genericTokenHash);
  expect(JSON.stringify(exported)).not.toContain(f.input.creationMutation!.requestHash);
  return { ...f, frozen, attempt, diagnosticAnswer, receipts, mediaId };
}

export async function expectSequencePracticeExpiry(
  repository: Repository,
  f: Awaited<ReturnType<typeof expectRecoveryPackSequencePracticeConformance>>,
) {
  expect(
    await repository.purgeExpiredPracticeAssignments(new Date(f.input.expiresAt.getTime() + 1)),
  ).toBeGreaterThanOrEqual(1);
  expect(await repository.getFollowup(f.input.workspaceId, f.frozen.id)).toBeNull();
  expect(await repository.listFollowupAccess(f.input.workspaceId, f.frozen.id)).toEqual([]);
  expect(
    await repository.getFollowupAttemptByToken(
      f.frozen.id,
      f.attempt.attemptTokenHash,
      f.input.createdAt,
    ),
  ).toBeNull();
  expect(
    await repository.getFollowupAnswerByIdempotencyKey(
      f.attempt.id,
      f.diagnosticAnswer.idempotencyKey,
    ),
  ).toBeNull();
  expect(await repository.listMediaReferences(f.input.workspaceId, f.mediaId)).toEqual([]);
}

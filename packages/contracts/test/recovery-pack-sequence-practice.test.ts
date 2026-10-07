import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CreateRecoveryPackPracticeAssignmentSchema,
  FollowupAdvanceSchema,
  FollowupAnswerSubmitSchema,
  FollowupSchema,
  FollowupSnapshotSchema,
  RecoveryPackPracticeSequenceSchema,
  RecoveryPackPracticeSourceSchema,
} from "../src/index.js";

const card = {
  id: randomUUID(),
  title: "Compare equal parts",
  body: "Use a common whole.",
  citations: [],
};
const cardSnapshot = {
  mode: "followup",
  purpose: "assignment",
  followupId: randomUUID(),
  attemptId: randomUUID(),
  version: 2,
  title: "Fractions practice",
  status: "in_progress",
  phase: "intervention",
  practiceMode: "full_sequence",
  intervention: { index: 0, count: 1, card },
  questionIndex: 0,
  questionCount: 2,
  question: null,
  deadline: null,
  timeMode: "timed",
  timeMultiplier: 1,
  response: null,
  confidence: null,
  correct: null,
  correctResponse: null,
  explanation: null,
  feedback: null,
  completedAt: null,
};

describe("Recovery Pack full-sequence practice contracts", () => {
  it("requires the two copied checkpoints for a full-sequence creator view", () => {
    const input = {
      id: randomUUID(),
      purpose: "assignment",
      sourceQuizVersionId: null,
      sourceSessionId: null,
      sourceReportId: null,
      recoveryPackSource: {
        artifactType: "recovery_pack",
        packId: randomUUID(),
        packVersionId: randomUUID(),
        packVersion: 1,
        contentHash: "a".repeat(64),
        packTitle: "Fractions",
        publishedAt: "2026-10-07T10:00:00.000Z",
        sourceItemId: randomUUID(),
        role: "full_sequence",
      },
      title: "Fractions practice",
      conceptKeys: [],
      checkpointCount: 2,
      timeMode: "flex",
      opensAt: "2026-10-07T10:00:00.000Z",
      closesAt: "2026-10-09T10:00:00.000Z",
      expiresAt: "2026-10-10T10:00:00.000Z",
      closedAt: null,
      createdAt: "2026-10-07T10:00:00.000Z",
    };
    expect(FollowupSchema.safeParse(input).success).toBe(true);
    expect(FollowupSchema.safeParse({ ...input, checkpointCount: 1 }).success).toBe(false);
    expect(
      FollowupSchema.safeParse({
        ...input,
        recoveryPackSource: { ...input.recoveryPackSource, role: "delayed_probe" },
      }).success,
    ).toBe(false);
  });

  it("keeps the legacy creation default and explicitly selects full-sequence practice", () => {
    const input = {
      sourcePackVersionId: randomUUID(),
      mutationId: randomUUID(),
      accessSeed: "a".repeat(43),
      closesAt: "2026-10-09T10:00:00.000Z",
    };
    expect(CreateRecoveryPackPracticeAssignmentSchema.parse(input).mode).toBe("delayed_probe");
    expect(
      CreateRecoveryPackPracticeAssignmentSchema.parse({ ...input, mode: "full_sequence" }).mode,
    ).toBe("full_sequence");
    expect(
      CreateRecoveryPackPracticeAssignmentSchema.safeParse({ ...input, mode: "recheck" }).success,
    ).toBe(false);
    expect(
      RecoveryPackPracticeSourceSchema.parse({
        artifactType: "recovery_pack",
        packId: randomUUID(),
        packVersionId: input.sourcePackVersionId,
        packVersion: 1,
        contentHash: "a".repeat(64),
        packTitle: "Fractions",
        publishedAt: "2026-10-07T10:00:00.000Z",
        sourceItemId: randomUUID(),
        role: "full_sequence",
      }).role,
    ).toBe("full_sequence");
  });

  it("bounds frozen cards and rejects duplicate IDs or hidden source payloads", () => {
    const sequence = { schemaVersion: 1, interventions: [card], citations: [] };
    expect(RecoveryPackPracticeSequenceSchema.parse(sequence)).toEqual(sequence);
    for (const change of [
      { interventions: [] },
      { interventions: [card, card] },
      { interventions: Array.from({ length: 6 }, () => ({ ...card, id: randomUUID() })) },
      { delayedProbe: { correctValue: "SECRET" } },
      { schemaVersion: 2 },
    ])
      expect(RecoveryPackPracticeSequenceSchema.safeParse({ ...sequence, ...change }).success).toBe(
        false,
      );
  });

  it("validates only the current card with no answer fields or countdown", () => {
    expect(FollowupSnapshotSchema.parse(cardSnapshot)).toMatchObject({
      phase: "intervention",
      practiceMode: "full_sequence",
      intervention: { index: 0, count: 1, card },
    });
    for (const change of [
      { practiceMode: "delayed_probe" },
      { purpose: "recovery" },
      { status: "completed" },
      { intervention: null },
      { intervention: { index: 1, count: 1, card } },
      { intervention: { index: 0, count: 6, card } },
      { intervention: { index: 0, count: 1, card, futureCards: [card] } },
      { intervention: { index: 0, count: 1, card: { ...card, correctResponse: "SECRET" } } },
      { deadline: "2026-10-07T10:00:00.000Z" },
      { correct: true },
      { correctResponse: { kind: "choice", choiceIds: [randomUUID()] } },
      { response: { kind: "choice", choiceIds: [randomUUID()] } },
      { explanation: "SECRET recheck explanation" },
      { feedback: "SECRET recheck feedback" },
      { confidence: 2 },
      { phase: "answer_reveal" },
    ])
      expect(FollowupSnapshotSchema.safeParse({ ...cardSnapshot, ...change }).success).toBe(false);
  });

  it("requires paired fences while accepting empty legacy advances and answers", () => {
    expect(FollowupAdvanceSchema.parse(undefined)).toEqual({});
    expect(FollowupAdvanceSchema.parse({})).toEqual({});
    expect(
      FollowupAdvanceSchema.parse({ expectedVersion: 2, idempotencyKey: randomUUID() }),
    ).toMatchObject({ expectedVersion: 2 });
    for (const input of [
      { expectedVersion: 2 },
      { idempotencyKey: randomUUID() },
      { expectedVersion: -1, idempotencyKey: randomUUID() },
      { expectedVersion: 2, idempotencyKey: "__proto__" },
      { expectedVersion: 2, idempotencyKey: randomUUID(), cardIndex: 4 },
    ])
      expect(FollowupAdvanceSchema.safeParse(input).success).toBe(false);
    const answer = {
      idempotencyKey: "legacy-answer",
      response: { kind: "choice", choiceIds: [randomUUID()] },
    };
    expect(FollowupAnswerSubmitSchema.safeParse(answer).success).toBe(true);
    expect(
      FollowupAnswerSubmitSchema.safeParse({
        ...answer,
        expectedVersion: 0,
        questionId: randomUUID(),
      }).success,
    ).toBe(true);
    expect(FollowupAnswerSubmitSchema.safeParse({ ...answer, expectedVersion: 0 }).success).toBe(
      false,
    );
    expect(
      FollowupAnswerSubmitSchema.safeParse({ ...answer, questionId: randomUUID() }).success,
    ).toBe(false);
  });
});

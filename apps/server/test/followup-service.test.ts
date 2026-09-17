import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ReportV2Schema, type QuizDraft } from "@openround/contracts";
import { MemoryRepository, type CreatorContext } from "@openround/db";
import { createGameState } from "@openround/game-engine";
import { FollowupService } from "../src/followup-service.js";
import type { FollowupError } from "../src/followup-service.js";

async function fixture(timeMode: "timed" | "flex" = "timed") {
  const repository = new MemoryRepository();
  const service = new FollowupService(repository);
  const workspaceId = randomUUID();
  const userId = randomUUID();
  const sessionId = randomUUID();
  const reportId = randomUUID();
  const participantId = randomUUID();
  const mainId = randomUUID();
  const recheckId = randomUUID();
  const correctChoiceId = randomUUID();
  const now = new Date("2026-09-17T12:00:00.000Z");
  const expiresAt = new Date("2026-10-17T12:00:00.000Z");
  const quiz: QuizDraft = {
    title: "Safety recovery",
    description: "",
    questions: [
      {
        id: mainId,
        type: "single_select",
        prompt: "What should happen first?",
        purpose: "diagnostic",
        confidence: "required",
        delivery: "main",
        conceptKeys: ["lockout"],
        linkedRecheckQuestionId: recheckId,
        choices: [
          { id: randomUUID(), label: "Isolate energy", isCorrect: true },
          { id: randomUUID(), label: "Start work", isCorrect: false },
        ],
        timeLimitSeconds: 20,
        basePoints: 1_000,
        explanation: "Isolate energy first.",
        mediaId: null,
        mediaAlt: null,
      },
      {
        id: recheckId,
        type: "single_select",
        prompt: "Which action makes maintenance safe?",
        purpose: "diagnostic",
        confidence: "required",
        delivery: "recheck",
        conceptKeys: ["lockout"],
        linkedRecheckQuestionId: null,
        choices: [
          {
            id: correctChoiceId,
            label: "Verify zero energy",
            isCorrect: true,
            feedback: "Correct: verify isolation before work.",
          },
          { id: randomUUID(), label: "Rely on the stop button", isCorrect: false },
        ],
        timeLimitSeconds: 40,
        basePoints: 0,
        explanation: "A stop button does not isolate hazardous energy.",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  };
  const state = createGameState({
    sessionId,
    code: "7654321",
    quiz,
    settings: {
      audienceLimit: 20,
      scoringMode: "accuracy",
      resultVisibility: "private",
      allowLateJoin: true,
      nicknamePolicy: "custom",
    },
  });
  await repository.createSession({
    id: sessionId,
    workspaceId,
    quizVersionId: randomUUID(),
    hostId: userId,
    hostTokenHash: "host",
    state: { ...state, phase: "finished" },
    expiresAt,
    retentionExpiresAt: expiresAt,
    createdAt: now,
    updatedAt: now,
  });
  await repository.createParticipant({
    id: participantId,
    sessionId,
    nickname: "Curious Otter",
    tokenHash: "participant-source-token",
    status: "active",
    joinedAt: now,
  });
  await repository.saveReport(
    workspaceId,
    ReportV2Schema.parse({
      id: reportId,
      sessionId,
      schemaVersion: 2,
      status: "ready",
      generatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      metrics: {
        participantCount: 1,
        completedCount: 1,
        answerCount: 1,
        accuracyPercent: 0,
      },
      questions: [
        {
          questionId: mainId,
          prompt: "What should happen first?",
          responses: 1,
          correct: 0,
          accuracyPercent: 0,
          difficult: true,
        },
      ],
      participants: [
        {
          participantId,
          nickname: "Curious Otter",
          score: 0,
          correctCount: 0,
          answerCount: 1,
        },
      ],
      initialAccuracy: { correct: 0, responses: 1, percent: 0 },
      confidenceMatrix: [
        { confidence: 1, correct: 0, incorrect: 0, total: 0 },
        { confidence: 2, correct: 0, incorrect: 0, total: 0 },
        { confidence: 3, correct: 0, incorrect: 1, total: 1 },
      ],
      misconceptions: [],
      interventions: [],
      recovery: [],
      unresolvedConcepts: [
        { conceptKey: "lockout", initiallyIncorrect: 1, recovered: 0, unresolved: 1 },
      ],
      participation: { participants: 1, respondents: 1, percent: 100 },
      responseTime: { responses: 1, medianMs: 2_000, p95Ms: 2_000 },
      qna: { questions: 0, answered: 0, unresolved: 0 },
      participantFeedback: [
        { participantId, correct: 0, responses: 1, unresolvedConcepts: ["lockout"] },
      ],
      evidenceNote: "Session evidence only.",
    }),
  );
  const creator: CreatorContext = {
    userId,
    workspaceId,
    email: "facilitator@example.com",
    segment: "workplace",
    role: "owner",
    plan: "pro",
  };
  const created = await service.create(
    creator,
    reportId,
    {
      conceptKeys: ["lockout"],
      title: "Lockout follow-up",
      timeMode,
      closesAt: new Date(now.getTime() + 7 * 24 * 60 * 60_000).toISOString(),
    },
    now,
  );
  return {
    repository,
    service,
    creator,
    created,
    now,
    correctChoiceId,
    participantId,
  };
}

describe("self-paced follow-up", () => {
  it("uses an immutable linked recheck and resumes one personal attempt", async () => {
    const { service, created, now, correctChoiceId, participantId } = await fixture("timed");
    expect(created.followup).toMatchObject({
      title: "Lockout follow-up",
      conceptKeys: ["lockout"],
      checkpointCount: 1,
      timeMode: "timed",
    });
    expect(created.personalAccess).toHaveLength(1);
    expect(created.personalAccess[0]).toMatchObject({
      participantId,
      nickname: "Curious Otter",
      timeMultiplier: 1,
    });

    const token = created.personalAccess[0]!.token;
    const started = await service.start(created.followup.id, token, undefined, now);
    expect(started.attemptToken).toBe(token);
    expect(started.snapshot).toMatchObject({
      mode: "followup",
      phase: "question_open",
      questionIndex: 0,
      question: { prompt: "Which action makes maintenance safe?" },
    });
    expect(new Date(started.snapshot.deadline!).getTime() - now.getTime()).toBe(40_000);

    await expect(
      service.answer(
        created.followup.id,
        token,
        {
          idempotencyKey: "answer-1",
          response: { kind: "choice", choiceIds: [correctChoiceId] },
        },
        new Date(now.getTime() + 1_000),
      ),
    ).rejects.toMatchObject<Partial<FollowupError>>({ code: "ANSWER_INVALID" });

    const revealed = await service.answer(
      created.followup.id,
      token,
      {
        idempotencyKey: "answer-1",
        response: { kind: "choice", choiceIds: [correctChoiceId] },
        confidence: 2,
      },
      new Date(now.getTime() + 2_000),
    );
    expect(revealed).toMatchObject({
      phase: "answer_reveal",
      correct: true,
      response: { kind: "choice", choiceIds: [correctChoiceId] },
      correctResponse: { kind: "choice", choiceIds: [correctChoiceId] },
      feedback: "Correct: verify isolation before work.",
    });

    const duplicate = await service.answer(
      created.followup.id,
      token,
      {
        idempotencyKey: "answer-1",
        response: { kind: "choice", choiceIds: [correctChoiceId] },
        confidence: 2,
      },
      new Date(now.getTime() + 3_000),
    );
    expect(duplicate.version).toBe(revealed.version);

    const completed = await service.advance(
      created.followup.id,
      token,
      new Date(now.getTime() + 4_000),
    );
    expect(completed).toMatchObject({
      status: "completed",
      phase: "completed",
      question: null,
    });

    const restarted = await service.start(
      created.followup.id,
      token,
      undefined,
      new Date(now.getTime() + 5_000),
    );
    expect(restarted.snapshot.status).toBe("completed");
    expect(restarted.snapshot.attemptId).toBe(completed.attemptId);
  });

  it("supports anonymous flex attempts, accommodation timing, and revocation", async () => {
    const { service, creator, created, now } = await fixture("flex");
    const anonymousAttemptToken = "anonymous-attempt-token-that-is-long-enough";
    const anonymous = await service.start(
      created.followup.id,
      created.genericToken,
      anonymousAttemptToken,
      now,
    );
    expect(anonymous).toMatchObject({
      attemptToken: anonymousAttemptToken,
      snapshot: { timeMode: "flex", deadline: null, timeMultiplier: 1 },
    });

    const pass = await service.createAccommodation(
      creator,
      created.followup.id,
      { label: "Extended time", timeMultiplier: 2 },
      now,
    );
    const accommodated = await service.start(
      created.followup.id,
      pass.access.token!,
      undefined,
      now,
    );
    expect(accommodated.snapshot.timeMultiplier).toBe(2);
    expect(accommodated.snapshot.deadline).toBeNull();

    await service.revokeAccess(creator.workspaceId, created.followup.id, pass.access.id, now);
    await expect(
      service.resume(created.followup.id, pass.access.token!, new Date(now.getTime() + 1)),
    ).rejects.toMatchObject<Partial<FollowupError>>({ code: "UNAUTHORIZED" });

    await service.close(creator.workspaceId, created.followup.id, now);
    await expect(
      service.start(
        created.followup.id,
        created.genericToken,
        "another-anonymous-attempt-token-long-enough",
        new Date(now.getTime() + 1),
      ),
    ).rejects.toMatchObject<Partial<FollowupError>>({ code: "FOLLOWUP_CLOSED" });
  });

  it("moves an expired timed checkpoint to reveal so the attempt can continue", async () => {
    const { repository, service, created, now, correctChoiceId } = await fixture("timed");
    const token = created.personalAccess[0]!.token;
    const started = await service.start(created.followup.id, token, undefined, now);
    const afterDeadline = new Date(new Date(started.snapshot.deadline!).getTime() + 1);

    const timedOut = await service.answer(
      created.followup.id,
      token,
      {
        idempotencyKey: "late-response-is-not-accepted",
        response: { kind: "choice", choiceIds: [correctChoiceId] },
        confidence: 3,
      },
      afterDeadline,
    );

    expect(timedOut).toMatchObject({
      phase: "answer_reveal",
      response: null,
      correct: null,
      correctResponse: { kind: "choice", choiceIds: [correctChoiceId] },
    });
    expect(repository.followupAnswers.size).toBe(0);
    await expect(
      service.resume(created.followup.id, token, new Date(afterDeadline.getTime() + 1)),
    ).resolves.toMatchObject({ phase: "answer_reveal", version: timedOut.version });
    await expect(
      service.advance(created.followup.id, token, new Date(afterDeadline.getTime() + 2)),
    ).resolves.toMatchObject({ status: "completed", phase: "completed" });
  });
});

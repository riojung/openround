import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ReportV2Schema, ReportV3Schema, type QuizDraft } from "@openround/contracts";
import { MemoryRepository, type CreatorContext } from "@openround/db";
import { createGameState } from "@openround/game-engine";
import { FollowupService } from "../src/followup-service.js";
import type { FollowupError } from "../src/followup-service.js";

async function fixture(timeMode: "timed" | "flex" = "timed", reportVersion: 2 | 3 = 2) {
  const repository = new MemoryRepository();
  const service = new FollowupService(repository);
  const workspaceId = randomUUID();
  const userId = randomUUID();
  const sessionId = randomUUID();
  const reportId = randomUUID();
  const quizId = randomUUID();
  const quizVersionId = randomUUID();
  const participantId = randomUUID();
  const mainId = randomUUID();
  const recheckId = randomUUID();
  const mediaId = randomUUID();
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
        mediaId,
        mediaAlt: "Lockout verification diagram",
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
  await repository.createQuiz({
    id: quizId,
    workspaceId,
    title: quiz.title,
    description: quiz.description,
    status: "draft",
    draft: quiz,
    currentVersionId: null,
    folderId: null,
    tags: [],
    createdAt: now,
    updatedAt: now,
  });
  await repository.publishQuiz({
    id: quizVersionId,
    workspaceId,
    quizId,
    version: 1,
    content: quiz,
    contentHash: "followup-service-fixture",
    publishedAt: now,
  });
  await repository.createSession({
    id: sessionId,
    workspaceId,
    quizVersionId,
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
  const reportBase = {
    id: reportId,
    sessionId,
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
  } as const;
  await repository.saveReport(
    workspaceId,
    reportVersion === 3
      ? ReportV3Schema.parse({
          ...reportBase,
          schemaVersion: 3,
          experience: { category: "safety_compliance", preset: { id: "signal", version: 1 } },
          audiencePulse: {
            uniqueParticipants: 0,
            events: 0,
            bySignal: { got_it: 0, unsure: 0, need_example: 0, too_fast: 0 },
            contexts: [],
          },
          conversation: {
            messages: 0,
            uniqueContributors: 0,
            reactions: 0,
            reports: 0,
            removed: 0,
            moderationActions: 0,
            peakMessagesPerMinute: 0,
            transcriptAvailable: false,
          },
        })
      : ReportV2Schema.parse({ ...reportBase, schemaVersion: 2 }),
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
    mediaId,
    correctChoiceId,
    participantId,
  };
}

async function assignmentFixture() {
  const repository = new MemoryRepository();
  const service = new FollowupService(repository);
  const workspaceId = randomUUID();
  const userId = randomUUID();
  const quizId = randomUUID();
  const quizVersionId = randomUUID();
  const mainQuestionId = randomUUID();
  const recheckQuestionId = randomUUID();
  const correctChoiceId = randomUUID();
  const now = new Date("2026-09-19T12:00:00.000Z");
  const published: QuizDraft = {
    title: "Published safety practice",
    description: "Immutable source material",
    questions: [
      {
        id: mainQuestionId,
        type: "single_select",
        prompt: "Which control comes first?",
        purpose: "practice",
        confidence: "optional",
        delivery: "main",
        conceptKeys: ["controls"],
        linkedRecheckQuestionId: recheckQuestionId,
        choices: [
          { id: correctChoiceId, label: "Eliminate the hazard", isCorrect: true },
          { id: randomUUID(), label: "Add a warning", isCorrect: false },
        ],
        timeLimitSeconds: 30,
        basePoints: 1_000,
        explanation: "Elimination is the strongest control.",
        mediaId: null,
        mediaAlt: null,
      },
      {
        id: recheckQuestionId,
        type: "true_false",
        prompt: "A warning is stronger than elimination.",
        purpose: "diagnostic",
        confidence: "off",
        delivery: "recheck",
        conceptKeys: ["controls"],
        linkedRecheckQuestionId: null,
        choices: [
          { id: randomUUID(), label: "True", isCorrect: false },
          { id: randomUUID(), label: "False", isCorrect: true },
        ],
        timeLimitSeconds: 20,
        basePoints: 0,
        explanation: "Warnings depend on behaviour.",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  };
  await repository.createQuiz({
    id: quizId,
    workspaceId,
    title: published.title,
    description: published.description,
    status: "draft",
    draft: published,
    currentVersionId: null,
    folderId: null,
    tags: [],
    createdAt: now,
    updatedAt: now,
  });
  await repository.publishQuiz({
    id: quizVersionId,
    workspaceId,
    quizId,
    version: 1,
    content: published,
    contentHash: "assignment-service-fixture",
    publishedAt: now,
  });
  await repository.updateQuiz(workspaceId, quizId, {
    ...published,
    title: "Unpublished edits",
    questions: published.questions.map((question, index) =>
      index === 0 ? { ...question, prompt: "This draft prompt must not be assigned" } : question,
    ),
  });
  const creator: CreatorContext = {
    userId,
    workspaceId,
    email: "assignment-owner@example.com",
    segment: "workplace",
    role: "owner",
    plan: "pro",
  };
  return {
    repository,
    service,
    creator,
    quizId,
    quizVersionId,
    now,
    correctChoiceId,
  };
}

describe("self-paced follow-up", () => {
  it("creates follow-ups from both ready Report V2 and Report V3 evidence", async () => {
    const v2 = await fixture("flex", 2);
    const v3 = await fixture("flex", 3);
    expect(v2.created.followup.conceptKeys).toEqual(["lockout"]);
    expect(v3.created.followup.conceptKeys).toEqual(["lockout"]);
  });

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

  it("blocks snapshot and media reads after a creator manually closes the follow-up", async () => {
    const { service, creator, created, now, mediaId } = await fixture("flex");
    const token = created.personalAccess[0]!.token;
    await service.start(created.followup.id, token, undefined, now);
    const beforeClose = new Date(now.getTime() + 1);

    await expect(service.resume(created.followup.id, token, beforeClose)).resolves.toMatchObject({
      phase: "question_open",
    });
    await expect(
      service.authorizeMedia(created.followup.id, token, mediaId, beforeClose),
    ).resolves.toBe(creator.workspaceId);

    await service.close(creator.workspaceId, created.followup.id, new Date(now.getTime() + 2));
    const afterClose = new Date(now.getTime() + 3);
    await expect(service.resume(created.followup.id, token, afterClose)).rejects.toMatchObject<
      Partial<FollowupError>
    >({ code: "FOLLOWUP_CLOSED" });
    await expect(
      service.authorizeMedia(created.followup.id, token, mediaId, afterClose),
    ).rejects.toMatchObject<Partial<FollowupError>>({ code: "FOLLOWUP_CLOSED" });
  });

  it("blocks generic attempt reads at close time while preserving expired personal-token errors", async () => {
    const { service, created, now, mediaId } = await fixture("flex");
    const genericAttemptToken = "generic-close-boundary-attempt-token";
    await service.start(created.followup.id, created.genericToken, genericAttemptToken, now);
    const personalToken = created.personalAccess[0]!.token;
    await service.start(created.followup.id, personalToken, undefined, now);
    const closesAt = new Date(created.followup.closesAt);

    await expect(
      service.resume(created.followup.id, genericAttemptToken, closesAt),
    ).rejects.toMatchObject<Partial<FollowupError>>({ code: "FOLLOWUP_CLOSED" });
    await expect(
      service.authorizeMedia(created.followup.id, genericAttemptToken, mediaId, closesAt),
    ).rejects.toMatchObject<Partial<FollowupError>>({ code: "FOLLOWUP_CLOSED" });
    await expect(
      service.resume(created.followup.id, personalToken, closesAt),
    ).rejects.toMatchObject<Partial<FollowupError>>({ code: "UNAUTHORIZED" });
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

  it("creates standalone practice from the immutable published main questions", async () => {
    const { repository, service, creator, quizId, quizVersionId, now } = await assignmentFixture();
    const created = await service.createAssignment(
      creator,
      quizId,
      {
        sourceQuizVersionId: quizVersionId,
        title: "Assigned controls practice",
        timeMode: "flex",
        closesAt: new Date(now.getTime() + 7 * 24 * 60 * 60_000).toISOString(),
        personalLabels: ["Learner A", "Learner B"],
      },
      30,
      100,
      now,
    );

    expect(created.followup).toMatchObject({
      purpose: "assignment",
      sourceQuizVersionId: quizVersionId,
      sourceSessionId: null,
      sourceReportId: null,
      checkpointCount: 1,
      conceptKeys: [],
    });
    expect(created.personalAccess).toEqual([
      expect.objectContaining({
        kind: "assignment_personal",
        participantId: null,
        nickname: null,
        label: "Learner A",
      }),
      expect.objectContaining({
        kind: "assignment_personal",
        participantId: null,
        nickname: null,
        label: "Learner B",
      }),
    ]);
    const personalToken = created.personalAccess[1]!.token;
    const firstStart = await service.start(created.followup.id, personalToken, undefined, now);
    const repeatedStart = await service.start(
      created.followup.id,
      personalToken,
      undefined,
      new Date(now.getTime() + 1_000),
    );
    expect(repeatedStart.snapshot.attemptId).toBe(firstStart.snapshot.attemptId);
    const stored = await repository.getFollowup(creator.workspaceId, created.followup.id);
    expect(stored).toMatchObject({
      purpose: "assignment",
      sourceQuizVersionId: quizVersionId,
      content: {
        title: "Assigned controls practice",
        questions: [
          {
            prompt: "Which control comes first?",
            delivery: "main",
            linkedRecheckQuestionId: null,
          },
        ],
      },
    });
    expect(created.followup.expiresAt).toBe(
      new Date(now.getTime() + 30 * 24 * 60 * 60_000).toISOString(),
    );
    await expect(service.getForCreator(creator.workspaceId, created.followup.id)).resolves.toEqual(
      expect.objectContaining({
        context: expect.objectContaining({
          quizId,
          quizTitle: "Published safety practice",
          version: 1,
        }),
        access: expect.arrayContaining([
          expect.objectContaining({ label: "Learner A", nickname: null }),
        ]),
      }),
    );
    await expect(
      service.createAssignmentPersonalPass(
        creator,
        created.followup.id,
        "Over the plan limit",
        2,
        now,
      ),
    ).rejects.toMatchObject<Partial<FollowupError>>({ code: "ANSWER_INVALID" });
    await service.revokeAccess(
      creator.workspaceId,
      created.followup.id,
      created.personalAccess[0]!.id,
      now,
    );
    await expect(
      service.createAssignmentPersonalPass(
        creator,
        created.followup.id,
        "Revocation does not restore quota",
        2,
        now,
      ),
    ).rejects.toMatchObject<Partial<FollowupError>>({ code: "ANSWER_INVALID" });
    await expect(
      service.createAssignmentPersonalPass(
        creator,
        created.followup.id,
        "Replacement link",
        100,
        now,
      ),
    ).resolves.toEqual({
      access: expect.objectContaining({
        kind: "assignment_personal",
        label: "Replacement link",
        participantId: null,
        token: expect.any(String),
      }),
    });
  });

  it("enforces assignment retention and the plan's personal-link ceiling", async () => {
    const { service, creator, quizId, quizVersionId, now } = await assignmentFixture();
    const base = {
      sourceQuizVersionId: quizVersionId,
      timeMode: "flex" as const,
      closesAt: new Date(now.getTime() + 7 * 24 * 60 * 60_000).toISOString(),
      personalLabels: ["Learner A", "Learner B"],
    };

    await expect(service.createAssignment(creator, quizId, base, 30, 1, now)).rejects.toMatchObject<
      Partial<FollowupError>
    >({ code: "ANSWER_INVALID" });
    await expect(
      service.createAssignment(
        creator,
        quizId,
        {
          ...base,
          closesAt: new Date(now.getTime() + 31 * 24 * 60 * 60_000).toISOString(),
          personalLabels: [],
        },
        30,
        100,
        now,
      ),
    ).rejects.toMatchObject<Partial<FollowupError>>({ code: "ANSWER_INVALID" });
  });

  it("requires an active published Round for a new assignment", async () => {
    const { repository, service, creator, quizId, quizVersionId, now } = await assignmentFixture();
    await repository.archiveQuiz(creator.workspaceId, quizId, true);

    await expect(
      service.createAssignment(
        creator,
        quizId,
        {
          sourceQuizVersionId: quizVersionId,
          timeMode: "flex",
          closesAt: new Date(now.getTime() + 24 * 60 * 60_000).toISOString(),
          personalLabels: [],
        },
        30,
        100,
        now,
      ),
    ).rejects.toMatchObject<Partial<FollowupError>>({ code: "CONFLICT" });
  });

  it("rejects a source version that became stale before assignment creation", async () => {
    const { repository, service, creator, quizId, quizVersionId, now } = await assignmentFixture();
    const original = await repository.getQuizVersion(creator.workspaceId, quizVersionId);
    expect(original).not.toBeNull();
    await repository.publishQuiz({
      ...original!,
      id: randomUUID(),
      version: 2,
      contentHash: "assignment-service-fixture-v2",
      publishedAt: new Date(now.getTime() + 1_000),
    });

    await expect(
      service.createAssignment(
        creator,
        quizId,
        {
          sourceQuizVersionId: quizVersionId,
          timeMode: "flex",
          closesAt: new Date(now.getTime() + 24 * 60 * 60_000).toISOString(),
          personalLabels: [],
        },
        30,
        100,
        new Date(now.getTime() + 2_000),
      ),
    ).rejects.toMatchObject<Partial<FollowupError>>({
      code: "CONFLICT",
      message: "The published Round changed. Refresh before assigning practice",
    });
    expect(repository.followups.size).toBe(0);
  });
});

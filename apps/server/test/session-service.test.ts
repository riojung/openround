import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuizDraft, Report } from "@openround/contracts";
import { MemoryRepository, type ParticipantRecord, type StoredSession } from "@openround/db";
import { addParticipant, applyHostCommand, createGameState } from "@openround/game-engine";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { MetricsService } from "../src/metrics.js";
import { hashToken } from "../src/security.js";
import { SessionService } from "../src/session-service.js";

const config = ConfigSchema.parse({
  NODE_ENV: "test",
  ALLOW_IN_MEMORY: "true",
  COMMUNITY_MODE: "false",
  WEB_ORIGIN: "http://localhost:3000",
  PUBLIC_API_URL: "http://localhost:4000",
  LOG_LEVEL: "silent",
});

function quizFixture(): { quiz: QuizDraft; correctChoiceId: string } {
  const correctChoiceId = randomUUID();
  return {
    correctChoiceId,
    quiz: {
      title: "Session service fixture",
      description: "",
      questions: [
        {
          id: randomUUID(),
          type: "true_false",
          prompt: "Durable answers are accepted before the deadline.",
          choices: [
            { id: correctChoiceId, label: "True", isCorrect: true },
            { id: randomUUID(), label: "False", isCorrect: false },
          ],
          timeLimitSeconds: 20,
          basePoints: 1_000,
          explanation: "",
          mediaId: null,
          mediaAlt: null,
        },
      ],
    },
  };
}

function storedSession(input: {
  state: ReturnType<typeof createGameState>;
  hostToken: string;
}): StoredSession {
  const now = new Date();
  return {
    id: input.state.sessionId,
    workspaceId: randomUUID(),
    quizVersionId: randomUUID(),
    hostId: randomUUID(),
    hostTokenHash: hashToken(input.hostToken),
    state: input.state,
    expiresAt: new Date(now.getTime() + 60_000),
    retentionExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    createdAt: now,
    updatedAt: now,
  };
}

async function openQuestionFixture(participantCount: number) {
  const repository = new MemoryRepository();
  const service = new SessionService(
    repository,
    new MemorySessionCache(),
    config,
    new MetricsService(),
  );
  const { quiz, correctChoiceId } = quizFixture();
  const sessionId = randomUUID();
  const hostToken = "host-answer-batch-token-long-enough";
  const participantInputs = Array.from({ length: participantCount }, (_, index) => ({
    id: randomUUID(),
    nickname: `Learner ${index + 1}`,
    token: `answer-batch-token-${index}-${randomUUID()}`,
  }));
  let state = createGameState({
    sessionId,
    code: "3456789",
    quiz,
    settings: {
      audienceLimit: 20,
      scoringMode: "accuracy",
      resultVisibility: "private",
      allowLateJoin: true,
      nicknamePolicy: "custom",
    },
  });
  for (const participant of participantInputs) {
    state = addParticipant(state, {
      id: participant.id,
      nickname: participant.nickname,
      score: 0,
      correctCount: 0,
      acceptedResponseMs: 0,
      connected: true,
      kicked: false,
    }).state;
  }
  state = applyHostCommand(state, {
    commandId: randomUUID(),
    expectedVersion: state.version,
    action: "start",
    nowMs: Date.now(),
    newRoundId: randomUUID,
  }).state;
  await repository.createSession(storedSession({ state, hostToken }));
  for (const participant of participantInputs) {
    await repository.createParticipant({
      id: participant.id,
      sessionId,
      nickname: participant.nickname,
      tokenHash: hashToken(participant.token),
      status: "active",
      joinedAt: new Date(),
    });
  }
  await service.snapshot({ sessionId, hostToken, role: "host" });
  return { correctChoiceId, hostToken, participantInputs, repository, service, sessionId, state };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("session service ordering", () => {
  it("reserves PostgreSQL capacity while synchronized rooms commit answers", async () => {
    const service = new SessionService(
      new MemoryRepository(),
      new MemorySessionCache(),
      config,
      new MetricsService(),
    );
    const commitGate = service as unknown as {
      withAnswerCommitSlot<T>(work: () => Promise<T>): Promise<T>;
    };
    let releaseCommits!: () => void;
    const commitsBlocked = new Promise<void>((resolve) => {
      releaseCommits = resolve;
    });
    let activeCommits = 0;
    let maximumActiveCommits = 0;
    const commits = Array.from({ length: 10 }, () =>
      commitGate.withAnswerCommitSlot(async () => {
        activeCommits += 1;
        maximumActiveCommits = Math.max(maximumActiveCommits, activeCommits);
        await commitsBlocked;
        activeCommits -= 1;
      }),
    );

    await vi.waitFor(() => expect(activeCommits).toBe(8));
    expect(maximumActiveCommits).toBe(8);
    releaseCommits();
    await Promise.all(commits);
    expect(activeCommits).toBe(0);
    service.close();
  });

  it("does not admit anonymous code-entry participants when institution identity is required", async () => {
    const repository = new MemoryRepository();
    const cache = new MemorySessionCache();
    const service = new SessionService(repository, cache, config, new MetricsService());
    const { quiz } = quizFixture();
    const state = createGameState({
      sessionId: randomUUID(),
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
    const stored = storedSession({ state, hostToken: "host-token-long-enough-for-test" });
    await repository.createSession(stored);
    repository.institutionPolicies.set(stored.workspaceId, {
      workspaceId: stored.workspaceId,
      contractStatus: "pilot",
      identityRequirement: "institution",
      capabilities: {
        oidc: false,
        managedSso: false,
        scim: false,
        lti: true,
        nrps: false,
        ags: false,
        auditExports: true,
        residencyControls: true,
      },
      k12Enabled: false,
      updatedAt: new Date(),
    });
    const sessionLookup = vi.spyOn(repository, "getSessionByCode");
    const policyLookup = vi.spyOn(repository, "getInstitutionPolicy");

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, index) =>
        service.join({ code: "7654321", nickname: `Anonymous learner ${index + 1}` }),
      ),
    );

    expect(results).toHaveLength(5);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toMatchObject({ code: "INSTITUTION_AUTH_REQUIRED" });
      }
    }
    expect(sessionLookup).toHaveBeenCalledTimes(1);
    expect(policyLookup).toHaveBeenCalledTimes(1);
    expect(repository.participants.size).toBe(0);
    service.close();
  });

  it("coalesces session and policy lookups for concurrent code joins", async () => {
    const repository = new MemoryRepository();
    const cache = new MemorySessionCache();
    const service = new SessionService(repository, cache, config, new MetricsService());
    const { quiz } = quizFixture();
    const state = createGameState({
      sessionId: randomUUID(),
      code: "8765432",
      quiz,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    });
    await repository.createSession(
      storedSession({ state, hostToken: "host-token-long-enough-for-test" }),
    );
    const sessionLookup = vi.spyOn(repository, "getSessionByCode");
    const policyLookup = vi.spyOn(repository, "getInstitutionPolicy");

    const joined = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        service.join({ code: "8765432", nickname: `Learner ${index + 1}` }),
      ),
    );

    expect(new Set(joined.map(({ participantId }) => participantId)).size).toBe(20);
    expect(sessionLookup).toHaveBeenCalledTimes(1);
    expect(policyLookup).toHaveBeenCalledTimes(1);
    service.close();
  });

  it("accepts an answer received before the deadline even when credential lookup finishes later", async () => {
    vi.useFakeTimers();
    const receivedAtMs = new Date("2026-09-15T12:00:00.000Z").getTime();
    vi.setSystemTime(receivedAtMs);
    const repository = new MemoryRepository();
    const cache = new MemorySessionCache();
    const service = new SessionService(repository, cache, config, new MetricsService());
    const { quiz, correctChoiceId } = quizFixture();
    const sessionId = randomUUID();
    const participantId = randomUUID();
    const participantToken = "participant-token-long-enough-for-test";
    let state = createGameState({
      sessionId,
      code: "1234567",
      quiz,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    });
    state = addParticipant(state, {
      id: participantId,
      nickname: "Deadline learner",
      score: 0,
      correctCount: 0,
      acceptedResponseMs: 0,
      connected: true,
      kicked: false,
    }).state;
    state = applyHostCommand(state, {
      commandId: randomUUID(),
      expectedVersion: state.version,
      action: "start",
      nowMs: receivedAtMs,
      newRoundId: randomUUID,
    }).state;
    const deadlineMs = receivedAtMs + 100;
    state.deadlineMs = deadlineMs;
    const stored = storedSession({ state, hostToken: "host-token-long-enough-for-test" });
    const participant: ParticipantRecord = {
      id: participantId,
      sessionId,
      nickname: "Deadline learner",
      tokenHash: hashToken(participantToken),
      status: "active",
      joinedAt: new Date(receivedAtMs),
    };
    await repository.createSession(stored);
    await repository.createParticipant(participant);

    let releaseLookup!: () => void;
    const delayedLookup = new Promise<ParticipantRecord>((resolve) => {
      releaseLookup = () => resolve(participant);
    });
    vi.spyOn(repository, "getParticipantByToken").mockReturnValue(delayedLookup);
    const answer = service.answer({
      sessionId,
      participantToken,
      roundId: state.roundId!,
      choiceId: correctChoiceId,
      idempotencyKey: randomUUID(),
    });
    vi.setSystemTime(deadlineMs + 1);
    const automaticLock = (
      service as unknown as {
        autoLock(targetSessionId: string, cutoffMs: number): Promise<void>;
      }
    ).autoLock(sessionId, deadlineMs);
    releaseLookup();

    await expect(answer).resolves.toMatchObject({ accepted: true, duplicate: false, score: 1_000 });
    await automaticLock;
    expect((await repository.getSessionById(sessionId))?.state).toMatchObject({
      phase: "question_locked",
      answers: expect.objectContaining({}),
    });
    expect(repository.answers).toHaveLength(1);
    service.close();
  });

  it("keeps a synchronized open-round burst in one complete answer batch", async () => {
    vi.useFakeTimers();
    const { correctChoiceId, participantInputs, repository, service, sessionId, state } =
      await openQuestionFixture(3);
    const commitAnswers = vi.spyOn(repository, "commitAnswers");

    const first = service.answer({
      sessionId,
      participantToken: participantInputs[0]!.token,
      roundId: state.roundId!,
      choiceId: correctChoiceId,
      idempotencyKey: randomUUID(),
    });
    await vi.advanceTimersByTimeAsync(40);
    expect(commitAnswers).not.toHaveBeenCalled();

    const second = service.answer({
      sessionId,
      participantToken: participantInputs[1]!.token,
      roundId: state.roundId!,
      choiceId: correctChoiceId,
      idempotencyKey: randomUUID(),
    });
    await vi.advanceTimersByTimeAsync(20);
    expect(commitAnswers).not.toHaveBeenCalled();

    const third = service.answer({
      sessionId,
      participantToken: participantInputs[2]!.token,
      roundId: state.roundId!,
      choiceId: correctChoiceId,
      idempotencyKey: randomUUID(),
    });
    await vi.advanceTimersByTimeAsync(0);

    await expect(Promise.all([first, second, third])).resolves.toEqual([
      expect.objectContaining({ accepted: true, duplicate: false }),
      expect.objectContaining({ accepted: true, duplicate: false }),
      expect.objectContaining({ accepted: true, duplicate: false }),
    ]);
    expect(commitAnswers).toHaveBeenCalledTimes(1);
    expect(commitAnswers.mock.calls[0]?.[1]).toHaveLength(3);
    expect(commitAnswers.mock.calls[0]?.[3]).toEqual({ roundEvidencePersisted: true });
    service.close();
  });

  it("caps a trailing answer batch while the room remains incomplete", async () => {
    vi.useFakeTimers();
    const { correctChoiceId, participantInputs, repository, service, sessionId, state } =
      await openQuestionFixture(5);
    const commitAnswers = vi.spyOn(repository, "commitAnswers");
    const answers: Array<ReturnType<SessionService["answer"]>> = [];

    for (let index = 0; index < 4; index += 1) {
      answers.push(
        service.answer({
          sessionId,
          participantToken: participantInputs[index]!.token,
          roundId: state.roundId!,
          choiceId: correctChoiceId,
          idempotencyKey: randomUUID(),
        }),
      );
      await vi.advanceTimersByTimeAsync(index === 3 ? 29 : 40);
    }

    expect(commitAnswers).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(Promise.all(answers)).resolves.toHaveLength(4);
    expect(commitAnswers).toHaveBeenCalledTimes(1);
    expect(commitAnswers.mock.calls[0]?.[1]).toHaveLength(4);
    service.close();
  });

  it("holds answers received after a lock command behind the host mutation", async () => {
    vi.useFakeTimers();
    const startedAtMs = new Date("2026-09-18T12:00:00.000Z").getTime();
    vi.setSystemTime(startedAtMs);
    const { correctChoiceId, hostToken, participantInputs, repository, service, sessionId, state } =
      await openQuestionFixture(3);
    const commitAnswers = vi.spyOn(repository, "commitAnswers");

    let releaseParticipantLookup!: () => void;
    const participantLookupBlocked = new Promise<void>((resolve) => {
      releaseParticipantLookup = resolve;
    });
    const getParticipantByToken = repository.getParticipantByToken.bind(repository);
    vi.spyOn(repository, "getParticipantByToken").mockImplementationOnce(
      async (participantTokenHash) => {
        await participantLookupBlocked;
        return getParticipantByToken(participantTokenHash);
      },
    );

    const beforeLock = service.answer({
      sessionId,
      participantToken: participantInputs[0]!.token,
      roundId: state.roundId!,
      choiceId: correctChoiceId,
      idempotencyKey: randomUUID(),
    });

    vi.setSystemTime(startedAtMs + 10);
    const lock = service.hostCommand({
      sessionId,
      hostToken,
      action: "lock",
      commandId: randomUUID(),
      expectedVersion: state.version + 1,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(
      (
        service as unknown as {
          answerIngressBarriers: Map<string, unknown>;
        }
      ).answerIngressBarriers.has(sessionId),
    ).toBe(true);

    vi.setSystemTime(startedAtMs + 20);
    const afterLock = service.answer({
      sessionId,
      participantToken: participantInputs[1]!.token,
      roundId: state.roundId!,
      choiceId: correctChoiceId,
      idempotencyKey: randomUUID(),
    });
    await vi.advanceTimersByTimeAsync(0);

    releaseParticipantLookup();
    await vi.advanceTimersByTimeAsync(0);

    await expect(beforeLock).resolves.toMatchObject({ accepted: true, duplicate: false });
    await expect(lock).resolves.toMatchObject({ phase: "question_locked" });
    await vi.advanceTimersByTimeAsync(0);
    await expect(afterLock).resolves.toMatchObject({ accepted: false, duplicate: false });
    expect(commitAnswers).toHaveBeenCalledTimes(1);
    expect(commitAnswers.mock.calls[0]?.[1]).toHaveLength(1);
    expect(repository.answers).toHaveLength(1);
    service.close();
  });

  it("does not let an unauthorized closing command stall answers", async () => {
    vi.useFakeTimers();
    const startedAtMs = new Date("2026-09-18T13:00:00.000Z").getTime();
    vi.setSystemTime(startedAtMs);
    const { correctChoiceId, participantInputs, repository, service, sessionId, state } =
      await openQuestionFixture(1);

    let releaseAuthorization!: () => void;
    const authorizationBlocked = new Promise<void>((resolve) => {
      releaseAuthorization = resolve;
    });
    const getSessionById = repository.getSessionById.bind(repository);
    vi.spyOn(repository, "getSessionById").mockImplementationOnce(async (targetSessionId) => {
      await authorizationBlocked;
      return getSessionById(targetSessionId);
    });

    vi.setSystemTime(startedAtMs + 10);
    const unauthorizedLock = service.hostCommand({
      sessionId,
      hostToken: "invalid-host-token-long-enough",
      action: "lock",
      commandId: randomUUID(),
      expectedVersion: state.version,
    });
    vi.setSystemTime(startedAtMs + 20);
    const answer = service.answer({
      sessionId,
      participantToken: participantInputs[0]!.token,
      roundId: state.roundId!,
      choiceId: correctChoiceId,
      idempotencyKey: randomUUID(),
    });
    const unauthorizedLockRejection = expect(unauthorizedLock).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(
      (
        service as unknown as {
          answerIngressBarriers: Map<string, unknown>;
        }
      ).answerIngressBarriers.has(sessionId),
    ).toBe(false);
    await expect(answer).resolves.toMatchObject({ accepted: true, duplicate: false });
    expect(repository.answers).toHaveLength(1);

    releaseAuthorization();
    await vi.advanceTimersByTimeAsync(0);

    await unauthorizedLockRejection;
    expect((await repository.getSessionById(sessionId))?.state.phase).toBe("question_open");
    service.close();
  });

  it("rejects a held answer when the service closes", async () => {
    vi.useFakeTimers();
    const startedAtMs = new Date("2026-09-18T14:00:00.000Z").getTime();
    vi.setSystemTime(startedAtMs);
    const { correctChoiceId, hostToken, participantInputs, repository, service, sessionId, state } =
      await openQuestionFixture(2);

    let releaseParticipantLookup!: () => void;
    const participantLookupBlocked = new Promise<void>((resolve) => {
      releaseParticipantLookup = resolve;
    });
    const getParticipantByToken = repository.getParticipantByToken.bind(repository);
    vi.spyOn(repository, "getParticipantByToken").mockImplementationOnce(
      async (participantTokenHash) => {
        await participantLookupBlocked;
        return getParticipantByToken(participantTokenHash);
      },
    );

    const beforeLock = service.answer({
      sessionId,
      participantToken: participantInputs[0]!.token,
      roundId: state.roundId!,
      choiceId: correctChoiceId,
      idempotencyKey: randomUUID(),
    });

    vi.setSystemTime(startedAtMs + 10);
    const lock = service.hostCommand({
      sessionId,
      hostToken,
      action: "lock",
      commandId: randomUUID(),
      expectedVersion: state.version + 1,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(
      (
        service as unknown as {
          answerIngressBarriers: Map<string, unknown>;
        }
      ).answerIngressBarriers.has(sessionId),
    ).toBe(true);

    vi.setSystemTime(startedAtMs + 20);
    const afterLock = service.answer({
      sessionId,
      participantToken: participantInputs[1]!.token,
      roundId: state.roundId!,
      choiceId: correctChoiceId,
      idempotencyKey: randomUUID(),
    });
    const beforeLockRejection = expect(beforeLock).rejects.toMatchObject({ code: "CONFLICT" });
    const afterLockRejection = expect(afterLock).rejects.toMatchObject({ code: "CONFLICT" });
    const lockRejection = expect(lock).rejects.toMatchObject({ code: "CONFLICT" });
    await vi.advanceTimersByTimeAsync(0);

    service.close();
    releaseParticipantLookup();
    await vi.advanceTimersByTimeAsync(0);

    await beforeLockRejection;
    await afterLockRejection;
    await lockRejection;
    expect(repository.answers).toHaveLength(0);
  });

  it("rejects an idempotency key reused for a different round", async () => {
    const repository = new MemoryRepository();
    const service = new SessionService(
      repository,
      new MemorySessionCache(),
      config,
      new MetricsService(),
    );
    const first = quizFixture();
    const secondCorrectChoiceId = randomUUID();
    const secondQuestion = {
      ...structuredClone(first.quiz.questions[0]!),
      id: randomUUID(),
      prompt: "A different checkpoint needs a different idempotency key.",
      choices: [
        { id: secondCorrectChoiceId, label: "True", isCorrect: true },
        { id: randomUUID(), label: "False", isCorrect: false },
      ],
    };
    const sessionId = randomUUID();
    const participantId = randomUUID();
    const participantToken = "participant-idempotency-token-long-enough";
    const hostToken = "host-idempotency-token-long-enough";
    let state = createGameState({
      sessionId,
      code: "2345678",
      quiz: { ...first.quiz, questions: [first.quiz.questions[0]!, secondQuestion] },
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    });
    state = addParticipant(state, {
      id: participantId,
      nickname: "Retry tester",
      score: 0,
      correctCount: 0,
      acceptedResponseMs: 0,
      connected: true,
      kicked: false,
    }).state;
    state = applyHostCommand(state, {
      commandId: randomUUID(),
      expectedVersion: state.version,
      action: "start",
      nowMs: Date.now(),
      newRoundId: randomUUID,
    }).state;
    await repository.createSession(storedSession({ state, hostToken }));
    await repository.createParticipant({
      id: participantId,
      sessionId,
      nickname: "Retry tester",
      tokenHash: hashToken(participantToken),
      status: "active",
      joinedAt: new Date(),
    });
    const reusedKey = "same-key-must-not-cross-rounds";
    await expect(
      service.answer({
        sessionId,
        participantToken,
        roundId: state.roundId!,
        response: { kind: "choice", choiceIds: [first.correctChoiceId] },
        idempotencyKey: reusedKey,
      }),
    ).resolves.toMatchObject({ accepted: true, duplicate: false });

    let snapshot = await service.hostCommand({
      sessionId,
      hostToken,
      commandId: randomUUID(),
      expectedVersion: (await repository.getSessionById(sessionId))!.state.version,
      action: "lock",
    });
    snapshot = await service.hostCommand({
      sessionId,
      hostToken,
      commandId: randomUUID(),
      expectedVersion: snapshot.version,
      action: "reveal",
    });
    snapshot = await service.hostCommand({
      sessionId,
      hostToken,
      commandId: randomUUID(),
      expectedVersion: snapshot.version,
      action: "next",
    });

    await expect(
      service.answer({
        sessionId,
        participantToken,
        roundId: snapshot.roundId!,
        response: { kind: "choice", choiceIds: [secondCorrectChoiceId] },
        idempotencyKey: reusedKey,
      }),
    ).resolves.toMatchObject({
      accepted: false,
      duplicate: false,
      code: "ANSWER_INVALID",
    });
    expect(repository.answers).toHaveLength(1);
    service.close();
  });

  it("rolls final state back when its report cannot be persisted, then succeeds on retry", async () => {
    class FailOnceFinalizationRepository extends MemoryRepository {
      private failFinalization = true;

      override async saveSession(input: StoredSession, expectedVersion: number, report?: Report) {
        if (report && this.failFinalization) {
          this.failFinalization = false;
          throw new Error("simulated report persistence failure");
        }
        return super.saveSession(input, expectedVersion, report);
      }

      override async saveReport(workspaceId: string, report: Report) {
        if (this.failFinalization) {
          this.failFinalization = false;
          throw new Error("simulated report persistence failure");
        }
        return super.saveReport(workspaceId, report);
      }
    }

    const repository = new FailOnceFinalizationRepository();
    const service = new SessionService(
      repository,
      new MemorySessionCache(),
      config,
      new MetricsService(),
    );
    const { quiz } = quizFixture();
    const hostToken = "host-token-long-enough-for-finalization";
    let state = createGameState({
      sessionId: randomUUID(),
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
    for (const action of ["start", "lock", "reveal"] as const) {
      state = applyHostCommand(state, {
        commandId: randomUUID(),
        expectedVersion: state.version,
        action,
        nowMs: Date.now(),
        newRoundId: randomUUID,
      }).state;
    }
    const stored = storedSession({ state, hostToken });
    await repository.createSession(stored);
    const command = {
      sessionId: stored.id,
      hostToken,
      commandId: randomUUID(),
      expectedVersion: state.version,
      action: "next" as const,
    };

    await expect(service.hostCommand(command)).rejects.toThrow(
      "simulated report persistence failure",
    );
    expect((await repository.getSessionById(stored.id))?.state.phase).toBe("question_reveal");
    expect(await repository.getReportBySession(stored.workspaceId, stored.id)).toBeNull();

    await expect(service.hostCommand(command)).resolves.toMatchObject({ phase: "finished" });
    expect((await repository.getSessionById(stored.id))?.state.phase).toBe("finished");
    expect(await repository.getReportBySession(stored.workspaceId, stored.id)).toMatchObject({
      sessionId: stored.id,
      status: "pending",
      schemaVersion: 3,
    });
    service.close();
  });
});

import { randomUUID } from "node:crypto";
import type { QuizDraft } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  acceptAnswer,
  addParticipant,
  applyHostCommand,
  calculateScore,
  createGameState,
  EngineError,
  leaderboard,
  snapshotForRole,
  upgradeGameState,
} from "../src/index.js";

function fixture() {
  const correctId = randomUUID();
  const wrongId = randomUUID();
  return {
    correctId,
    wrongId,
    state: createGameState({
      sessionId: randomUUID(),
      code: "1234567",
      quiz: {
        title: "Demo",
        description: "",
        questions: [
          {
            id: randomUUID(),
            type: "single_select",
            prompt: "What is two plus two?",
            choices: [
              { id: correctId, label: "Four", isCorrect: true },
              { id: wrongId, label: "Five", isCorrect: false },
            ],
            timeLimitSeconds: 10,
            basePoints: 1_000,
            explanation: "Two pairs make four.",
            mediaId: null,
            mediaAlt: null,
            sourceCitations: [
              {
                sourceName: "Private facilitator guide.pdf",
                sourceDigest: "a".repeat(64),
                locator: "page 2",
                excerpt: "Two pairs make four.",
              },
            ],
          },
        ],
      },
      settings: {
        audienceLimit: 20,
        scoringMode: "speed",
        resultVisibility: "leaderboard",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    }),
  };
}

function stateForQuestions(questions: QuizDraft["questions"]) {
  return createGameState({
    sessionId: randomUUID(),
    code: "1234567",
    quiz: { title: "Response types", description: "", questions },
    settings: {
      audienceLimit: 20,
      scoringMode: "accuracy",
      resultVisibility: "private",
      allowLateJoin: true,
      nicknamePolicy: "custom",
    },
  });
}

function participant(id = randomUUID()) {
  return {
    id,
    nickname: "Learner",
    score: 0,
    correctCount: 0,
    acceptedResponseMs: 0,
    connected: true,
    kicked: false,
  };
}

describe("game engine", () => {
  it("uses the independently specified scoring formula at its boundaries", () => {
    expect(
      calculateScore({
        correct: true,
        basePoints: 1_000,
        elapsedMs: 0,
        limitMs: 10_000,
        mode: "speed",
      }),
    ).toBe(1_000);
    expect(
      calculateScore({
        correct: true,
        basePoints: 1_000,
        elapsedMs: 5_000,
        limitMs: 10_000,
        mode: "speed",
      }),
    ).toBe(800);
    expect(
      calculateScore({
        correct: true,
        basePoints: 1_000,
        elapsedMs: 10_000,
        limitMs: 10_000,
        mode: "speed",
      }),
    ).toBe(600);
    expect(
      calculateScore({
        correct: true,
        basePoints: 1_000,
        elapsedMs: 20_000,
        limitMs: 10_000,
        mode: "speed",
      }),
    ).toBe(600);
    expect(
      calculateScore({
        correct: true,
        basePoints: 1_000,
        elapsedMs: 9_999,
        limitMs: 10_000,
        mode: "accuracy",
      }),
    ).toBe(1_000);
    expect(
      calculateScore({
        correct: false,
        basePoints: 1_000,
        elapsedMs: 0,
        limitMs: 10_000,
        mode: "speed",
      }),
    ).toBe(0);

    for (const basePoints of [0, 1, 999, 10_000]) {
      for (let elapsedMs = 0; elapsedMs <= 20_000; elapsedMs += 137) {
        const score = calculateScore({
          correct: true,
          basePoints,
          elapsedMs,
          limitMs: 10_000,
          mode: "speed",
        });
        expect(score).toBeGreaterThanOrEqual(Math.round(basePoints * 0.6));
        expect(score).toBeLessThanOrEqual(basePoints);
      }
    }
  });

  it("rejects stale host versions without changing state", () => {
    const { state } = fixture();
    const before = structuredClone(state);

    try {
      applyHostCommand(state, {
        action: "start",
        commandId: randomUUID(),
        expectedVersion: state.version + 1,
        nowMs: 1_000,
        newRoundId: randomUUID,
      });
      throw new Error("Expected a stale-version error");
    } catch (error) {
      expect(error).toBeInstanceOf(EngineError);
      expect((error as EngineError).code).toBe("STALE_VERSION");
    }

    expect(state).toEqual(before);
  });

  it("does not advance twice when a host command is retried", () => {
    const { state } = fixture();
    const commandId = randomUUID();
    const started = applyHostCommand(state, {
      action: "start",
      commandId,
      expectedVersion: 0,
      nowMs: 1_000,
      newRoundId: randomUUID,
    });
    const retried = applyHostCommand(started.state, {
      action: "start",
      commandId,
      expectedVersion: 0,
      nowMs: 1_001,
      newRoundId: randomUUID,
    });

    expect(retried.duplicate).toBe(true);
    expect(retried.state.version).toBe(started.state.version);
  });

  it("accepts one durable effect for answer retries", () => {
    const { state, correctId } = fixture();
    const participantId = randomUUID();
    const joined = addParticipant(state, {
      id: participantId,
      nickname: "Robin",
      score: 0,
      correctCount: 0,
      acceptedResponseMs: 0,
      connected: true,
      kicked: false,
    });
    const started = applyHostCommand(joined.state, {
      action: "start",
      commandId: randomUUID(),
      expectedVersion: joined.state.version,
      nowMs: 1_000,
      newRoundId: randomUUID,
    });
    const idempotencyKey = randomUUID();
    const first = acceptAnswer(started.state, {
      answerId: randomUUID(),
      participantId,
      roundId: started.state.roundId!,
      choiceId: correctId,
      idempotencyKey,
      nowMs: 2_000,
    });
    const retry = acceptAnswer(first.state, {
      answerId: randomUUID(),
      participantId,
      roundId: started.state.roundId!,
      choiceId: correctId,
      idempotencyKey,
      nowMs: 2_100,
    });

    expect(retry.answer.answerId).toBe(first.answer.answerId);
    expect(retry.state.participants[participantId]?.score).toBe(
      first.state.participants[participantId]?.score,
    );
  });

  it("accepts the deadline boundary and rejects an answer one millisecond late", () => {
    const startSession = () => {
      const { state, correctId } = fixture();
      const participantId = randomUUID();
      const joined = addParticipant(state, {
        id: participantId,
        nickname: "Deadline tester",
        score: 0,
        correctCount: 0,
        acceptedResponseMs: 0,
        connected: true,
        kicked: false,
      });
      const started = applyHostCommand(joined.state, {
        action: "start",
        commandId: randomUUID(),
        expectedVersion: joined.state.version,
        nowMs: 1_000,
        newRoundId: randomUUID,
      });
      return { correctId, participantId, started };
    };

    const onTime = startSession();
    const accepted = acceptAnswer(onTime.started.state, {
      answerId: randomUUID(),
      participantId: onTime.participantId,
      roundId: onTime.started.state.roundId!,
      choiceId: onTime.correctId,
      idempotencyKey: randomUUID(),
      nowMs: 11_000,
    });
    expect(accepted.answer.responseMs).toBe(10_000);
    expect(accepted.answer.score).toBe(600);

    const late = startSession();
    try {
      acceptAnswer(late.started.state, {
        answerId: randomUUID(),
        participantId: late.participantId,
        roundId: late.started.state.roundId!,
        choiceId: late.correctId,
        idempotencyKey: randomUUID(),
        nowMs: 11_001,
      });
      throw new Error("Expected a late-answer error");
    } catch (error) {
      expect(error).toBeInstanceOf(EngineError);
      expect((error as EngineError).code).toBe("ANSWER_LATE");
    }
  });

  it("preserves the remaining server deadline across pause and resume", () => {
    const { state } = fixture();
    const started = applyHostCommand(state, {
      action: "start",
      commandId: randomUUID(),
      expectedVersion: state.version,
      nowMs: 1_000,
      newRoundId: randomUUID,
    });
    const paused = applyHostCommand(started.state, {
      action: "pause",
      commandId: randomUUID(),
      expectedVersion: started.state.version,
      nowMs: 4_000,
      newRoundId: randomUUID,
    });
    expect(paused.state.pausedRemainingMs).toBe(7_000);
    expect(paused.state.deadlineMs).toBeNull();

    const resumed = applyHostCommand(paused.state, {
      action: "resume",
      commandId: randomUUID(),
      expectedVersion: paused.state.version,
      nowMs: 20_000,
      newRoundId: randomUUID,
    });
    expect(resumed.state.phase).toBe("question_open");
    expect(resumed.state.deadlineMs).toBe(27_000);
  });

  it("never exposes an answer key before reveal", () => {
    const { state } = fixture();
    const started = applyHostCommand(state, {
      action: "start",
      commandId: randomUUID(),
      expectedVersion: 0,
      nowMs: Date.now(),
      newRoundId: randomUUID,
    });
    const snapshot = snapshotForRole(started.state, { role: "participant" });

    expect(snapshot.correctChoiceId).toBeUndefined();
    expect(JSON.stringify(snapshot.question)).not.toContain("isCorrect");
    expect(JSON.stringify(snapshot.question)).not.toContain("Private facilitator guide");
    expect(JSON.stringify(snapshot.question)).not.toContain("sourceCitations");
  });

  it("locks and unlocks the lobby and removes a kicked participant", () => {
    const { state } = fixture();
    const participantId = randomUUID();
    const joined = addParticipant(state, {
      id: participantId,
      nickname: "Casey",
      score: 0,
      correctCount: 0,
      acceptedResponseMs: 0,
      connected: true,
      kicked: false,
    });
    const locked = applyHostCommand(joined.state, {
      action: "lock_lobby",
      commandId: randomUUID(),
      expectedVersion: joined.state.version,
      nowMs: 1_000,
      newRoundId: randomUUID,
    });
    expect(snapshotForRole(locked.state, { role: "host" }).lobbyLocked).toBe(true);

    const unlocked = applyHostCommand(locked.state, {
      action: "unlock_lobby",
      commandId: randomUUID(),
      expectedVersion: locked.state.version,
      nowMs: 1_001,
      newRoundId: randomUUID,
    });
    const kicked = applyHostCommand(unlocked.state, {
      action: "kick",
      participantId,
      commandId: randomUUID(),
      expectedVersion: unlocked.state.version,
      nowMs: 1_002,
      newRoundId: randomUUID,
    });

    expect(snapshotForRole(kicked.state, { role: "host" }).participants).toHaveLength(0);
    expect(kicked.state.participants[participantId]?.kicked).toBe(true);
  });

  it("orders ties by correctness, response time, then stable participant ID", () => {
    const { state } = fixture();
    const participants = [
      {
        id: "00000000-0000-4000-8000-000000000004",
        nickname: "Slower",
        score: 1_000,
        correctCount: 1,
        acceptedResponseMs: 1_000,
        connected: true,
        kicked: false,
      },
      {
        id: "00000000-0000-4000-8000-000000000001",
        nickname: "More correct",
        score: 1_000,
        correctCount: 2,
        acceptedResponseMs: 9_000,
        connected: true,
        kicked: false,
      },
      {
        id: "00000000-0000-4000-8000-000000000003",
        nickname: "Stable B",
        score: 1_000,
        correctCount: 1,
        acceptedResponseMs: 500,
        connected: true,
        kicked: false,
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        nickname: "Stable A",
        score: 1_000,
        correctCount: 1,
        acceptedResponseMs: 500,
        connected: true,
        kicked: false,
      },
    ];
    const populated = participants.reduce(
      (current, participant) => addParticipant(current, participant).state,
      state,
    );

    expect(leaderboard(populated).map(({ id }) => id)).toEqual([
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000004",
    ]);
  });

  it("redacts other participant identities and scores in private results", () => {
    const { state } = fixture();
    const viewerId = "00000000-0000-4000-8000-000000000001";
    const otherId = "00000000-0000-4000-8000-000000000002";
    const privateState = {
      ...state,
      settings: { ...state.settings, resultVisibility: "private" as const },
    };
    const withViewer = addParticipant(privateState, {
      id: viewerId,
      nickname: "Viewer",
      score: 800,
      correctCount: 1,
      acceptedResponseMs: 2_000,
      connected: true,
      kicked: false,
    });
    const withOther = addParticipant(withViewer.state, {
      id: otherId,
      nickname: "Secret name",
      score: 1_000,
      correctCount: 1,
      acceptedResponseMs: 1_000,
      connected: true,
      kicked: false,
    });

    const snapshot = snapshotForRole(withOther.state, {
      role: "participant",
      participantId: viewerId,
    });
    expect(snapshot.participants.find(({ id }) => id === viewerId)).toMatchObject({
      nickname: "Viewer",
      score: 800,
      rank: 2,
    });
    expect(snapshot.participants.find(({ id }) => id === otherId)).toMatchObject({
      nickname: "Participant",
      score: 0,
      rank: null,
    });
  });

  it("maintains monotonic version and sequence invariants across arbitrary command sequences", () => {
    const actions = [
      "start",
      "pause",
      "resume",
      "lock",
      "reveal",
      "show_leaderboard",
      "next",
      "end",
      "lock_lobby",
      "unlock_lobby",
    ] as const;
    const validPhases = new Set([
      "lobby",
      "question_open",
      "paused",
      "question_locked",
      "question_reveal",
      "leaderboard",
      "finished",
    ]);

    for (let seed = 1; seed <= 64; seed += 1) {
      let randomState = seed;
      const nextRandom = () => {
        randomState = (randomState * 1_664_525 + 1_013_904_223) >>> 0;
        return randomState;
      };
      let current = fixture().state;

      for (let step = 0; step < 80; step += 1) {
        const before = current;
        const action = actions[nextRandom() % actions.length]!;
        try {
          const result = applyHostCommand(current, {
            action,
            commandId: `seed-${seed}-step-${step}`,
            expectedVersion: current.version,
            nowMs: 1_000 + step * 100,
            newRoundId: randomUUID,
          });
          expect(result.state.version).toBe(before.version + 1);
          expect(result.state.seq).toBe(before.seq + result.events.length);
          expect(result.events.map(({ seq }) => seq)).toEqual(
            result.events.map((_, index) => before.seq + index + 1),
          );
          expect(validPhases.has(result.state.phase)).toBe(true);
          expect(before.version).toBeLessThan(result.state.version);
          current = result.state;
        } catch (error) {
          expect(error).toBeInstanceOf(EngineError);
          expect(current).toBe(before);
        }
      }
    }
  });

  it("requires confidence and scores multi-select only for an exact set", () => {
    const first = randomUUID();
    const second = randomUUID();
    const distractor = randomUUID();
    const learner = participant();
    const joined = addParticipant(
      stateForQuestions([
        {
          id: randomUUID(),
          type: "multi_select",
          prompt: "Select both prime numbers",
          purpose: "diagnostic",
          confidence: "required",
          delivery: "main",
          conceptKeys: ["prime-numbers"],
          linkedRecheckQuestionId: null,
          choices: [
            { id: first, label: "2", isCorrect: true },
            { id: second, label: "3", isCorrect: true },
            { id: distractor, label: "4", isCorrect: false },
          ],
          timeLimitSeconds: 20,
          basePoints: 1_000,
          explanation: "Two and three are prime.",
          mediaId: null,
          mediaAlt: null,
        },
      ]),
      learner,
    );
    const started = applyHostCommand(joined.state, {
      action: "start",
      commandId: randomUUID(),
      expectedVersion: joined.state.version,
      nowMs: 1_000,
      newRoundId: randomUUID,
    });

    expect(() =>
      acceptAnswer(started.state, {
        answerId: randomUUID(),
        participantId: learner.id,
        roundId: started.state.roundId!,
        response: { kind: "choice", choiceIds: [first, second] },
        idempotencyKey: randomUUID(),
        nowMs: 2_000,
      }),
    ).toThrowError(/confidence level/);

    const partial = acceptAnswer(started.state, {
      answerId: randomUUID(),
      participantId: learner.id,
      roundId: started.state.roundId!,
      response: { kind: "choice", choiceIds: [first] },
      confidence: 2,
      idempotencyKey: randomUUID(),
      nowMs: 2_000,
    });
    expect(partial.answer.correct).toBe(false);
    expect(partial.answer.score).toBe(0);

    const exact = acceptAnswer(started.state, {
      answerId: randomUUID(),
      participantId: learner.id,
      roundId: started.state.roundId!,
      response: { kind: "choice", choiceIds: [second, first] },
      confidence: 3,
      idempotencyKey: randomUUID(),
      nowMs: 2_000,
    });
    expect(exact.answer.response).toEqual({ kind: "choice", choiceIds: [first, second].sort() });
    expect(exact.answer.correct).toBe(true);
    expect(exact.answer.score).toBe(1_000);
  });

  it("compares normalized numeric responses with decimal tolerance and units", () => {
    const learner = participant();
    const joined = addParticipant(
      stateForQuestions([
        {
          id: randomUUID(),
          type: "numeric",
          prompt: "How many metres?",
          purpose: "practice",
          confidence: "optional",
          delivery: "main",
          conceptKeys: ["measurement"],
          linkedRecheckQuestionId: null,
          correctValue: "0.3",
          tolerance: "0.0000000000000000001",
          unit: "m",
          timeLimitSeconds: 20,
          basePoints: 1_000,
          explanation: "Three tenths of a metre.",
          mediaId: null,
          mediaAlt: null,
        },
      ]),
      learner,
    );
    const started = applyHostCommand(joined.state, {
      action: "start",
      commandId: randomUUID(),
      expectedVersion: joined.state.version,
      nowMs: 1_000,
      newRoundId: randomUUID,
    });
    const accepted = acceptAnswer(started.state, {
      answerId: randomUUID(),
      participantId: learner.id,
      roundId: started.state.roundId!,
      response: { kind: "numeric", value: "0.3000000000000000001", unit: "M" },
      confidence: 1,
      idempotencyKey: randomUUID(),
      nowMs: 2_000,
    });
    expect(accepted.answer.correct).toBe(true);
    expect(accepted.answer.score).toBe(1_000);

    expect(() =>
      acceptAnswer(started.state, {
        answerId: randomUUID(),
        participantId: learner.id,
        roundId: started.state.roundId!,
        response: { kind: "numeric", value: "0.3", unit: "cm" },
        idempotencyKey: randomUUID(),
        nowMs: 2_000,
      }),
    ).toThrowError(/expected unit/);
  });

  it("restores an intervention and opens an unscored linked recheck", () => {
    const mainCorrect = randomUUID();
    const mainWrong = randomUUID();
    const recheckId = randomUUID();
    const recheckCorrect = randomUUID();
    const learner = participant();
    const joined = addParticipant(
      stateForQuestions([
        {
          id: randomUUID(),
          type: "single_select",
          prompt: "Main checkpoint",
          purpose: "diagnostic",
          confidence: "required",
          delivery: "main",
          conceptKeys: ["safe-work"],
          linkedRecheckQuestionId: recheckId,
          choices: [
            { id: mainCorrect, label: "Safe", isCorrect: true },
            {
              id: mainWrong,
              label: "Unsafe",
              isCorrect: false,
              misconceptionKey: "unsafe-default",
            },
          ],
          timeLimitSeconds: 20,
          basePoints: 1_000,
          explanation: "Use the safe procedure.",
          mediaId: null,
          mediaAlt: null,
        },
        {
          id: recheckId,
          type: "true_false",
          prompt: "Apply the procedure in a new scenario",
          purpose: "practice",
          confidence: "off",
          delivery: "recheck",
          conceptKeys: ["safe-work"],
          linkedRecheckQuestionId: null,
          choices: [
            { id: recheckCorrect, label: "True", isCorrect: true },
            { id: randomUUID(), label: "False", isCorrect: false },
          ],
          timeLimitSeconds: 20,
          basePoints: 1_000,
          explanation: "The procedure still applies.",
          mediaId: null,
          mediaAlt: null,
        },
      ]),
      learner,
    );
    const started = applyHostCommand(joined.state, {
      action: "start",
      commandId: randomUUID(),
      expectedVersion: joined.state.version,
      nowMs: 1_000,
      newRoundId: randomUUID,
    });
    const answered = acceptAnswer(started.state, {
      answerId: randomUUID(),
      participantId: learner.id,
      roundId: started.state.roundId!,
      response: { kind: "choice", choiceIds: [mainWrong] },
      confidence: 3,
      idempotencyKey: randomUUID(),
      nowMs: 2_000,
    });
    const locked = applyHostCommand(answered.state, {
      action: "lock",
      commandId: randomUUID(),
      expectedVersion: answered.state.version,
      nowMs: 3_000,
      newRoundId: randomUUID,
    });
    const intervention = applyHostCommand(locked.state, {
      action: "intervention.start",
      interventionType: "peer_discussion",
      commandId: randomUUID(),
      expectedVersion: locked.state.version,
      nowMs: 4_000,
      newRoundId: randomUUID,
      newInterventionId: randomUUID,
    });
    const preRevealSnapshot = snapshotForRole(intervention.state, {
      role: "participant",
      participantId: learner.id,
    });
    expect(preRevealSnapshot).toMatchObject({
      phase: "intervention",
      intervention: { type: "peer_discussion", finishedAt: null },
    });
    expect(preRevealSnapshot.correctResponse).toBeUndefined();
    expect(preRevealSnapshot.myCorrect).toBeUndefined();

    const revealed = applyHostCommand(locked.state, {
      action: "reveal",
      commandId: randomUUID(),
      expectedVersion: locked.state.version,
      nowMs: 4_000,
      newRoundId: randomUUID,
    });
    const explaining = applyHostCommand(revealed.state, {
      action: "intervention.start",
      interventionType: "explain",
      commandId: randomUUID(),
      expectedVersion: revealed.state.version,
      nowMs: 4_500,
      newRoundId: randomUUID,
      newInterventionId: randomUUID,
    });
    expect(
      snapshotForRole(explaining.state, { role: "participant", participantId: learner.id }),
    ).toMatchObject({
      phase: "intervention",
      questionPosition: 0,
      myCorrect: false,
      correctResponse: { kind: "choice", choiceIds: [mainCorrect] },
      explanation: "Use the safe procedure.",
    });

    const discussed = applyHostCommand(intervention.state, {
      action: "intervention.finish",
      commandId: randomUUID(),
      expectedVersion: intervention.state.version,
      nowMs: 5_000,
      newRoundId: randomUUID,
    });
    const recheck = applyHostCommand(discussed.state, {
      action: "recheck.open",
      recheckMode: "linked",
      commandId: randomUUID(),
      expectedVersion: discussed.state.version,
      nowMs: 6_000,
      newRoundId: randomUUID,
    });
    expect(snapshotForRole(recheck.state, { role: "participant" })).toMatchObject({
      phase: "question_open",
      roundKind: "linked_recheck",
      sourceRoundId: started.state.roundId,
      questionPosition: 0,
      questionCount: 1,
      question: { id: recheckId },
      intervention: { type: "peer_discussion" },
    });

    const recovered = acceptAnswer(recheck.state, {
      answerId: randomUUID(),
      participantId: learner.id,
      roundId: recheck.state.roundId!,
      response: { kind: "choice", choiceIds: [recheckCorrect] },
      idempotencyKey: randomUUID(),
      nowMs: 7_000,
    });
    expect(recovered.answer.correct).toBe(true);
    expect(recovered.answer.score).toBe(0);
    expect(recovered.state.participants[learner.id]?.score).toBe(0);
  });

  it("upgrades a persisted P0 state without losing accepted answers", () => {
    const { state, correctId } = fixture();
    const answerId = randomUUID();
    const legacy = structuredClone(state) as unknown as Record<string, unknown>;
    delete legacy.stateSchemaVersion;
    delete legacy.roundKind;
    delete legacy.sourceRoundId;
    delete legacy.intervention;
    delete legacy.interventionReturnPhase;
    legacy.answers = {
      [answerId]: {
        answerId,
        participantId: randomUUID(),
        roundId: randomUUID(),
        choiceId: correctId,
        acceptedAtMs: 1_000,
        responseMs: 500,
        score: 1_000,
        correct: true,
        idempotencyKey: randomUUID(),
      },
    };

    const upgraded = upgradeGameState(legacy as unknown as typeof state);
    expect(upgraded.stateSchemaVersion).toBe(4);
    expect(upgraded.experienceTheme).toMatchObject({
      preset: { id: "focus", version: 1 },
      category: "general",
    });
    expect(upgraded.answers[answerId]).toMatchObject({
      choiceId: correctId,
      response: { kind: "choice", choiceIds: [correctId] },
      confidence: null,
    });
  });
});

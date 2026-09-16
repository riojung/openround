import { randomUUID } from "node:crypto";
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
});

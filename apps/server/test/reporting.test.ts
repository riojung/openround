import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Report } from "@openround/contracts";
import { addParticipant, createGameState, type EngineAnswer } from "@openround/game-engine";
import { generateReport, reportCsv } from "../src/reporting.js";

describe("report CSV", () => {
  it("neutralizes spreadsheet formulas in participant-controlled nicknames", () => {
    const dangerousNicknames = ["=1+1", "+SUM(A1:A2)", "-2+3", "@IMPORTDATA(A1)", "\t=1+1"];
    const report: Report = {
      id: randomUUID(),
      sessionId: randomUUID(),
      status: "ready",
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      metrics: {
        participantCount: dangerousNicknames.length + 1,
        completedCount: 0,
        answerCount: 0,
        accuracyPercent: 0,
      },
      questions: [],
      participants: [...dangerousNicknames, "Safe nickname"].map((nickname) => ({
        participantId: randomUUID(),
        nickname,
        score: 0,
        correctCount: 0,
        answerCount: 0,
      })),
    };

    const csv = reportCsv(report);

    for (const nickname of dangerousNicknames) expect(csv).toContain(`'${nickname}`);
    expect(csv).toContain(",Safe nickname,0,0,0");
    expect(csv).not.toMatch(/,[=+@-]/);
  });

  it("separates initial accuracy from linked-recheck recovery evidence", () => {
    const sourceQuestionId = randomUUID();
    const recheckQuestionId = randomUUID();
    const sourceRoundId = randomUUID();
    const recheckRoundId = randomUUID();
    const interventionId = randomUUID();
    const correctChoiceId = randomUUID();
    const misconceptionChoiceId = randomUUID();
    const recheckCorrectId = randomUUID();
    const firstParticipantId = randomUUID();
    const secondParticipantId = randomUUID();
    const kickedParticipantId = randomUUID();
    let state = createGameState({
      sessionId: randomUUID(),
      code: "1234567",
      quiz: {
        title: "Recovery evidence",
        description: "",
        questions: [
          {
            id: sourceQuestionId,
            type: "single_select",
            prompt: "Choose the safe procedure",
            purpose: "diagnostic",
            confidence: "required",
            delivery: "main",
            conceptKeys: ["safe-work"],
            linkedRecheckQuestionId: recheckQuestionId,
            choices: [
              { id: correctChoiceId, label: "Safe", isCorrect: true },
              {
                id: misconceptionChoiceId,
                label: "Shortcut",
                isCorrect: false,
                misconceptionKey: "shortcut-is-safe",
              },
            ],
            timeLimitSeconds: 20,
            basePoints: 1_000,
            explanation: "Use the complete safe procedure.",
            mediaId: null,
            mediaAlt: null,
          },
          {
            id: recheckQuestionId,
            type: "true_false",
            prompt: "The procedure still applies in this scenario.",
            purpose: "practice",
            confidence: "off",
            delivery: "recheck",
            conceptKeys: ["safe-work"],
            linkedRecheckQuestionId: null,
            choices: [
              { id: recheckCorrectId, label: "True", isCorrect: true },
              { id: randomUUID(), label: "False", isCorrect: false },
            ],
            timeLimitSeconds: 20,
            basePoints: 1_000,
            explanation: "It applies.",
            mediaId: null,
            mediaAlt: null,
          },
        ],
      },
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    });
    for (const [id, nickname] of [
      [firstParticipantId, "First"],
      [secondParticipantId, "Second"],
    ] as const) {
      state = addParticipant(state, {
        id,
        nickname,
        score: id === secondParticipantId ? 1_000 : 0,
        correctCount: id === secondParticipantId ? 1 : 0,
        acceptedResponseMs: 1_000,
        connected: false,
        kicked: false,
      }).state;
    }
    state = addParticipant(state, {
      id: kickedParticipantId,
      nickname: "Removed participant",
      score: 0,
      correctCount: 0,
      acceptedResponseMs: 1_000,
      connected: false,
      kicked: true,
    }).state;
    const answer = (
      participantId: string,
      roundId: string,
      choiceId: string,
      correct: boolean,
      confidence: 1 | 2 | 3 | null,
      acceptedAtMs: number,
    ): EngineAnswer => ({
      answerId: randomUUID(),
      participantId,
      roundId,
      response: { kind: "choice", choiceIds: [choiceId] },
      confidence,
      choiceId,
      acceptedAtMs,
      responseMs: 1_000,
      score: roundId === sourceRoundId && correct ? 1_000 : 0,
      correct,
      idempotencyKey: randomUUID(),
    });
    const generated = generateReport(state, new Date("2026-10-01T00:00:00.000Z"), {
      generatedAt: new Date("2026-09-01T00:00:00.000Z"),
      evidence: {
        answers: [
          answer(firstParticipantId, sourceRoundId, misconceptionChoiceId, false, 3, 2_000),
          answer(secondParticipantId, sourceRoundId, correctChoiceId, true, 1, 2_100),
          answer(kickedParticipantId, sourceRoundId, misconceptionChoiceId, false, 3, 2_200),
          answer(firstParticipantId, recheckRoundId, recheckCorrectId, true, null, 5_000),
        ],
        rounds: [
          {
            id: sourceRoundId,
            questionId: sourceQuestionId,
            position: 0,
            kind: "main",
            sourceRoundId: null,
            interventionId: null,
            openedAtMs: 1_000,
            deadlineMs: 21_000,
            lockedAtMs: 3_000,
          },
          {
            id: recheckRoundId,
            questionId: recheckQuestionId,
            position: 1,
            kind: "linked_recheck",
            sourceRoundId,
            interventionId,
            openedAtMs: 4_000,
            deadlineMs: 24_000,
            lockedAtMs: 6_000,
          },
        ],
        interventions: [
          {
            id: interventionId,
            type: "explain",
            sourceRoundId,
            startedAtMs: 3_000,
            finishedAtMs: 4_000,
          },
        ],
        qna: { questions: 2, answered: 1, unresolved: 1 },
        interactions: {
          signalEvents: [
            {
              contextKey: `round:${sourceRoundId}`,
              participantId: firstParticipantId,
              signal: "unsure",
              createdAt: new Date(1_500),
            },
            {
              contextKey: `round:${sourceRoundId}`,
              participantId: firstParticipantId,
              signal: "got_it",
              createdAt: new Date(2_500),
            },
            {
              contextKey: `round:${sourceRoundId}`,
              participantId: secondParticipantId,
              signal: "need_example",
              createdAt: new Date(2_600),
            },
            {
              contextKey: `round:${sourceRoundId}`,
              participantId: secondParticipantId,
              signal: null,
              createdAt: new Date(2_700),
            },
          ],
          chatMessages: [],
          reactions: [],
          reports: 0,
          moderationActions: 0,
        },
      },
    });

    expect(generated).toMatchObject({
      schemaVersion: 3,
      status: "ready",
      metrics: { participantCount: 2, completedCount: 2, answerCount: 3 },
      initialAccuracy: { correct: 1, responses: 2, percent: 50 },
      recovery: [
        {
          evidenceType: "linked_recheck",
          recovered: 1,
          initiallyIncorrectWithBoth: 1,
          recoveryPercent: 100,
          smallSample: true,
        },
      ],
      misconceptions: [
        {
          key: "shortcut-is-safe",
          responses: 1,
          allResponsePercent: 50,
          wrongResponsePercent: 100,
        },
      ],
      unresolvedConcepts: [
        { conceptKey: "safe-work", initiallyIncorrect: 1, recovered: 1, unresolved: 0 },
      ],
      qna: { questions: 2, answered: 1, unresolved: 1 },
      audiencePulse: {
        uniqueParticipants: 2,
        events: 4,
        bySignal: { got_it: 1, unsure: 0, need_example: 0, too_fast: 0 },
        contexts: [
          {
            contextKey: `round:${sourceRoundId}`,
            uniqueParticipants: 2,
            bySignal: { got_it: 1, unsure: 0, need_example: 0, too_fast: 0 },
          },
        ],
      },
    });
    expect(generated.evidenceNote).toContain("not be interpreted as proof");
  });
});

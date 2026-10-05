import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { QuizDraft } from "@openround/contracts";
import { applyHostCommand, createGameState } from "@openround/game-engine";
import { decisionEventsForTransition } from "../src/session-decision-replay.js";

describe("session decision replay", () => {
  it("records aggregate decision milestones in engine sequence without response content", () => {
    const sourceQuestionId = randomUUID();
    const recheckQuestionId = randomUUID();
    const nextQuestionId = randomUUID();
    const correctChoiceId = randomUUID();
    const wrongChoiceId = randomUUID();
    const question = (id: string, prompt: string, delivery: "main" | "recheck" = "main") => ({
      id,
      type: "single_select" as const,
      prompt,
      delivery,
      choices: [
        { id: correctChoiceId, label: "Correct", isCorrect: true },
        { id: wrongChoiceId, label: "Incorrect", isCorrect: false },
      ],
      timeLimitSeconds: 30,
      basePoints: 1_000,
      explanation: "Private explanation text",
      mediaId: null,
      mediaAlt: null,
    });
    const quiz: QuizDraft = {
      title: "Decision replay journey",
      description: "",
      questions: [
        {
          ...question(sourceQuestionId, "Private prompt"),
          linkedRecheckQuestionId: recheckQuestionId,
        },
        question(recheckQuestionId, "Recheck prompt", "recheck"),
        question(nextQuestionId, "Next prompt"),
      ],
    };
    let state = createGameState({
      sessionId: randomUUID(),
      code: "3344556",
      quiz,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    });
    const captured: ReturnType<typeof decisionEventsForTransition> = [];
    let clock = Date.parse("2026-10-01T12:00:00.000Z");

    const command = (
      action: Parameters<typeof applyHostCommand>[1]["action"],
      extras: Partial<Parameters<typeof applyHostCommand>[1]> = {},
    ) => {
      const before = state;
      const commandId = randomUUID();
      const result = applyHostCommand(state, {
        commandId,
        expectedVersion: state.version,
        action,
        nowMs: ++clock,
        newRoundId: randomUUID,
        ...extras,
      });
      state = result.state;
      captured.push(
        ...decisionEventsForTransition({
          before,
          after: state,
          engineEvents: result.events,
          action,
          commandId,
          occurredAt: new Date(clock),
        }),
      );
      return result;
    };

    command("start");
    command("lock");
    command("reveal");
    command("intervention.start", { interventionType: "explain" });
    command("intervention.finish");
    command("recheck.open", { recheckMode: "linked" });
    command("lock");
    command("reveal");
    command("next");
    command("lock");
    command("reveal");
    command("next");

    const events = captured.map((write) => write.event);
    expect(events.map((event) => event.type)).toEqual([
      "insight_shown",
      "answer_revealed",
      "intervention_started",
      "intervention_finished",
      "recheck_opened",
      "insight_shown",
      "answer_revealed",
      "question_advanced",
      "insight_shown",
      "answer_revealed",
      "session_finished",
    ]);
    expect(events[0]).toMatchObject({
      type: "insight_shown",
      sampleSize: 0,
      activeParticipantCount: 0,
      recommendationCode: "insufficient_sample",
      ruleSetVersion: "checkpoint-insight-v1",
    });
    expect(events.find((event) => event.type === "recheck_opened")).toMatchObject({
      type: "recheck_opened",
      sourceRoundId: expect.any(String),
      questionId: recheckQuestionId,
      kind: "linked_recheck",
    });
    expect(events.find((event) => event.type === "question_advanced")).toMatchObject({
      type: "question_advanced",
      questionId: nextQuestionId,
    });
    expect(events.at(-1)).toMatchObject({ type: "session_finished", reason: "completed" });
    expect(events.map((event) => event.seq)).toEqual(
      [...events].map((event) => event.seq).sort((left, right) => left - right),
    );
    expect(JSON.stringify(events)).not.toContain("Private prompt");
    expect(JSON.stringify(events)).not.toContain("Private explanation text");
    expect(JSON.stringify(events)).not.toContain("choiceIds");
    expect(captured.every((write) => write.eventOrdinal === 0)).toBe(true);
  });
});

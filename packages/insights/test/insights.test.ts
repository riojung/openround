import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { QuestionDraft } from "@openround/contracts";
import { deriveCheckpointInsight, type InsightResponse } from "../src/index.js";

const correctId = randomUUID();
const misconceptionId = randomUUID();
const otherId = randomUUID();
const question: QuestionDraft = {
  id: randomUUID(),
  type: "single_select",
  prompt: "Which model applies?",
  purpose: "diagnostic",
  confidence: "required",
  choices: [
    { id: correctId, label: "Correct", isCorrect: true },
    {
      id: misconceptionId,
      label: "Tempting",
      isCorrect: false,
      misconceptionKey: "confuses-rate-and-total",
    },
    { id: otherId, label: "Other", isCorrect: false },
  ],
  timeLimitSeconds: 30,
  basePoints: 1_000,
  explanation: "",
  mediaId: null,
  mediaAlt: null,
};

function answer(choiceId: string, correct: boolean, confidence: 1 | 2 | 3): InsightResponse {
  return { response: { kind: "choice", choiceIds: [choiceId] }, correct, confidence };
}

describe("deterministic checkpoint insights", () => {
  it("suppresses strong recommendations below five responses", () => {
    const insight = deriveCheckpointInsight({
      question,
      responses: [answer(correctId, true, 3), answer(misconceptionId, false, 3)],
      activeParticipantCount: 2,
    });
    expect(insight.recommendation).toMatchObject({
      code: "insufficient_sample",
      strong: false,
    });
  });

  it("prioritizes low participation over answer interpretation", () => {
    const insight = deriveCheckpointInsight({
      question,
      responses: Array.from({ length: 6 }, () => answer(correctId, true, 3)),
      activeParticipantCount: 10,
    });
    expect(insight.recommendation.code).toBe("low_participation");
  });

  it("identifies a material high-confidence misconception", () => {
    const responses = [
      ...Array.from({ length: 6 }, () => answer(correctId, true, 3)),
      ...Array.from({ length: 4 }, () => answer(misconceptionId, false, 3)),
    ];
    const insight = deriveCheckpointInsight({
      question,
      responses,
      activeParticipantCount: 10,
    });
    expect(insight.highConfidenceWrongPercent).toBe(40);
    expect(insight.dominantMisconception).toMatchObject({
      key: "confuses-rate-and-total",
      responses: 4,
    });
    expect(insight.recommendation.code).toBe("high_confidence_error");
  });

  it("uses stable output for tied wrong-choice counts", () => {
    const responses = [
      ...Array.from({ length: 4 }, () => answer(correctId, true, 2)),
      ...Array.from({ length: 3 }, () => answer(misconceptionId, false, 2)),
      ...Array.from({ length: 3 }, () => answer(otherId, false, 2)),
    ];
    expect(
      deriveCheckpointInsight({ question, responses, activeParticipantCount: 10 }).recommendation
        .code,
    ).toBe("dominant_misconception");
  });
});

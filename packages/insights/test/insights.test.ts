import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { QuestionDraft, QuizDraft } from "@openround/contracts";
import {
  deriveCheckpointInsight,
  evaluateQuestionHealth,
  QUESTION_HEALTH_MAX_FINDINGS,
  QUESTION_HEALTH_RULESET_VERSION,
  type InsightResponse,
} from "../src/index.js";

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

describe("production Question Health evaluator", () => {
  it("returns deterministic advisory findings and invalidates fingerprints on content edits", async () => {
    const quizId = randomUUID();
    const draft: QuizDraft = {
      title: "Question Health test",
      description: "",
      questions: [
        {
          ...question,
          linkedRecheckQuestionId: null,
          choices: [
            { id: correctId, label: "Correct", isCorrect: true },
            { id: misconceptionId, label: "correct!", isCorrect: false },
          ],
        },
      ],
    };
    const first = await evaluateQuestionHealth(draft, { quizId, draftRevision: 3 });
    const repeated = await evaluateQuestionHealth(structuredClone(draft), {
      quizId,
      draftRevision: 3,
    });
    const edited = await evaluateQuestionHealth(
      { ...draft, questions: [{ ...draft.questions[0]!, prompt: "An edited prompt" }] },
      { quizId, draftRevision: 4 },
    );

    expect(first).toEqual(repeated);
    expect(first).toMatchObject({
      quizId,
      draftRevision: 3,
      rulesetVersion: QUESTION_HEALTH_RULESET_VERSION,
      evaluatedQuestionCount: 1,
      findingsTruncated: false,
    });
    expect(first.findings.every((finding) => finding.severity === "advisory")).toBe(true);
    expect(first.findings.find((finding) => finding.ruleId === "choice.duplicate")).toMatchObject({
      questionId: question.id,
      fieldPath: "questions.0.choices.1.label",
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const originalFinding = first.findings.find(
      (finding) => finding.ruleId === "question.missing_citation",
    );
    const editedFinding = edited.findings.find(
      (finding) => finding.ruleId === "question.missing_citation",
    );
    expect(editedFinding?.id).toBe(originalFinding?.id);
    expect(editedFinding?.contentHash).not.toBe(originalFinding?.contentHash);
    expect(edited.draftRevision).toBe(4);
  });

  it("caps output and marks when a large draft has more findings than the response bound", async () => {
    const crowdedQuestion: QuestionDraft = {
      ...question,
      explanation: "",
      choices: Array.from({ length: 6 }, (_, index) => ({
        id: randomUUID(),
        label: `Option ${index}`,
        isCorrect: index === 0,
      })),
    };
    const draft: QuizDraft = {
      title: "Many findings",
      description: "",
      questions: Array.from({ length: 200 }, (_, index) => ({
        ...crowdedQuestion,
        id: randomUUID(),
        prompt: `Question ${index}`,
        choices: crowdedQuestion.choices.map((choice) => ({ ...choice, id: randomUUID() })),
      })),
    };
    const result = await evaluateQuestionHealth(draft, {
      quizId: randomUUID(),
      draftRevision: 0,
    });
    expect(result.findings).toHaveLength(QUESTION_HEALTH_MAX_FINDINGS);
    expect(result.findingsTruncated).toBe(true);
  });
});

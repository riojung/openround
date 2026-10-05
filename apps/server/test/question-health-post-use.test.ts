import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { QuizDraftSchema } from "@openround/contracts";
import type { QuestionHealthObservationReport } from "@openround/db";
import { buildQuestionHealthPostUseResult } from "../src/question-health-post-use.js";

const questionId = randomUUID();
const correctChoiceId = randomUUID();
const distractorId = randomUUID();
const content = QuizDraftSchema.parse({
  title: "Post-use sample",
  description: "",
  questions: [
    {
      id: questionId,
      type: "single_select",
      prompt: "Which choice is correct?",
      purpose: "diagnostic",
      confidence: "off",
      delivery: "main",
      conceptKeys: [],
      linkedRecheckQuestionId: null,
      choices: [
        { id: correctChoiceId, label: "Correct", isCorrect: true },
        { id: distractorId, label: "Distractor", isCorrect: false },
      ],
      timeLimitSeconds: 30,
      basePoints: 1_000,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
    },
  ],
});

function report(
  correct: number,
  options: Partial<
    Pick<QuestionHealthObservationReport, "trustMode" | "timeMode" | "scoringMode">
  > = {},
): QuestionHealthObservationReport {
  return {
    trustMode: "learning",
    timeMode: "timed",
    scoringMode: "accuracy",
    ...options,
    questions: [
      {
        questionId,
        responses: 20,
        correct,
        responseDistribution: {
          kind: "choice",
          buckets: [
            { value: correctChoiceId, count: correct },
            { value: distractorId, count: 0 },
          ],
        },
      },
    ],
  };
}

function build(reports: QuestionHealthObservationReport[], hasMoreReports = false) {
  return buildQuestionHealthPostUseResult({
    quizId: randomUUID(),
    content,
    reports,
    hasMoreReports,
    version: {
      id: randomUUID(),
      number: 1,
      contentHash: "a".repeat(64),
      publishedAt: "2026-10-02T12:00:00.000Z",
      sourceDraftRevision: 1,
    },
  });
}

describe("Question Health post-use observations", () => {
  it("withholds questions until one retained session has at least 20 responses", () => {
    const belowThreshold = report(12);
    belowThreshold.questions[0]!.responses = 19;
    const result = build([belowThreshold]);
    expect(result.cohorts).toEqual([]);
  });

  it("flags an unused distractor from a single eligible aggregate without learner data", () => {
    const result = build([report(14)]);
    expect(result.cohorts[0]?.questions[0]).toMatchObject({
      sample: { sessions: 1, responses: 20 },
      correct: 14,
      accuracyPercent: 70,
      signals: [{ ruleId: "choice.unused_after_use", choiceId: distractorId }],
    });
    expect(JSON.stringify(result)).not.toContain("participantId");
    expect(JSON.stringify(result)).not.toContain("sessionId");
  });

  it("only flags accuracy instability across three compatible sessions", () => {
    const result = build([report(4), report(10), report(16)]);
    expect(result.cohorts[0]?.questions[0]).toMatchObject({
      sample: { sessions: 3, responses: 60 },
      sessionAccuracyRange: { minPercent: 20, maxPercent: 80 },
    });
    expect(result.cohorts[0]?.questions[0]?.signals.map((signal) => signal.ruleId)).toContain(
      "question.session_instability",
    );
  });

  it("does not combine different trust or time cohorts to satisfy the instability threshold", () => {
    const result = build([
      report(2),
      report(10),
      report(18, { trustMode: "verified" }),
      report(18, { timeMode: "flex" }),
      report(18, { scoringMode: "speed" }),
    ]);
    expect(result.cohorts).toHaveLength(4);
    expect(
      result.cohorts.flatMap((cohort) => cohort.questions.flatMap((question) => question.signals)),
    ).not.toContainEqual(expect.objectContaining({ ruleId: "question.session_instability" }));
  });

  it("declares when the retained-report window omits older reports", () => {
    const result = build(
      Array.from({ length: 250 }, () => report(14)),
      true,
    );
    expect(result.history).toEqual({
      maxReports: 250,
      reportsIncluded: 250,
      hasMoreReports: true,
    });
    expect(result.evidenceNote).toContain("250 most recent retained reports");
    expect(result.evidenceNote).toContain("older reports are omitted");
  });
});

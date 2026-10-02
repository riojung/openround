import {
  QUESTION_HEALTH_POST_USE_MAX_REPORTS,
  QuestionHealthPostUseResultSchema,
  questionDelivery,
  questionPurpose,
  type QuizDraft,
  type QuestionHealthPostUseResult,
} from "@openround/contracts";
import type { QuestionHealthObservationReport } from "@openround/db";

const MINIMUM_RESPONSES_PER_SESSION = 20;
const INSTABILITY_MINIMUM_SESSIONS = 3;
const INSTABILITY_THRESHOLD_PERCENTAGE_POINTS = 30;

function percent(correct: number, responses: number) {
  return responses === 0 ? 0 : Math.round((correct / responses) * 1_000) / 10;
}

function scorable(question: QuizDraft["questions"][number]) {
  return (
    question.type !== "poll" &&
    question.type !== "rating" &&
    questionPurpose(question) !== "opinion"
  );
}

export function buildQuestionHealthPostUseResult(input: {
  quizId: string;
  content: QuizDraft;
  version: QuestionHealthPostUseResult["version"];
  reports: QuestionHealthObservationReport[];
  hasMoreReports: boolean;
}): QuestionHealthPostUseResult {
  const mainQuestions = input.content.questions.flatMap((question, questionIndex) =>
    questionDelivery(question) === "main" && scorable(question)
      ? [{ question, questionIndex }]
      : [],
  );
  const cohorts = new Map<
    string,
    {
      trustMode: QuestionHealthObservationReport["trustMode"];
      timeMode: QuestionHealthObservationReport["timeMode"];
      scoringMode: QuestionHealthObservationReport["scoringMode"];
      reports: Array<{
        questionsById: Map<string, QuestionHealthObservationReport["questions"][number]>;
      }>;
    }
  >();

  for (const report of input.reports) {
    const key = `${report.trustMode}:${report.timeMode}:${report.scoringMode}`;
    const cohort = cohorts.get(key) ?? {
      trustMode: report.trustMode,
      timeMode: report.timeMode,
      scoringMode: report.scoringMode,
      reports: [],
    };
    cohort.reports.push({
      questionsById: new Map(report.questions.map((question) => [question.questionId, question])),
    });
    cohorts.set(key, cohort);
  }

  const result = QuestionHealthPostUseResultSchema.parse({
    quizId: input.quizId,
    source: "published",
    rulesetVersion: "post-use-1.0.0",
    version: input.version,
    eligibility: {
      minimumResponsesPerSession: MINIMUM_RESPONSES_PER_SESSION,
      instabilityMinimumSessions: INSTABILITY_MINIMUM_SESSIONS,
      instabilityThresholdPercentagePoints: INSTABILITY_THRESHOLD_PERCENTAGE_POINTS,
    },
    history: {
      maxReports: QUESTION_HEALTH_POST_USE_MAX_REPORTS,
      reportsIncluded: input.reports.length,
      hasMoreReports: input.hasMoreReports,
    },
    cohorts: [...cohorts.values()].flatMap((cohort) => {
      const questions = mainQuestions.flatMap(({ question, questionIndex }) => {
        const samples = cohort.reports.flatMap(({ questionsById }) => {
          const observed = questionsById.get(question.id);
          return observed && observed.responses >= MINIMUM_RESPONSES_PER_SESSION
            ? [{ observed }]
            : [];
        });
        if (samples.length === 0) return [];

        const responses = samples.reduce((sum, sample) => sum + sample.observed.responses, 0);
        const correct = samples.reduce((sum, sample) => sum + sample.observed.correct, 0);
        const accuracies = samples.map((sample) =>
          percent(sample.observed.correct, sample.observed.responses),
        );
        const accuracyRange = {
          minPercent: Math.min(...accuracies),
          maxPercent: Math.max(...accuracies),
        };
        const signals: QuestionHealthPostUseResult["cohorts"][number]["questions"][number]["signals"] =
          [];

        if (
          samples.length >= INSTABILITY_MINIMUM_SESSIONS &&
          accuracyRange.maxPercent - accuracyRange.minPercent >=
            INSTABILITY_THRESHOLD_PERCENTAGE_POINTS
        ) {
          signals.push({
            id: `question.session_instability:${input.version.id}:${question.id}`,
            ruleId: "question.session_instability",
            ruleVersion: 1,
            severity: "advisory",
            questionId: question.id,
            evidence: `Accuracy ranged from ${accuracyRange.minPercent}% to ${accuracyRange.maxPercent}% across ${samples.length} compatible sessions, each with at least ${MINIMUM_RESPONSES_PER_SESSION} responses.`,
            recommendedAction:
              "Review the question wording and the context in which it was used; this difference is descriptive and does not identify a cause.",
          });
        }

        if ("choices" in question && question.choices.length > 0) {
          const distributions = samples.map((sample) => sample.observed.responseDistribution);
          const completeCoverage = distributions.every(
            (distribution) =>
              distribution?.kind === "choice" &&
              question.choices.every((choice) =>
                distribution.buckets.some((bucket) => bucket.value === choice.id),
              ),
          );
          if (completeCoverage) {
            for (const choice of question.choices.filter((candidate) => !candidate.isCorrect)) {
              const selected = distributions.reduce(
                (sum, distribution) =>
                  sum +
                  (distribution?.kind === "choice"
                    ? (distribution.buckets.find((bucket) => bucket.value === choice.id)?.count ??
                      0)
                    : 0),
                0,
              );
              if (selected !== 0) continue;
              signals.push({
                id: `choice.unused_after_use:${input.version.id}:${question.id}:${choice.id}`,
                ruleId: "choice.unused_after_use",
                ruleVersion: 1,
                severity: "advisory",
                questionId: question.id,
                choiceId: choice.id,
                evidence: `This distractor was not selected in ${samples.length} compatible sessions with ${responses} responses in total.`,
                recommendedAction:
                  "Review whether this distractor is plausible for the learners and misconception it is intended to represent.",
              });
            }
          }
        }

        return [
          {
            questionId: question.id,
            questionPosition: questionIndex + 1,
            sample: {
              sessions: samples.length,
              responses,
              minimumResponsesPerSession: MINIMUM_RESPONSES_PER_SESSION,
            },
            correct,
            accuracyPercent: percent(correct, responses),
            sessionAccuracyRange: accuracyRange,
            signals,
          },
        ];
      });
      if (questions.length === 0) return [];
      return [
        {
          trustMode: cohort.trustMode,
          timeMode: cohort.timeMode,
          scoringMode: cohort.scoringMode,
          questions,
        },
      ];
    }),
    evidenceNote: input.hasMoreReports
      ? `These descriptive aggregates use the ${input.reports.length} most recent retained reports for this exact published version; older reports are omitted. Matching trust, timing, and scoring settings remain separate. They are not learner profiles, causal evidence, or proof of durable learning.`
      : "These descriptive aggregates include all retained reports for this exact published version and matching trust, timing, and scoring settings. They are not learner profiles, causal evidence, or proof of durable learning.",
  });
  return result;
}

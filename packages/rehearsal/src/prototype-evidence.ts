import {
  QUESTION_HEALTH_RULE_IDS,
  QUESTION_HEALTH_RULESET_VERSION,
  type QuestionHealthFindingEvaluation,
  type QuestionHealthOutcome,
  type QuestionHealthRuleId,
} from "./question-health-prototype";
import type {
  DelayedProbeEvaluation,
  DelayedProbeRejectionReason,
} from "./delayed-probe-prototype";
import { DELAYED_PROBE_REJECTION_REASONS } from "./delayed-probe-prototype";

export const PROTOTYPE_EVIDENCE_SCHEMA_VERSION = "openround.phase0-prototype-evidence.v1" as const;
export const PROTOTYPE_EVIDENCE_PROTOCOL_VERSION = "p0-2026" as const;

export type PrototypeDurationBucket = "under_1m" | "1_to_2m" | "2_to_5m" | "5_to_15m" | "over_15m";

export type PrototypeEvidenceSegment = "education" | "workplace" | "unclassified";

export interface PrototypeEvidenceInput {
  segment: PrototypeEvidenceSegment;
  companion?: {
    durationMs: number;
    completion: "completed" | "abandoned";
    returnToDeckOutcome: "successful" | "unsuccessful" | "not_tested";
    primaryActionCount: number;
    overlayOpenCount: number;
  };
  questionHealth?: {
    durationMs: number;
    evaluatedQuestionCount: number;
    evaluations: readonly QuestionHealthFindingEvaluation[];
  };
  delayedProbe?: {
    durationMs: number;
    evaluation: DelayedProbeEvaluation;
    decision: "would_issue" | "would_not_issue" | "undecided";
    evidenceKind: "personal_paired" | "generic_cohort" | "not_selected";
  };
}

export interface PrototypeEvidenceExportV1 {
  schemaVersion: typeof PROTOTYPE_EVIDENCE_SCHEMA_VERSION;
  protocolVersion: typeof PROTOTYPE_EVIDENCE_PROTOCOL_VERSION;
  segment: PrototypeEvidenceSegment;
  prototypeCount: number;
  companion: null | {
    durationBucket: PrototypeDurationBucket;
    completion: "completed" | "abandoned";
    returnToDeckOutcome: "successful" | "unsuccessful" | "not_tested";
    counts: {
      primaryActions: number;
      overlaysOpened: number;
    };
  };
  questionHealth: null | {
    rulesetVersion: typeof QUESTION_HEALTH_RULESET_VERSION;
    durationBucket: PrototypeDurationBucket;
    counts: {
      questionsEvaluated: number;
      findingsRecorded: number;
      fullyReviewed: number;
      usefulnessReviewed: number;
      usefulnessPending: number;
      useful: number;
      notUseful: number;
      outcomesReviewed: number;
      outcomePending: number;
      retainedRevision: number;
      deliberateDismissal: number;
      noDecision: number;
    };
    rules: Array<{
      ruleId: QuestionHealthRuleId;
      ruleVersion: 1;
      findingCount: number;
      usefulnessReviewedCount: number;
      usefulCount: number;
      notUsefulCount: number;
      outcomesReviewedCount: number;
      outcomes: Record<QuestionHealthOutcome, number>;
    }>;
  };
  delayedProbe: null | {
    durationBucket: PrototypeDurationBucket;
    candidate: "accepted" | "rejected";
    decision: "would_issue" | "would_not_issue" | "undecided";
    evidenceKind: "personal_paired" | "generic_cohort" | "not_selected";
    rejectionReasons: DelayedProbeRejectionReason[];
    counts: {
      sourceConcepts: number;
      candidateConcepts: number;
      overlappingConcepts: number;
    };
  };
}

export function prototypeDurationBucket(elapsedMs: number): PrototypeDurationBucket {
  const duration = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  if (duration < 60_000) return "under_1m";
  if (duration < 2 * 60_000) return "1_to_2m";
  if (duration < 5 * 60_000) return "2_to_5m";
  if (duration < 15 * 60_000) return "5_to_15m";
  return "over_15m";
}

function safeCount(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function enumValue<const TValue extends string>(
  value: unknown,
  allowed: readonly TValue[],
  fallback: TValue,
): TValue {
  return typeof value === "string" && allowed.includes(value as TValue)
    ? (value as TValue)
    : fallback;
}

function questionHealthEvidence(
  input: NonNullable<PrototypeEvidenceInput["questionHealth"]>,
): NonNullable<PrototypeEvidenceExportV1["questionHealth"]> {
  const evaluations = (Array.isArray(input.evaluations) ? input.evaluations : []).filter(
    (evaluation) =>
      evaluation &&
      QUESTION_HEALTH_RULE_IDS.includes(evaluation.ruleId) &&
      evaluation.ruleVersion === 1 &&
      evaluation.rulesetVersion === QUESTION_HEALTH_RULESET_VERSION &&
      (["useful", "not_useful", "pending"] as const).includes(evaluation.usefulness) &&
      (["retained_revision", "deliberate_dismissal", "no_decision", "pending"] as const).includes(
        evaluation.outcome,
      ),
  );
  const usefulnessReviewed = evaluations.filter(
    (evaluation) => evaluation.usefulness !== "pending",
  );
  const outcomesReviewed = evaluations.filter((evaluation) => evaluation.outcome !== "pending");
  const outcomeCount = (outcome: QuestionHealthOutcome) =>
    outcomesReviewed.filter((evaluation) => evaluation.outcome === outcome).length;

  return {
    rulesetVersion: QUESTION_HEALTH_RULESET_VERSION,
    durationBucket: prototypeDurationBucket(input.durationMs),
    counts: {
      questionsEvaluated: safeCount(input.evaluatedQuestionCount),
      findingsRecorded: evaluations.length,
      fullyReviewed: evaluations.filter(
        (evaluation) => evaluation.usefulness !== "pending" && evaluation.outcome !== "pending",
      ).length,
      usefulnessReviewed: usefulnessReviewed.length,
      usefulnessPending: evaluations.length - usefulnessReviewed.length,
      useful: usefulnessReviewed.filter((evaluation) => evaluation.usefulness === "useful").length,
      notUseful: usefulnessReviewed.filter((evaluation) => evaluation.usefulness === "not_useful")
        .length,
      outcomesReviewed: outcomesReviewed.length,
      outcomePending: evaluations.length - outcomesReviewed.length,
      retainedRevision: outcomeCount("retained_revision"),
      deliberateDismissal: outcomeCount("deliberate_dismissal"),
      noDecision: outcomeCount("no_decision"),
    },
    rules: QUESTION_HEALTH_RULE_IDS.flatMap((ruleId) => {
      const ruleEvaluations = evaluations.filter((evaluation) => evaluation.ruleId === ruleId);
      if (ruleEvaluations.length === 0) return [];
      return [
        {
          ruleId,
          ruleVersion: 1 as const,
          findingCount: ruleEvaluations.length,
          usefulnessReviewedCount: ruleEvaluations.filter(
            (evaluation) => evaluation.usefulness !== "pending",
          ).length,
          usefulCount: ruleEvaluations.filter((evaluation) => evaluation.usefulness === "useful")
            .length,
          notUsefulCount: ruleEvaluations.filter(
            (evaluation) => evaluation.usefulness === "not_useful",
          ).length,
          outcomesReviewedCount: ruleEvaluations.filter(
            (evaluation) => evaluation.outcome !== "pending",
          ).length,
          outcomes: {
            retained_revision: ruleEvaluations.filter(
              (evaluation) => evaluation.outcome === "retained_revision",
            ).length,
            deliberate_dismissal: ruleEvaluations.filter(
              (evaluation) => evaluation.outcome === "deliberate_dismissal",
            ).length,
            no_decision: ruleEvaluations.filter(
              (evaluation) => evaluation.outcome === "no_decision",
            ).length,
          },
        },
      ];
    }),
  };
}

/**
 * Returns an aggregate-only study record. It deliberately reconstructs every branch instead of
 * spreading caller data so content, identifiers, aliases, URLs, and free text cannot leak into
 * the export even when an untyped browser caller supplies extra properties.
 */
export function buildPrototypeEvidenceExport(
  input: PrototypeEvidenceInput,
): PrototypeEvidenceExportV1 {
  const companion = input.companion
    ? {
        durationBucket: prototypeDurationBucket(input.companion.durationMs),
        completion: enumValue(
          input.companion.completion,
          ["completed", "abandoned"] as const,
          "abandoned",
        ),
        returnToDeckOutcome: enumValue(
          input.companion.returnToDeckOutcome,
          ["successful", "unsuccessful", "not_tested"] as const,
          "not_tested",
        ),
        counts: {
          primaryActions: safeCount(input.companion.primaryActionCount),
          overlaysOpened: safeCount(input.companion.overlayOpenCount),
        },
      }
    : null;
  const questionHealth = input.questionHealth ? questionHealthEvidence(input.questionHealth) : null;
  const delayedProbe = input.delayedProbe
    ? (() => {
        const evaluation = input.delayedProbe.evaluation;
        const sourceConcepts = safeCount(evaluation.sourceConceptCount);
        const candidateConcepts = safeCount(evaluation.candidateConceptCount);
        const overlappingConcepts = Math.min(
          sourceConcepts,
          candidateConcepts,
          safeCount(evaluation.overlappingConceptCount),
        );
        const rejectionReasons = [
          ...new Set(
            (Array.isArray(evaluation.rejectionReasons) ? evaluation.rejectionReasons : []).filter(
              (reason) => DELAYED_PROBE_REJECTION_REASONS.includes(reason),
            ),
          ),
        ];
        if (
          evaluation.promptDifference !== "meaningfully_different" &&
          !rejectionReasons.includes("prompt_not_meaningfully_different")
        ) {
          rejectionReasons.push("prompt_not_meaningfully_different");
        }
        if (sourceConcepts === 0 && !rejectionReasons.includes("missing_source_concepts")) {
          rejectionReasons.push("missing_source_concepts");
        }
        if (candidateConcepts === 0 && !rejectionReasons.includes("missing_candidate_concepts")) {
          rejectionReasons.push("missing_candidate_concepts");
        }
        if (
          sourceConcepts > 0 &&
          candidateConcepts > 0 &&
          overlappingConcepts === 0 &&
          !rejectionReasons.includes("no_concept_overlap")
        ) {
          rejectionReasons.push("no_concept_overlap");
        }
        const accepted =
          evaluation.accepted === true &&
          evaluation.promptDifference === "meaningfully_different" &&
          sourceConcepts > 0 &&
          candidateConcepts > 0 &&
          overlappingConcepts > 0 &&
          rejectionReasons.length === 0;

        return {
          durationBucket: prototypeDurationBucket(input.delayedProbe.durationMs),
          candidate: accepted ? ("accepted" as const) : ("rejected" as const),
          decision: enumValue(
            input.delayedProbe.decision,
            ["would_issue", "would_not_issue", "undecided"] as const,
            "undecided",
          ),
          evidenceKind: enumValue(
            input.delayedProbe.evidenceKind,
            ["personal_paired", "generic_cohort", "not_selected"] as const,
            "not_selected",
          ),
          rejectionReasons,
          counts: { sourceConcepts, candidateConcepts, overlappingConcepts },
        };
      })()
    : null;

  return {
    schemaVersion: PROTOTYPE_EVIDENCE_SCHEMA_VERSION,
    protocolVersion: PROTOTYPE_EVIDENCE_PROTOCOL_VERSION,
    segment: enumValue(
      input.segment,
      ["education", "workplace", "unclassified"] as const,
      "unclassified",
    ),
    prototypeCount: [companion, questionHealth, delayedProbe].filter(Boolean).length,
    companion,
    questionHealth,
    delayedProbe,
  };
}

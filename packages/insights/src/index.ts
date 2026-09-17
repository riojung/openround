import {
  questionPurpose,
  type CheckpointInsight,
  type ConfidenceValue,
  type QuestionDraft,
  type ResponsePayload,
} from "@openround/contracts";

export interface InsightResponse {
  response: ResponsePayload;
  correct: boolean;
  confidence: ConfidenceValue | null;
}

export interface InsightInput {
  question: QuestionDraft;
  responses: InsightResponse[];
  activeParticipantCount: number;
}

function percentage(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 1_000) / 10;
}

function choiceIds(response: ResponsePayload) {
  return response.kind === "choice" || response.kind === "poll" ? response.choiceIds : [];
}

export function deriveCheckpointInsight(input: InsightInput): CheckpointInsight {
  const sampleSize = input.responses.length;
  const participationPercent = percentage(sampleSize, input.activeParticipantCount);
  const scored = questionPurpose(input.question) !== "opinion";
  const correctResponses = scored ? input.responses.filter((response) => response.correct) : [];
  const wrongResponses = scored ? input.responses.filter((response) => !response.correct) : [];
  const correctnessPercent = scored ? percentage(correctResponses.length, sampleSize) : null;
  const highConfidenceWrong = scored
    ? input.responses.filter((response) => !response.correct && response.confidence === 3).length
    : 0;
  const highConfidenceWrongPercent = scored ? percentage(highConfidenceWrong, sampleSize) : null;
  const correctLowConfidence = scored
    ? correctResponses.filter((response) => response.confidence === 1).length
    : 0;
  const correctLowConfidencePercent = scored
    ? percentage(correctLowConfidence, correctResponses.length)
    : null;

  const misconceptionCounts = new Map<string, number>();
  const wrongChoiceCounts = new Map<string, number>();
  if ("choices" in input.question) {
    const choices = new Map(input.question.choices.map((choice) => [choice.id, choice]));
    for (const response of wrongResponses) {
      for (const choiceId of choiceIds(response.response)) {
        const choice = choices.get(choiceId);
        wrongChoiceCounts.set(choiceId, (wrongChoiceCounts.get(choiceId) ?? 0) + 1);
        if (choice?.misconceptionKey) {
          misconceptionCounts.set(
            choice.misconceptionKey,
            (misconceptionCounts.get(choice.misconceptionKey) ?? 0) + 1,
          );
        }
      }
    }
  }
  const leadingMisconception = [...misconceptionCounts.entries()].sort(
    ([leftKey, leftCount], [rightKey, rightCount]) =>
      rightCount - leftCount || leftKey.localeCompare(rightKey),
  )[0];
  const dominantMisconception = leadingMisconception
    ? {
        key: leadingMisconception[0],
        responses: leadingMisconception[1],
        allResponsePercent: percentage(leadingMisconception[1], sampleSize),
        wrongResponsePercent: percentage(leadingMisconception[1], wrongResponses.length),
      }
    : null;
  const misconceptionIsDominant = Boolean(
    dominantMisconception &&
    dominantMisconception.responses >= 3 &&
    (dominantMisconception.allResponsePercent >= 25 ||
      dominantMisconception.wrongResponsePercent >= 50),
  );
  const topWrongCount = Math.max(0, ...wrongChoiceCounts.values());
  const topWrongPercent = percentage(topWrongCount, sampleSize);
  const split =
    correctnessPercent !== null &&
    topWrongCount > 0 &&
    Math.abs(correctnessPercent - topWrongPercent) <= 15;
  const strong = sampleSize >= 5;

  let recommendation: CheckpointInsight["recommendation"];
  if (sampleSize < 5) {
    recommendation = {
      code: "insufficient_sample",
      action: "continue",
      title: "Use your judgment",
      reason: `Only ${sampleSize} response${sampleSize === 1 ? "" : "s"} are available; no strong recommendation is made below 5.`,
      strong: false,
    };
  } else if (participationPercent < 70) {
    recommendation = {
      code: "low_participation",
      action: "wait_or_check_access",
      title: "Check access before interpreting",
      reason: `${participationPercent}% of active participants responded, below the 70% guidance threshold.`,
      strong,
    };
  } else if ((highConfidenceWrongPercent ?? 0) >= 20) {
    recommendation = {
      code: "high_confidence_error",
      action: "target_misconception",
      title: "Address the confident misconception",
      reason: `${highConfidenceWrongPercent}% responded incorrectly with “Very sure” confidence, meeting the 20% threshold.`,
      strong,
    };
  } else if (misconceptionIsDominant && dominantMisconception) {
    recommendation = {
      code: "dominant_misconception",
      action: "target_misconception",
      title: `Address “${dominantMisconception.key}”`,
      reason: `${dominantMisconception.responses} responses matched this authored misconception (${dominantMisconception.wrongResponsePercent}% of wrong responses).`,
      strong,
    };
  } else if ((correctnessPercent ?? 100) < 60) {
    recommendation = {
      code: "low_correctness",
      action: "show_example",
      title: "Explain or work through an example",
      reason: `${correctnessPercent}% were correct, below the 60% guidance threshold.`,
      strong,
    };
  } else if (split) {
    recommendation = {
      code: "split_understanding",
      action: "peer_discussion",
      title: "Try peer discussion",
      reason: `The correct response and leading wrong response are within 15 percentage points (${correctnessPercent}% versus ${topWrongPercent}%).`,
      strong,
    };
  } else if ((correctnessPercent ?? 0) >= 80 && (correctLowConfidencePercent ?? 0) >= 30) {
    recommendation = {
      code: "correct_but_uncertain",
      action: "reinforce",
      title: "Reinforce why it is correct",
      reason: `${correctnessPercent}% were correct, but ${correctLowConfidencePercent}% of correct respondents selected “Not sure”.`,
      strong,
    };
  } else {
    recommendation = {
      code: scored ? "continue" : "opinion_result",
      action: "continue",
      title: scored ? "Continue or optionally recheck" : "Review the audience response",
      reason: scored
        ? "No documented intervention threshold was reached."
        : "Opinion checkpoints are unscored and do not produce a correctness recommendation.",
      strong,
    };
  }

  return {
    sampleSize,
    activeParticipantCount: input.activeParticipantCount,
    participationPercent,
    correctnessPercent,
    highConfidenceWrongPercent,
    correctLowConfidencePercent,
    dominantMisconception,
    recommendation,
  };
}

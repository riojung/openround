import type { QuestionDraft } from "@openround/contracts";
import { normalizePrototypeConceptKey } from "./prototype-normalization";

export const DELAYED_PROBE_PROTOTYPE_VERSION = "p0.1.0" as const;

export const DELAYED_PROBE_REJECTION_REASONS = [
  "missing_prompt",
  "prompt_not_meaningfully_different",
  "missing_source_concepts",
  "missing_candidate_concepts",
  "no_concept_overlap",
] as const;

export type DelayedProbeRejectionReason = (typeof DELAYED_PROBE_REJECTION_REASONS)[number];

export interface DelayedProbeEvaluation {
  version: typeof DELAYED_PROBE_PROTOTYPE_VERSION;
  accepted: boolean;
  promptDifference: "meaningfully_different" | "same_or_near_duplicate";
  sourceConceptCount: number;
  candidateConceptCount: number;
  overlappingConceptCount: number;
  overlappingConceptKeys: string[];
  rejectionReasons: DelayedProbeRejectionReason[];
}

const PROMPT_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "is",
  "of",
  "the",
  "to",
  "what",
  "which",
]);

function normalizedPrompt(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function promptTokens(value: string) {
  return new Set(
    normalizedPrompt(value)
      .split(" ")
      .filter((token) => token && !PROMPT_STOP_WORDS.has(token)),
  );
}

function conceptKeys(question: QuestionDraft) {
  return [
    ...new Set((question.conceptKeys ?? []).map(normalizePrototypeConceptKey).filter(Boolean)),
  ].sort();
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution =
        previous[rightIndex - 1]! +
        (left.charAt(leftIndex - 1) === right.charAt(rightIndex - 1) ? 0 : 1);
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        substitution,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length]!;
}

function promptsAreMeaningfullyDifferent(source: string, candidate: string) {
  const normalizedSource = normalizedPrompt(source);
  const normalizedCandidate = normalizedPrompt(candidate);
  if (!normalizedSource || !normalizedCandidate || normalizedSource === normalizedCandidate) {
    return false;
  }

  const maxLength = Math.max(normalizedSource.length, normalizedCandidate.length);
  if (maxLength > 0 && 1 - editDistance(normalizedSource, normalizedCandidate) / maxLength >= 0.9) {
    return false;
  }

  const sourceTokens = promptTokens(source);
  const candidateTokens = promptTokens(candidate);
  if (sourceTokens.size === 0 || candidateTokens.size === 0) return true;
  const shared = [...sourceTokens].filter((token) => candidateTokens.has(token)).length;
  const smallerSize = Math.min(sourceTokens.size, candidateTokens.size);
  const symmetricDifference = sourceTokens.size + candidateTokens.size - shared * 2;
  return !(shared / smallerSize >= 0.8 && symmetricDifference <= 2);
}

export function evaluateDelayedProbeCandidate(input: {
  source: QuestionDraft;
  candidate: QuestionDraft;
}): DelayedProbeEvaluation {
  const sourcePrompt = normalizedPrompt(input.source.prompt);
  const candidatePrompt = normalizedPrompt(input.candidate.prompt);
  const promptDifferent = promptsAreMeaningfullyDifferent(
    input.source.prompt,
    input.candidate.prompt,
  );
  const sourceConcepts = conceptKeys(input.source);
  const candidateConcepts = conceptKeys(input.candidate);
  const candidateConceptSet = new Set(candidateConcepts);
  const overlap = sourceConcepts.filter((concept) => candidateConceptSet.has(concept));
  const rejectionReasons: DelayedProbeRejectionReason[] = [];

  if (!sourcePrompt || !candidatePrompt) rejectionReasons.push("missing_prompt");
  if (!promptDifferent && sourcePrompt && candidatePrompt) {
    rejectionReasons.push("prompt_not_meaningfully_different");
  }
  if (sourceConcepts.length === 0) rejectionReasons.push("missing_source_concepts");
  if (candidateConcepts.length === 0) rejectionReasons.push("missing_candidate_concepts");
  if (sourceConcepts.length > 0 && candidateConcepts.length > 0 && overlap.length === 0) {
    rejectionReasons.push("no_concept_overlap");
  }

  return {
    version: DELAYED_PROBE_PROTOTYPE_VERSION,
    accepted: rejectionReasons.length === 0,
    promptDifference: promptDifferent ? "meaningfully_different" : "same_or_near_duplicate",
    sourceConceptCount: sourceConcepts.length,
    candidateConceptCount: candidateConcepts.length,
    overlappingConceptCount: overlap.length,
    overlappingConceptKeys: overlap,
    rejectionReasons,
  };
}

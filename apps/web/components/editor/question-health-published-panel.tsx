"use client";

import { useEffect, useRef, useState } from "react";
import {
  QuestionHealthPublishedResultSchema,
  type QuestionHealthFinding,
  type QuestionHealthPublishedResult,
} from "@openround/contracts";
import { apiFetch, humanError } from "../../lib/api";
import styles from "./question-health-panel.module.css";

const ruleLabels: Record<QuestionHealthFinding["ruleId"], string> = {
  "choice.duplicate": "Duplicate choices",
  "choice.overlap": "Overlapping choices",
  "choice.length_cue": "Choice length cue",
  "choice.missing_rationale": "Distractor rationale missing",
  "question.missing_explanation": "Explanation missing",
  "question.missing_citation": "Citation missing",
  "question.dense_content": "Review mobile density",
  "question.configuration_mismatch": "Question settings may conflict",
  "recheck.same_prompt": "Recheck repeats the prompt",
  "recheck.concept_mismatch": "Recheck concept mismatch",
};

export function PublishedQuestionHealthResults({
  result,
  canEdit,
  draftQuestionIds,
  onOpenDraftQuestion,
}: {
  result: QuestionHealthPublishedResult;
  canEdit: boolean;
  draftQuestionIds: ReadonlySet<string>;
  onOpenDraftQuestion: (questionId: string) => void;
}) {
  return (
    <div className={styles.results}>
      <p className={styles.status} role="status">
        Reviewed immutable published v{result.version.number} using Question Health ruleset{" "}
        {result.rulesetVersion}. The current draft may differ.
      </p>
      <details className={styles.provenance}>
        <summary>Published version provenance</summary>
        <p>
          Version ID: <code>{result.version.id}</code>
        </p>
        <p>
          Published content hash: <code>{result.version.contentHash}</code>
        </p>
        {result.version.sourceDraftRevision !== null ? (
          <p>Source draft revision: {result.version.sourceDraftRevision}</p>
        ) : null}
      </details>
      {result.findings.length === 0 ? (
        <p>
          No advisory findings for this published version. This check cannot guarantee question
          quality.
        </p>
      ) : (
        <>
          <p className={styles.count}>
            {result.findings.length} advisory finding{result.findings.length === 1 ? "" : "s"}{" "}
            across {result.evaluatedQuestionCount} question
            {result.evaluatedQuestionCount === 1 ? "" : "s"}.
            {result.findingsTruncated ? " Additional findings may be omitted." : ""}
          </p>
          <ul className={styles.findings} aria-label="Published version Question Health findings">
            {result.findings.map((finding) => (
              <li className={styles.finding} key={finding.id}>
                <strong>{ruleLabels[finding.ruleId]}</strong>
                <p>{finding.reason}</p>
                <p>
                  <span>Evidence: </span>
                  {finding.evidence}
                </p>
                <p>
                  <span>Suggested action: </span>
                  {finding.recommendedAction}
                </p>
                <small>{finding.fieldPath}</small>
                {canEdit && draftQuestionIds.has(finding.questionId) ? (
                  <button
                    className="button-secondary small-button"
                    onClick={() => onOpenDraftQuestion(finding.questionId)}
                    type="button"
                  >
                    Edit matching question in current draft
                  </button>
                ) : canEdit ? (
                  <p>This published question is no longer in the current draft.</p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function PublishedQuestionHealthPanel({
  quizId,
  versionId,
  featureEnabled,
  canEdit,
  draftQuestionIds,
  onOpenDraftQuestion,
}: {
  quizId: string;
  versionId: string | null;
  featureEnabled: boolean;
  canEdit: boolean;
  draftQuestionIds: ReadonlySet<string>;
  onOpenDraftQuestion: (questionId: string) => void;
}) {
  const [result, setResult] = useState<QuestionHealthPublishedResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  useEffect(() => {
    requestId.current += 1;
    setResult(null);
    setError("");
    setLoading(false);
  }, [quizId, versionId]);

  if (!featureEnabled || !versionId) return null;
  const displayedResult =
    result?.quizId === quizId && result.version.id === versionId ? result : null;

  async function reviewPublishedVersion() {
    if (!versionId) return;
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await apiFetch<unknown>(
        `/v1/quizzes/${quizId}/versions/${encodeURIComponent(versionId)}/question-health`,
      );
      if (currentRequest !== requestId.current) return;
      const next = QuestionHealthPublishedResultSchema.parse(response);
      if (next.quizId !== quizId || next.version.id !== versionId) {
        throw new Error("The published version changed. Reload this Round and review it again.");
      }
      setResult(next);
    } catch (caught) {
      if (currentRequest === requestId.current) setError(humanError(caught));
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }

  return (
    <details className={`${styles.panel} ${styles.publishedPanel}`} lang="en-CA">
      <summary>Question Health · published version (read-only)</summary>
      <div className={styles.content}>
        <p className={styles.description}>
          Inspect the exact content of the current published version. Findings are advisory and
          cannot be dismissed or applied here. To make a change, edit the separate current draft and
          publish a new version; the published version never changes.
        </p>
        <button
          className="button-secondary small-button"
          disabled={loading}
          onClick={() => void reviewPublishedVersion()}
          type="button"
        >
          {loading
            ? "Reviewing published version…"
            : displayedResult
              ? "Review published version again"
              : "Review published version"}
        </button>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {displayedResult ? (
          <PublishedQuestionHealthResults
            canEdit={canEdit}
            draftQuestionIds={draftQuestionIds}
            onOpenDraftQuestion={onOpenDraftQuestion}
            result={displayedResult}
          />
        ) : null}
      </div>
    </details>
  );
}

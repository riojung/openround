"use client";

import { useState } from "react";
import { QuestionHealthResultSchema, type QuestionHealthFinding } from "@openround/contracts";
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

export function QuestionHealthPanel({
  quizId,
  currentDraftRevision,
  draftSaved,
}: {
  quizId: string;
  currentDraftRevision: number;
  draftSaved: boolean;
}) {
  const [result, setResult] = useState<ReturnType<typeof QuestionHealthResultSchema.parse> | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const stale = Boolean(result && (!draftSaved || result.draftRevision !== currentDraftRevision));

  async function reviewSavedDraft() {
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch<unknown>(`/v1/quizzes/${quizId}/question-health`);
      setResult(QuestionHealthResultSchema.parse(response));
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <details className={styles.panel} lang="en-CA">
      <summary>Question Health · advisory</summary>
      <div className={styles.content}>
        <p className={styles.description}>
          Review deterministic writing checks on the saved draft. These suggestions do not block
          publishing and never change question content.
        </p>
        <button
          className="button-secondary small-button"
          disabled={loading || !draftSaved}
          onClick={() => void reviewSavedDraft()}
          type="button"
        >
          {loading ? "Reviewing…" : result ? "Review saved draft again" : "Review saved draft"}
        </button>
        {!draftSaved ? (
          <p className={styles.status} role="status">
            Save your latest edits before reviewing them.
          </p>
        ) : null}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {result ? (
          <div className={styles.results}>
            <p className={styles.status} role="status">
              {stale
                ? `These findings are for saved draft revision ${result.draftRevision}; review the current saved draft again.`
                : `Reviewed saved draft revision ${result.draftRevision}.`}
            </p>
            {result.findings.length === 0 ? (
              <p>
                No advisory findings for this draft. This check cannot guarantee question quality.
              </p>
            ) : (
              <>
                <p className={styles.count}>
                  {result.findings.length > 20
                    ? result.findingsTruncated
                      ? `Showing 20 of at least ${result.findings.length} findings.`
                      : `Showing 20 of ${result.findings.length} findings.`
                    : `${result.findings.length} advisory finding${result.findings.length === 1 ? "" : "s"}.`}
                </p>
                <ul className={styles.findings}>
                  {result.findings.slice(0, 20).map((finding) => (
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
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : null}
      </div>
    </details>
  );
}

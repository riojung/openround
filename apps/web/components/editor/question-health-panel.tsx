"use client";

import { useEffect, useRef, useState } from "react";
import {
  QuestionHealthDismissalReasonSchema,
  QuestionHealthResultSchema,
  QuestionHealthRevisionPreviewSchema,
  type QuestionHealthDismissal,
  type QuestionHealthDismissalReason,
  type QuestionHealthFinding,
  type QuestionHealthRevisionApplyInput,
  type QuestionHealthRevisionApplied,
  type QuestionHealthRevisionPreview,
  type QuestionHealthRevisionUndoInput,
} from "@openround/contracts";
import { ApiClientError, apiFetch, humanError } from "../../lib/api";
import { clientUuid } from "../../lib/uuid";
import {
  healthChangeValue,
  healthRevisionAction,
  healthRevisionControl,
} from "../../lib/question-health-revision-ui";
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

const dismissalReasonLabels: Record<QuestionHealthDismissalReason, string> = {
  false_positive: "This finding does not apply",
  intentional_choice: "This is intentional for this question",
  will_address_later: "I will address this later",
};

export function QuestionHealthPanel({
  quizId,
  canEdit,
  currentDraftRevision,
  draftSaved,
  featureEnabled = true,
  onApplySuggestion,
  onUndoSuggestion,
}: {
  quizId: string;
  canEdit: boolean;
  currentDraftRevision: number;
  draftSaved: boolean;
  featureEnabled?: boolean;
  onApplySuggestion?: (
    findingId: string,
    input: QuestionHealthRevisionApplyInput,
  ) => Promise<QuestionHealthRevisionApplied>;
  onUndoSuggestion?: (
    applicationId: string,
    input: QuestionHealthRevisionUndoInput,
  ) => Promise<void>;
}) {
  const [result, setResult] = useState<ReturnType<typeof QuestionHealthResultSchema.parse> | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [savingFindingId, setSavingFindingId] = useState("");
  const [hasSavedDismissal, setHasSavedDismissal] = useState(false);
  const [selectedReasons, setSelectedReasons] = useState<
    Record<string, QuestionHealthDismissalReason | "">
  >({});
  const [editingFindingId, setEditingFindingId] = useState("");
  const [replacementValue, setReplacementValue] = useState("");
  const [preview, setPreview] = useState<QuestionHealthRevisionPreview | null>(null);
  const [previewAction, setPreviewAction] = useState<
    QuestionHealthRevisionApplyInput["action"] | null
  >(null);
  const [previewing, setPreviewing] = useState(false);
  const [revisionSaving, setRevisionSaving] = useState(false);
  const [appliedRevision, setAppliedRevision] = useState<{
    applicationId: string;
    revision: number;
  } | null>(null);
  const previewRequest = useRef(0);
  const applyAttempt = useRef<{ signature: string; mutationId: string } | null>(null);
  const undoAttempt = useRef<{ applicationId: string; mutationId: string } | null>(null);
  const stale = Boolean(result && (!draftSaved || result.draftRevision !== currentDraftRevision));
  const dismissalByFindingId = new Map(
    result?.dismissals.map((dismissal) => [dismissal.findingId, dismissal]) ?? [],
  );
  const activeFindings = (result?.findings ?? []).filter(
    (finding) => !dismissalByFindingId.has(finding.id),
  );
  const dismissedFindings = (result?.findings ?? []).filter((finding) =>
    dismissalByFindingId.has(finding.id),
  );

  useEffect(() => {
    if (featureEnabled) return;
    let active = true;
    void apiFetch<unknown>(`/v1/quizzes/${quizId}/question-health`)
      .then((response) => QuestionHealthResultSchema.parse(response))
      .then((saved) => {
        if (!active) return;
        setResult(saved);
        setHasSavedDismissal(saved.dismissals.length > 0);
      })
      .catch(() => {
        if (!active) return;
        setResult(null);
        setHasSavedDismissal(false);
      });
    return () => {
      active = false;
    };
  }, [featureEnabled, quizId]);

  useEffect(() => {
    if (draftSaved && (!result || result.draftRevision === currentDraftRevision)) return;
    previewRequest.current += 1;
    setPreview(null);
    setPreviewAction(null);
    setPreviewing(false);
  }, [currentDraftRevision, draftSaved, result]);

  async function fetchResult() {
    try {
      const response = await apiFetch<unknown>(`/v1/quizzes/${quizId}/question-health`);
      const next = QuestionHealthResultSchema.parse(response);
      setResult(next);
      if (!featureEnabled) setHasSavedDismissal(next.dismissals.length > 0);
    } catch (caught) {
      if (!featureEnabled && caught instanceof ApiClientError && caught.status === 404) {
        setResult(null);
        setHasSavedDismissal(false);
        return;
      }
      throw caught;
    }
  }

  async function reviewSavedDraft() {
    setLoading(true);
    setError("");
    try {
      await fetchResult();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setLoading(false);
    }
  }

  async function dismissFinding(finding: QuestionHealthFinding) {
    if (!canEdit || !featureEnabled) return;
    const reason = selectedReasons[finding.id];
    if (!reason) return;
    setSavingFindingId(finding.id);
    setError("");
    try {
      await apiFetch<unknown>(
        `/v1/quizzes/${quizId}/question-health/dismissals/${encodeURIComponent(finding.id)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            draftRevision: result?.draftRevision,
            ruleVersion: finding.ruleVersion,
            rulesetVersion: finding.rulesetVersion,
            contentHash: finding.contentHash,
            reason,
          }),
        },
      );
      await fetchResult();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setSavingFindingId("");
    }
  }

  async function reopenFinding(dismissal: QuestionHealthDismissal) {
    if (!canEdit) return;
    setSavingFindingId(dismissal.findingId);
    setError("");
    try {
      await apiFetch<{ removed: boolean }>(
        `/v1/quizzes/${quizId}/question-health/dismissals/${encodeURIComponent(dismissal.findingId)}`,
        {
          method: "DELETE",
          body: JSON.stringify({
            draftRevision: result?.draftRevision,
            ruleVersion: dismissal.ruleVersion,
            rulesetVersion: dismissal.rulesetVersion,
            contentHash: dismissal.contentHash,
          }),
        },
      );
      await fetchResult();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setSavingFindingId("");
    }
  }

  function startRevision(findingId: string) {
    previewRequest.current += 1;
    setEditingFindingId((current) => (current === findingId ? "" : findingId));
    setReplacementValue("");
    setPreview(null);
    setPreviewAction(null);
    setPreviewing(false);
    setError("");
  }

  async function previewRevision(finding: QuestionHealthFinding) {
    if (!canEdit || !featureEnabled || stale || !draftSaved || revisionSaving) return;
    const control = healthRevisionControl(finding);
    const action = control && healthRevisionAction(control, replacementValue);
    if (!action || !result) return;
    const requestNumber = ++previewRequest.current;
    setPreviewing(true);
    setPreview(null);
    setPreviewAction(null);
    setError("");
    try {
      const response = await apiFetch<unknown>(
        `/v1/quizzes/${quizId}/question-health/findings/${encodeURIComponent(finding.id)}/preview`,
        {
          method: "POST",
          body: JSON.stringify({
            draftRevision: result.draftRevision,
            ruleVersion: finding.ruleVersion,
            rulesetVersion: finding.rulesetVersion,
            contentHash: finding.contentHash,
            action,
          }),
        },
      );
      if (requestNumber !== previewRequest.current) return;
      const next = QuestionHealthRevisionPreviewSchema.parse(response);
      if (
        next.findingId !== finding.id ||
        next.draftRevision !== result.draftRevision ||
        next.contentHash !== finding.contentHash
      ) {
        throw new Error(
          "The preview no longer matches this finding. Review the saved draft again.",
        );
      }
      setPreview(next);
      setPreviewAction(action);
    } catch (caught) {
      if (requestNumber === previewRequest.current) setError(humanError(caught));
    } finally {
      if (requestNumber === previewRequest.current) setPreviewing(false);
    }
  }

  async function applyRevision(finding: QuestionHealthFinding) {
    if (
      !onApplySuggestion ||
      !result ||
      !preview ||
      !previewAction ||
      !canEdit ||
      !featureEnabled ||
      stale ||
      !draftSaved ||
      revisionSaving ||
      preview.findingId !== finding.id ||
      preview.draftRevision !== result.draftRevision ||
      preview.contentHash !== finding.contentHash
    ) {
      return;
    }
    const signature = JSON.stringify({
      findingId: finding.id,
      draftRevision: result.draftRevision,
      contentHash: finding.contentHash,
      action: previewAction,
    });
    if (applyAttempt.current?.signature !== signature) {
      applyAttempt.current = { signature, mutationId: clientUuid() };
    }
    setRevisionSaving(true);
    setError("");
    try {
      const applied = await onApplySuggestion(finding.id, {
        draftRevision: result.draftRevision,
        ruleVersion: finding.ruleVersion,
        rulesetVersion: finding.rulesetVersion,
        contentHash: finding.contentHash,
        action: previewAction,
        mutationId: applyAttempt.current.mutationId,
      });
      applyAttempt.current = null;
      setAppliedRevision({
        applicationId: applied.applicationId,
        revision: applied.appliedRevision,
      });
      setEditingFindingId("");
      setPreview(null);
      setPreviewAction(null);
      await fetchResult();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setRevisionSaving(false);
    }
  }

  async function undoRevision() {
    if (
      !onUndoSuggestion ||
      !appliedRevision ||
      !canEdit ||
      !draftSaved ||
      revisionSaving ||
      currentDraftRevision !== appliedRevision.revision
    ) {
      return;
    }
    if (undoAttempt.current?.applicationId !== appliedRevision.applicationId) {
      undoAttempt.current = {
        applicationId: appliedRevision.applicationId,
        mutationId: clientUuid(),
      };
    }
    setRevisionSaving(true);
    setError("");
    try {
      await onUndoSuggestion(appliedRevision.applicationId, {
        expectedRevision: appliedRevision.revision,
        mutationId: undoAttempt.current.mutationId,
      });
      undoAttempt.current = null;
      setAppliedRevision(null);
      await fetchResult();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setRevisionSaving(false);
    }
  }

  if (!featureEnabled && !hasSavedDismissal) return null;

  return (
    <details className={styles.panel} lang="en-CA">
      <summary>
        {featureEnabled ? "Question Health · advisory" : "Saved Question Health decisions"}
      </summary>
      <div className={styles.content}>
        <p className={styles.description}>
          {featureEnabled
            ? "Review deterministic writing checks on the saved draft. Findings do not block publishing. You can preview a change before applying it to the draft; published versions never change."
            : canEdit
              ? "These saved dismissals remain available for review and reopening. New Question Health reviews are currently unavailable."
              : "These saved dismissals remain available for review. New Question Health reviews are currently unavailable."}
        </p>
        <button
          className="button-secondary small-button"
          disabled={loading || Boolean(savingFindingId) || !draftSaved}
          onClick={() => void reviewSavedDraft()}
          type="button"
        >
          {loading
            ? "Reviewing…"
            : featureEnabled
              ? result
                ? "Review saved draft again"
                : "Review saved draft"
              : "Refresh saved decisions"}
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
        {appliedRevision ? (
          <div className={styles.undoNotice} role="status">
            <span>
              Applied to draft revision {appliedRevision.revision}. The published version is
              unchanged.
            </span>
            {currentDraftRevision === appliedRevision.revision ? (
              <button
                className="button-secondary small-button"
                disabled={!draftSaved || revisionSaving || !canEdit}
                onClick={() => void undoRevision()}
                type="button"
              >
                {revisionSaving ? "Saving…" : "Undo this revision"}
              </button>
            ) : (
              <span>Undo is unavailable after other draft changes.</span>
            )}
          </div>
        ) : null}
        {result ? (
          <div className={styles.results}>
            <p className={styles.status} role="status">
              {stale
                ? `These findings are for saved draft revision ${result.draftRevision}; refresh after saving the current draft.`
                : featureEnabled
                  ? `Reviewed saved draft revision ${result.draftRevision}.`
                  : `Saved decisions for draft revision ${result.draftRevision}.`}
            </p>
            {result.findings.length === 0 ? (
              <p>
                No advisory findings for this draft. This check cannot guarantee question quality.
              </p>
            ) : (
              <>
                <p className={styles.count}>
                  {featureEnabled
                    ? `${activeFindings.length} active advisory finding${activeFindings.length === 1 ? "" : "s"}; ${dismissedFindings.length} dismissed.`
                    : `${dismissedFindings.length} saved dismissal${dismissedFindings.length === 1 ? "" : "s"}.`}
                  {featureEnabled && result.findingsTruncated
                    ? " Additional findings may be omitted."
                    : ""}
                </p>
                {featureEnabled && activeFindings.length > 0 ? (
                  <ul className={styles.findings} aria-label="Active Question Health findings">
                    {activeFindings.slice(0, 20).map((finding) => {
                      const revisionControl = healthRevisionControl(finding);
                      const revisionAction =
                        revisionControl && healthRevisionAction(revisionControl, replacementValue);
                      const thisPreview = preview?.findingId === finding.id ? preview : null;
                      return (
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
                          {canEdit && onApplySuggestion && revisionControl ? (
                            <div className={styles.revisionControls}>
                              <button
                                className="button-secondary small-button"
                                disabled={stale || !draftSaved || previewing || revisionSaving}
                                onClick={() => startRevision(finding.id)}
                                type="button"
                              >
                                {editingFindingId === finding.id
                                  ? "Close revision"
                                  : "Prepare draft revision"}
                              </button>
                              {editingFindingId === finding.id ? (
                                <div className={styles.revisionEditor}>
                                  {revisionControl.kind === "align_opinion_settings" ? (
                                    <p>
                                      Preview setting scoring to zero and turning confidence off for
                                      this opinion question.
                                    </p>
                                  ) : (
                                    <label htmlFor={`health-revision-${finding.id}`}>
                                      {revisionControl.label}
                                      <textarea
                                        id={`health-revision-${finding.id}`}
                                        maxLength={revisionControl.maxLength}
                                        value={replacementValue}
                                        disabled={previewing || revisionSaving}
                                        onChange={(event) => {
                                          previewRequest.current += 1;
                                          setReplacementValue(event.target.value);
                                          setPreview(null);
                                          setPreviewAction(null);
                                        }}
                                        rows={3}
                                      />
                                    </label>
                                  )}
                                  <button
                                    className="button-secondary small-button"
                                    disabled={
                                      !revisionAction ||
                                      stale ||
                                      !draftSaved ||
                                      previewing ||
                                      revisionSaving
                                    }
                                    onClick={() => void previewRevision(finding)}
                                    type="button"
                                  >
                                    {previewing ? "Preparing preview…" : "Preview before/after"}
                                  </button>
                                  {thisPreview ? (
                                    <div className={styles.revisionDiff}>
                                      <strong>Before / after · draft only</strong>
                                      <ul>
                                        {thisPreview.changes.map((change) => (
                                          <li key={change.fieldPath}>
                                            <span>{change.fieldPath}</span>
                                            <div className={styles.diffValues}>
                                              <del>
                                                <span className={styles.diffHeading}>Before</span>
                                                {healthChangeValue(change.before)}
                                              </del>
                                              <ins>
                                                <span className={styles.diffHeading}>After</span>
                                                {healthChangeValue(change.after)}
                                              </ins>
                                            </div>
                                          </li>
                                        ))}
                                      </ul>
                                      <button
                                        className="button small-button"
                                        disabled={
                                          stale || !draftSaved || revisionSaving || previewing
                                        }
                                        onClick={() => void applyRevision(finding)}
                                        type="button"
                                      >
                                        {revisionSaving ? "Applying…" : "Apply to saved draft"}
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          {canEdit ? (
                            <div className={styles.dismissControls}>
                              <label htmlFor={`dismiss-reason-${finding.id}`}>Dismiss reason</label>
                              <select
                                id={`dismiss-reason-${finding.id}`}
                                value={selectedReasons[finding.id] ?? ""}
                                disabled={stale || Boolean(savingFindingId)}
                                onChange={(event) => {
                                  const parsed = QuestionHealthDismissalReasonSchema.safeParse(
                                    event.target.value,
                                  );
                                  setSelectedReasons((current) => ({
                                    ...current,
                                    [finding.id]: parsed.success ? parsed.data : "",
                                  }));
                                }}
                              >
                                <option value="">Choose a reason</option>
                                {QuestionHealthDismissalReasonSchema.options.map((reason) => (
                                  <option key={reason} value={reason}>
                                    {dismissalReasonLabels[reason]}
                                  </option>
                                ))}
                              </select>
                              <button
                                className="button-secondary small-button"
                                type="button"
                                disabled={
                                  stale || Boolean(savingFindingId) || !selectedReasons[finding.id]
                                }
                                onClick={() => void dismissFinding(finding)}
                              >
                                {savingFindingId === finding.id ? "Saving…" : "Dismiss finding"}
                              </button>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {featureEnabled && activeFindings.length > 20 ? (
                  <p className={styles.status}>Showing the first 20 active findings.</p>
                ) : null}
                {dismissedFindings.length > 0 ? (
                  <details className={styles.dismissedGroup}>
                    <summary>Dismissed findings ({dismissedFindings.length})</summary>
                    <ul className={styles.findings} aria-label="Dismissed Question Health findings">
                      {dismissedFindings.slice(0, 20).map((finding) => {
                        const dismissal = dismissalByFindingId.get(finding.id);
                        if (!dismissal) return null;
                        return (
                          <li className={styles.dismissedFinding} key={finding.id}>
                            <div>
                              <strong>{ruleLabels[finding.ruleId]}</strong>
                              <p>{finding.reason}</p>
                              <small>{dismissalReasonLabels[dismissal.reason]}</small>
                            </div>
                            {canEdit ? (
                              <button
                                className="button-secondary small-button"
                                type="button"
                                disabled={stale || Boolean(savingFindingId)}
                                onClick={() => void reopenFinding(dismissal)}
                              >
                                {savingFindingId === finding.id ? "Saving…" : "Reopen finding"}
                              </button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                    {dismissedFindings.length > 20 ? (
                      <p className={styles.status}>Showing the first 20 dismissed findings.</p>
                    ) : null}
                  </details>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
    </details>
  );
}

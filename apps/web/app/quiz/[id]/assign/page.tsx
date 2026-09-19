"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { QuizDraft } from "@openround/contracts";
import styles from "../../../../components/practice/practice.module.css";
import { recordPracticeAssignmentShared } from "../../../../components/workspace/product-events";
import {
  WorkspaceProvider,
  useWorkspace,
} from "../../../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../../../components/workspace/workspace-shell";
import { apiFetch, humanError } from "../../../../lib/api";
import {
  defaultPracticeWindow,
  localDateTimeValue,
  parsePersonalLabels,
  personalLabelsError,
  practiceLinksCsv,
  type CreatedPractice,
  type PracticeTimeMode,
} from "../../../../lib/practice-assignment";

interface QuizRecord {
  id: string;
  status: "draft" | "published" | "archived";
  title: string;
  draft: QuizDraft;
  currentVersionId: string | null;
}

interface PublishedVersion {
  id: string;
  version: number;
  content: QuizDraft;
  publishedAt: string;
}

function AssignPracticeContent() {
  const { id } = useParams<{ id: string }>();
  const { entitlements, productFeatures, canEdit, startUpgrade } = useWorkspace();
  const [quiz, setQuiz] = useState<QuizRecord | null>(null);
  const [currentVersion, setCurrentVersion] = useState<PublishedVersion | null>(null);
  const [title, setTitle] = useState("");
  const [timeMode, setTimeMode] = useState<PracticeTimeMode>("flex");
  const [opensLater, setOpensLater] = useState(false);
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [maxClosesAt, setMaxClosesAt] = useState("");
  const [personalLabelsText, setPersonalLabelsText] = useState("");
  const [created, setCreated] = useState<CreatedPractice | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const windowInitialized = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const receiptHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<{ quiz: QuizRecord; currentVersion: PublishedVersion | null }>(
      `/v1/quizzes/${id}`,
    )
      .then((response) => {
        if (cancelled) return;
        setQuiz(response.quiz);
        setCurrentVersion(response.currentVersion);
        const publishedTitle = response.currentVersion?.content.title ?? response.quiz.title;
        setTitle(`Practice: ${publishedTitle}`.slice(0, 160));
      })
      .catch((caught) => {
        if (!cancelled) setLoadError(humanError(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!entitlements || windowInitialized.current) return;
    const now = new Date();
    const window = defaultPracticeWindow(now, entitlements.reportRetentionDays);
    setClosesAt(window.closesAt);
    setMaxClosesAt(window.maxClosesAt);
    setOpensAt(localDateTimeValue(new Date(now.getTime() + 60 * 60_000)));
    windowInitialized.current = true;
  }, [entitlements]);

  const personalLabels = useMemo(
    () => parsePersonalLabels(personalLabelsText),
    [personalLabelsText],
  );
  const personalLabelLimit = Math.min(250, entitlements?.maxParticipants ?? 250);
  const labelError = personalLabelsError(personalLabels, personalLabelLimit);
  const mainQuestionCount =
    currentVersion?.content.questions.filter((question) => (question.delivery ?? "main") === "main")
      .length ?? 0;
  const hasUnpublishedChanges = Boolean(
    quiz && currentVersion && JSON.stringify(quiz.draft) !== JSON.stringify(currentVersion.content),
  );
  const featureAvailable = productFeatures?.practiceAssignments === true;
  const entitlementAvailable = entitlements?.followups === true;
  const published = quiz?.status === "published" && Boolean(currentVersion);

  async function createPractice(event: FormEvent) {
    event.preventDefault();
    if (!published || !canEdit || !featureAvailable || !entitlementAvailable || labelError) return;
    const opening = opensLater ? new Date(opensAt) : new Date();
    const closing = new Date(closesAt);
    if (Number.isNaN(opening.getTime()) || Number.isNaN(closing.getTime()) || closing <= opening) {
      setError("Choose a close time after the practice opens.");
      window.requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    setBusy(true);
    setError("");
    setCopyStatus("");
    try {
      const response = await apiFetch<CreatedPractice>(`/v1/quizzes/${id}/practice-assignments`, {
        method: "POST",
        body: JSON.stringify({
          sourceQuizVersionId: currentVersion!.id,
          ...(title.trim() ? { title: title.trim() } : {}),
          timeMode,
          ...(opensLater ? { opensAt: opening.toISOString() } : {}),
          closesAt: closing.toISOString(),
          personalLabels,
        }),
      });
      setCreated(response);
      window.requestAnimationFrame(() => receiptHeadingRef.current?.focus());
    } catch (caught) {
      setError(humanError(caught));
      window.requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(url: string, label: string) {
    setError("");
    setCopyStatus("");
    try {
      await navigator.clipboard.writeText(url);
      recordPracticeAssignmentShared();
      setCopyStatus(`${label} copied.`);
    } catch {
      setError("Copy was blocked. Select and copy the link instead.");
    }
  }

  function downloadLinks() {
    if (!created) return;
    setError("");
    const blob = new Blob([practiceLinksCsv(created)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `openround-practice-${created.followup.id}-links.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    recordPracticeAssignmentShared();
    setCopyStatus("Practice links downloaded.");
  }

  return (
    <WorkspaceShell
      actions={
        <Link className="button-quiet" href="/dashboard">
          Back to Rounds
        </Link>
      }
      description="Share a published Round for private, accountless practice."
      eyebrow="Practice"
      requireBeta={false}
      title="Assign practice"
    >
      {loadError || error ? (
        <p className="error" ref={errorRef} role="alert" tabIndex={-1}>
          {loadError || error}
        </p>
      ) : null}
      {loading ? (
        <p className={styles.muted} role="status">
          Loading the published Round…
        </p>
      ) : null}
      {!loading && !loadError && !featureAvailable ? (
        <section className={styles.emptyState}>
          <h2>Practice assignments are not enabled</h2>
          <p>This workspace can keep using live Rounds and report-based Recovery follow-ups.</p>
          <Link className="button" href="/dashboard">
            Return to Rounds
          </Link>
        </section>
      ) : null}
      {!loading && !loadError && featureAvailable && !canEdit ? (
        <section className={styles.emptyState}>
          <h2>Editor access is required</h2>
          <p>Ask a workspace owner or editor to create this practice assignment.</p>
          <Link className="button" href={`/quiz/${id}/preview`}>
            View Round
          </Link>
        </section>
      ) : null}
      {!loading && !loadError && featureAvailable && canEdit && quiz && !published ? (
        <section className={styles.emptyState}>
          <h2>Publish this Round first</h2>
          <p>
            Practice always uses an immutable published version, never unfinished draft changes.
          </p>
          <Link className="button" href={`/quiz/${id}`}>
            Open editor
          </Link>
        </section>
      ) : null}
      {!loading &&
      !loadError &&
      featureAvailable &&
      canEdit &&
      published &&
      !entitlementAvailable ? (
        <section className={styles.emptyState}>
          <h2>Practice assignments require Pro</h2>
          <p>
            Upgrade to share accountless practice links, track completion, and create private
            accommodation passes.
          </p>
          <div className={styles.formActions} style={{ justifyContent: "center" }}>
            <button
              className="button"
              onClick={() => {
                setError("");
                void startUpgrade().catch((caught) => {
                  setError(humanError(caught));
                  window.requestAnimationFrame(() => errorRef.current?.focus());
                });
              }}
              type="button"
            >
              Explore Pro
            </button>
            <Link className="button-quiet" href="/pricing">
              Compare plans
            </Link>
          </div>
        </section>
      ) : null}
      {!loading &&
      !loadError &&
      featureAvailable &&
      canEdit &&
      published &&
      entitlementAvailable &&
      mainQuestionCount === 0 ? (
        <section className={styles.emptyState}>
          <h2>Add an eligible main question</h2>
          <p>
            This published version contains only conditional rechecks. Practice assignments need at
            least one main question.
          </p>
          <Link className="button" href={`/quiz/${id}`}>
            Open editor
          </Link>
        </section>
      ) : null}
      {!loading &&
      !loadError &&
      featureAvailable &&
      canEdit &&
      published &&
      entitlementAvailable &&
      mainQuestionCount > 0 &&
      quiz ? (
        created ? (
          <section className={styles.receipt} aria-labelledby="practice-receipt-heading">
            <div className={styles.receiptHeader}>
              <div>
                <p className="eyebrow">Practice ready</p>
                <h2 id="practice-receipt-heading" ref={receiptHeadingRef} tabIndex={-1}>
                  Save and share these links now
                </h2>
              </div>
              <span className="status-pill">
                {new Date(created.followup.opensAt) > new Date() ? "scheduled" : "open"}
              </span>
            </div>
            <p>
              OpenRound stores only token hashes. These exact links cannot be displayed again after
              you leave this page.
            </p>
            <div className={styles.linkBox}>
              <div className={styles.linkRow}>
                <label className="field" htmlFor="generic-practice-link">
                  <span>Generic anonymous link</span>
                  <input
                    className="input"
                    id="generic-practice-link"
                    readOnly
                    value={created.genericUrl}
                  />
                </label>
                <button
                  className="button-quiet small-button"
                  onClick={() => void copyLink(created.genericUrl, "Generic practice link")}
                  type="button"
                >
                  Copy
                </button>
              </div>
              {created.personalAccess.length ? (
                <>
                  <h3>Personal one-attempt links</h3>
                  <ul className={styles.personalLinks}>
                    {created.personalAccess.map((access, index) => (
                      <li className={styles.linkRow} key={access.id}>
                        <label className="field" htmlFor={`personal-practice-link-${access.id}`}>
                          <span>{access.nickname ?? access.label}</span>
                          <input
                            className="input"
                            id={`personal-practice-link-${access.id}`}
                            readOnly
                            value={access.url ?? ""}
                          />
                        </label>
                        <button
                          className="button-quiet small-button"
                          disabled={!access.url}
                          onClick={() =>
                            access.url &&
                            void copyLink(
                              access.url,
                              access.nickname ?? (access.label || `Personal link ${index + 1}`),
                            )
                          }
                          type="button"
                        >
                          Copy
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
            <p aria-live="polite" className={copyStatus ? "success" : "sr-only"} role="status">
              {copyStatus}
            </p>
            <div className={styles.receiptActions}>
              <button className="button" onClick={downloadLinks} type="button">
                Download links as CSV
              </button>
              <Link className="button-quiet" href={`/practice/${created.followup.id}`}>
                Manage practice
              </Link>
              <Link className="button-quiet" href="/dashboard">
                Done
              </Link>
            </div>
          </section>
        ) : (
          <div className={styles.stack}>
            <section className={styles.sourceCard} aria-labelledby="practice-source-heading">
              <div className={styles.sourceHeader}>
                <div>
                  <p className="eyebrow">Published source</p>
                  <h2 id="practice-source-heading">
                    {currentVersion?.content.title ?? quiz.title}
                  </h2>
                </div>
                <span className="status-pill">Published v{currentVersion?.version}</span>
              </div>
              <div className={styles.sourceFacts}>
                <div className={styles.sourceFact}>
                  <strong>{mainQuestionCount}</strong>
                  <span>main question{mainQuestionCount === 1 ? "" : "s"}</span>
                </div>
                <div className={styles.sourceFact}>
                  <strong>{timeMode === "flex" ? "Flexible" : "Timed"}</strong>
                  <span>participant pacing</span>
                </div>
                <div className={styles.sourceFact}>
                  <strong>One attempt</strong>
                  <span>per personal link</span>
                </div>
              </div>
              <p>
                Practice uses the immutable published version. Conditional live rechecks are not
                repeated as separate practice questions.
              </p>
              {hasUnpublishedChanges ? (
                <p className="notice">
                  This Round has newer draft edits. Publish them first if they should be included.
                </p>
              ) : null}
            </section>

            <form className={styles.formCard} onSubmit={createPractice}>
              <h2>Practice settings</h2>
              <div className={styles.fields}>
                <label className={`field ${styles.fullField}`} htmlFor="practice-title">
                  <span>Title</span>
                  <input
                    className="input"
                    id="practice-title"
                    maxLength={160}
                    onChange={(event) => setTitle(event.target.value)}
                    value={title}
                  />
                </label>
                <fieldset className={styles.fullField} style={{ border: 0, margin: 0, padding: 0 }}>
                  <legend className="field-label">Timing</legend>
                  <div className={styles.optionGrid}>
                    <label className={styles.option}>
                      <input
                        checked={timeMode === "flex"}
                        name="time-mode"
                        onChange={() => setTimeMode("flex")}
                        type="radio"
                      />
                      <span>
                        <strong>Time-flex</strong>
                        No countdown. Recommended when speed is not part of the learning goal.
                      </span>
                    </label>
                    <label className={styles.option}>
                      <input
                        checked={timeMode === "timed"}
                        name="time-mode"
                        onChange={() => setTimeMode("timed")}
                        type="radio"
                      />
                      <span>
                        <strong>Use question timers</strong>
                        Enforce each published question&apos;s timer on the server.
                      </span>
                    </label>
                  </div>
                </fieldset>
                <fieldset className={styles.fullField} style={{ border: 0, margin: 0, padding: 0 }}>
                  <legend className="field-label">Open practice</legend>
                  <div className={styles.optionGrid}>
                    <label className={styles.option}>
                      <input
                        checked={!opensLater}
                        name="open-time"
                        onChange={() => setOpensLater(false)}
                        type="radio"
                      />
                      <span>
                        <strong>Now</strong>
                        The link works as soon as it is created.
                      </span>
                    </label>
                    <label className={styles.option}>
                      <input
                        checked={opensLater}
                        name="open-time"
                        onChange={() => setOpensLater(true)}
                        type="radio"
                      />
                      <span>
                        <strong>Schedule for later</strong>
                        Links stay closed until the selected time.
                      </span>
                    </label>
                  </div>
                </fieldset>
                {opensLater ? (
                  <label className="field" htmlFor="practice-opens-at">
                    <span>Open date and time</span>
                    <input
                      className="input"
                      id="practice-opens-at"
                      max={maxClosesAt || undefined}
                      min={localDateTimeValue(new Date())}
                      onChange={(event) => setOpensAt(event.target.value)}
                      required
                      type="datetime-local"
                      value={opensAt}
                    />
                  </label>
                ) : null}
                <label className="field" htmlFor="practice-closes-at">
                  <span>Close date and time</span>
                  <input
                    className="input"
                    id="practice-closes-at"
                    max={maxClosesAt || undefined}
                    min={opensLater ? opensAt : localDateTimeValue(new Date())}
                    onChange={(event) => setClosesAt(event.target.value)}
                    required
                    type="datetime-local"
                    value={closesAt}
                  />
                </label>
              </div>
              <details className={styles.disclosure}>
                <summary>Create personal one-attempt links (optional)</summary>
                <label className="field" htmlFor="practice-personal-labels">
                  <span>One label per line</span>
                  <textarea
                    aria-describedby="practice-personal-labels-help"
                    aria-invalid={Boolean(labelError)}
                    className="textarea"
                    id="practice-personal-labels"
                    onChange={(event) => setPersonalLabelsText(event.target.value)}
                    placeholder={"Learner 1\nLearner 2"}
                    rows={5}
                    value={personalLabelsText}
                  />
                </label>
                <p className={styles.muted} id="practice-personal-labels-help">
                  Labels identify links for the facilitator only. OpenRound does not email anyone or
                  create learner accounts. Up to {personalLabelLimit} labels are available on this
                  plan. {personalLabels.length} personal link
                  {personalLabels.length === 1 ? "" : "s"} will be created.
                </p>
                {labelError ? (
                  <p className="error" role="alert">
                    {labelError}
                  </p>
                ) : null}
              </details>
              <div className={styles.formActions}>
                <button className="button" disabled={busy || Boolean(labelError)} type="submit">
                  {busy ? "Creating practice…" : "Create assignment"}
                </button>
                <Link className="button-quiet" href="/dashboard">
                  Cancel
                </Link>
              </div>
            </form>
          </div>
        )
      ) : null}
    </WorkspaceShell>
  );
}

export default function AssignPracticePage() {
  return (
    <WorkspaceProvider>
      <AssignPracticeContent />
    </WorkspaceProvider>
  );
}

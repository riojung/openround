"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { QuizDraft } from "@openround/contracts";
import styles from "../../../../components/practice/practice.module.css";
import { useLocale } from "../../../../components/locale-provider";
import { recordPracticeAssignmentShared } from "../../../../components/workspace/product-events";
import {
  WorkspaceProvider,
  useWorkspace,
} from "../../../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../../../components/workspace/workspace-shell";
import { apiFetch, humanError } from "../../../../lib/api";
import { formatNumber } from "../../../../lib/i18n/format";
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
  const { locale, t } = useLocale();
  const tRef = useRef(t);
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
  const [rawError, setRawError] = useState("");
  const windowInitialized = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const receiptHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

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
        setTitle(
          tRef.current("reportRound.assign.defaultTitle", { title: publishedTitle }).slice(0, 160),
        );
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
  const rawLabelError = personalLabelsError(personalLabels, personalLabelLimit);
  const labelError = rawLabelError
    ? personalLabels.length > personalLabelLimit
      ? t("reportRound.assign.tooManyLabels", {
          maximum: formatNumber(locale, personalLabelLimit),
        })
      : t("reportRound.assign.labelTooLong")
    : null;
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
      setError(t("reportRound.assign.closeAfterOpen"));
      setRawError("");
      window.requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    setBusy(true);
    setError("");
    setRawError("");
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
      setRawError(humanError(caught));
      window.requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(url: string, label: string) {
    setError("");
    setRawError("");
    setCopyStatus("");
    try {
      await navigator.clipboard.writeText(url);
      recordPracticeAssignmentShared();
      setCopyStatus(t("reportRound.assign.copied", { label }));
    } catch {
      setError(t("reportRound.assign.copyBlocked"));
    }
  }

  function downloadLinks() {
    if (!created) return;
    setError("");
    setRawError("");
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
    setCopyStatus(t("reportRound.assign.linksDownloaded"));
  }

  return (
    <WorkspaceShell
      actions={
        <Link className="button-quiet" href="/dashboard">
          {t("reportRound.rehearsal.backToRounds")}
        </Link>
      }
      description={t("reportRound.assign.description")}
      eyebrow={t("delivery.practice.title")}
      requireBeta={false}
      title={t("reportRound.assign.title")}
      translationLevel="full"
    >
      {loadError || rawError || error ? (
        <p
          className="error"
          lang={loadError || rawError ? "en-CA" : undefined}
          ref={errorRef}
          role="alert"
          tabIndex={-1}
        >
          {loadError || rawError || error}
        </p>
      ) : null}
      {loading ? (
        <p className={styles.muted} role="status">
          {t("reportRound.assign.loading")}
        </p>
      ) : null}
      {!loading && !loadError && !featureAvailable ? (
        <section className={styles.emptyState}>
          <h2>{t("reportRound.assign.notEnabledTitle")}</h2>
          <p>{t("reportRound.assign.notEnabledDescription")}</p>
          <Link className="button" href="/dashboard">
            {t("reportRound.assign.returnToRounds")}
          </Link>
        </section>
      ) : null}
      {!loading && !loadError && featureAvailable && !canEdit ? (
        <section className={styles.emptyState}>
          <h2>{t("reportRound.assign.editorRequiredTitle")}</h2>
          <p>{t("reportRound.assign.editorRequiredDescription")}</p>
          <Link className="button" href={`/quiz/${id}/preview`}>
            {t("reportRound.assign.viewRound")}
          </Link>
        </section>
      ) : null}
      {!loading && !loadError && featureAvailable && canEdit && quiz && !published ? (
        <section className={styles.emptyState}>
          <h2>{t("reportRound.assign.publishFirstTitle")}</h2>
          <p>{t("reportRound.assign.publishFirstDescription")}</p>
          <Link className="button" href={`/quiz/${id}`}>
            {t("reportRound.assign.openEditor")}
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
          <h2>{t("reportRound.assign.requiresProTitle")}</h2>
          <p>{t("reportRound.assign.requiresProDescription")}</p>
          <div className={styles.formActions} style={{ justifyContent: "center" }}>
            <button
              className="button"
              onClick={() => {
                setError("");
                setRawError("");
                void startUpgrade().catch((caught) => {
                  setRawError(humanError(caught));
                  window.requestAnimationFrame(() => errorRef.current?.focus());
                });
              }}
              type="button"
            >
              {t("workspace.explorePro")}
            </button>
            <Link className="button-quiet" href="/pricing">
              {t("account.subscription.comparePlans")}
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
          <h2>{t("reportRound.assign.addMainTitle")}</h2>
          <p>{t("reportRound.assign.addMainDescription")}</p>
          <Link className="button" href={`/quiz/${id}`}>
            {t("reportRound.assign.openEditor")}
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
                <p className="eyebrow">{t("reportRound.assign.ready")}</p>
                <h2 id="practice-receipt-heading" ref={receiptHeadingRef} tabIndex={-1}>
                  {t("reportRound.assign.saveLinks")}
                </h2>
              </div>
              <span className="status-pill">
                {new Date(created.followup.opensAt) > new Date()
                  ? t("reportRound.status.scheduled")
                  : t("reportRound.status.open")}
              </span>
            </div>
            <p>{t("reportRound.assign.hashNotice")}</p>
            <div className={styles.linkBox}>
              <div className={styles.linkRow}>
                <label className="field" htmlFor="generic-practice-link">
                  <span>{t("reportRound.assign.genericLink")}</span>
                  <input
                    className="input"
                    id="generic-practice-link"
                    readOnly
                    value={created.genericUrl}
                  />
                </label>
                <button
                  className="button-quiet small-button"
                  onClick={() =>
                    void copyLink(created.genericUrl, t("reportRound.assign.genericPracticeLink"))
                  }
                  type="button"
                >
                  {t("reportRound.assign.copy")}
                </button>
              </div>
              {created.personalAccess.length ? (
                <>
                  <h3>{t("reportRound.assign.personalLinks")}</h3>
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
                              access.nickname ??
                                (access.label ||
                                  t("reportRound.assign.personalLinkNumber", {
                                    number: index + 1,
                                  })),
                            )
                          }
                          type="button"
                        >
                          {t("reportRound.assign.copy")}
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
                {t("reportRound.assign.downloadCsv")}
              </button>
              <Link className="button-quiet" href={`/practice/${created.followup.id}`}>
                {t("reportRound.assign.managePractice")}
              </Link>
              <Link className="button-quiet" href="/dashboard">
                {t("reportRound.assign.done")}
              </Link>
            </div>
          </section>
        ) : (
          <div className={styles.stack}>
            <section className={styles.sourceCard} aria-labelledby="practice-source-heading">
              <div className={styles.sourceHeader}>
                <div>
                  <p className="eyebrow">{t("reportRound.assign.publishedSource")}</p>
                  <h2 id="practice-source-heading">
                    {currentVersion?.content.title ?? quiz.title}
                  </h2>
                </div>
                <span className="status-pill">
                  {t("reportRound.assign.publishedVersion", {
                    version: currentVersion?.version ?? "",
                  })}
                </span>
              </div>
              <div className={styles.sourceFacts}>
                <div className={styles.sourceFact}>
                  <strong>{formatNumber(locale, mainQuestionCount)}</strong>
                  <span>
                    {t("reportRound.assign.mainQuestions", {
                      count: formatNumber(locale, mainQuestionCount),
                    })}
                  </span>
                </div>
                <div className={styles.sourceFact}>
                  <strong>
                    {timeMode === "flex"
                      ? t("reportRound.assign.flexible")
                      : t("reportRound.assign.timed")}
                  </strong>
                  <span>{t("reportRound.assign.participantPacing")}</span>
                </div>
                <div className={styles.sourceFact}>
                  <strong>{t("reportRound.assign.oneAttempt")}</strong>
                  <span>{t("reportRound.assign.perPersonalLink")}</span>
                </div>
              </div>
              <p>{t("reportRound.assign.immutableDescription")}</p>
              {hasUnpublishedChanges ? (
                <p className="notice">{t("reportRound.assign.unpublishedNotice")}</p>
              ) : null}
            </section>

            <form className={styles.formCard} onSubmit={createPractice}>
              <h2>{t("reportRound.assign.settings")}</h2>
              <div className={styles.fields}>
                <label className={`field ${styles.fullField}`} htmlFor="practice-title">
                  <span>{t("reportRound.assign.titleField")}</span>
                  <input
                    className="input"
                    id="practice-title"
                    maxLength={160}
                    onChange={(event) => setTitle(event.target.value)}
                    value={title}
                  />
                </label>
                <fieldset className={styles.fullField} style={{ border: 0, margin: 0, padding: 0 }}>
                  <legend className="field-label">{t("reportRound.assign.timing")}</legend>
                  <div className={styles.optionGrid}>
                    <label className={styles.option}>
                      <input
                        checked={timeMode === "flex"}
                        name="time-mode"
                        onChange={() => setTimeMode("flex")}
                        type="radio"
                      />
                      <span>
                        <strong>{t("reportRound.assign.timeFlex")}</strong>
                        {t("reportRound.assign.timeFlexDescription")}
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
                        <strong>{t("reportRound.assign.useTimers")}</strong>
                        {t("reportRound.assign.useTimersDescription")}
                      </span>
                    </label>
                  </div>
                </fieldset>
                <fieldset className={styles.fullField} style={{ border: 0, margin: 0, padding: 0 }}>
                  <legend className="field-label">{t("reportRound.assign.openPractice")}</legend>
                  <div className={styles.optionGrid}>
                    <label className={styles.option}>
                      <input
                        checked={!opensLater}
                        name="open-time"
                        onChange={() => setOpensLater(false)}
                        type="radio"
                      />
                      <span>
                        <strong>{t("reportRound.assign.now")}</strong>
                        {t("reportRound.assign.nowDescription")}
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
                        <strong>{t("reportRound.assign.scheduleLater")}</strong>
                        {t("reportRound.assign.scheduleLaterDescription")}
                      </span>
                    </label>
                  </div>
                </fieldset>
                {opensLater ? (
                  <label className="field" htmlFor="practice-opens-at">
                    <span>{t("reportRound.assign.openDate")}</span>
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
                  <span>{t("reportRound.assign.closeDate")}</span>
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
                <summary>{t("reportRound.assign.createPersonalLinks")}</summary>
                <label className="field" htmlFor="practice-personal-labels">
                  <span>{t("reportRound.assign.oneLabelPerLine")}</span>
                  <textarea
                    aria-describedby="practice-personal-labels-help"
                    aria-invalid={Boolean(labelError)}
                    className="textarea"
                    id="practice-personal-labels"
                    onChange={(event) => setPersonalLabelsText(event.target.value)}
                    placeholder={t("reportRound.assign.labelsPlaceholder")}
                    rows={5}
                    value={personalLabelsText}
                  />
                </label>
                <p className={styles.muted} id="practice-personal-labels-help">
                  {t("reportRound.assign.labelsHelp", {
                    maximum: formatNumber(locale, personalLabelLimit),
                    count: formatNumber(locale, personalLabels.length),
                  })}
                </p>
                {labelError ? (
                  <p className="error" role="alert">
                    {labelError}
                  </p>
                ) : null}
              </details>
              <div className={styles.formActions}>
                <button className="button" disabled={busy || Boolean(labelError)} type="submit">
                  {busy ? t("reportRound.assign.creating") : t("reportRound.assign.create")}
                </button>
                <Link className="button-quiet" href="/dashboard">
                  {t("delivery.common.cancel")}
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

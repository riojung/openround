"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch, humanError } from "../../lib/api";
import { buildHistoryQuery } from "../../lib/history-query";
import { formatCompactDate, formatPercent } from "../../components/workspace/workspace-model";
import { WorkspaceProvider } from "../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../components/workspace/workspace-shell";
import type {
  CursorPage,
  FollowupSummary,
  ReportSummary,
  RoundFilterOption,
} from "../../components/workspace/workspace-types";
import styles from "../../components/workspace/workspace-content.module.css";

type ReportStatusFilter = "all" | ReportSummary["status"];
type FollowupStatusFilter = "all" | FollowupSummary["status"];

function HistoryFilters({
  status,
  statusLabel,
  statusOptions,
  quizId,
  rounds,
  fromDate,
  toDate,
  onStatusChange,
  onQuizChange,
  onFromDateChange,
  onToDateChange,
  onClear,
}: {
  status: string;
  statusLabel: string;
  statusOptions: ReadonlyArray<{ value: string; label: string }>;
  quizId: string;
  rounds: RoundFilterOption[];
  fromDate: string;
  toDate: string;
  onStatusChange: (value: string) => void;
  onQuizChange: (value: string) => void;
  onFromDateChange: (value: string) => void;
  onToDateChange: (value: string) => void;
  onClear: () => void;
}) {
  const hasFilters = status !== "all" || quizId !== "all" || fromDate !== "" || toDate !== "";
  return (
    <section aria-label="History filters" className={styles.filters}>
      <label className="field">
        <span>{statusLabel}</span>
        <select
          className="select"
          onChange={(event) => onStatusChange(event.target.value)}
          value={status}
        >
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Round</span>
        <select
          className="select"
          onChange={(event) => onQuizChange(event.target.value)}
          value={quizId}
        >
          <option value="all">All Rounds</option>
          {rounds.map((round) => (
            <option key={round.id} value={round.id}>
              {round.title}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>From</span>
        <input
          className="input"
          onChange={(event) => onFromDateChange(event.target.value)}
          type="date"
          value={fromDate}
        />
      </label>
      <label className="field">
        <span>To</span>
        <input
          className="input"
          min={fromDate || undefined}
          onChange={(event) => onToDateChange(event.target.value)}
          type="date"
          value={toDate}
        />
      </label>
      <button className="button-quiet" disabled={!hasFilters} onClick={onClear} type="button">
        Clear filters
      </button>
    </section>
  );
}

function followupLifecycleLabel(report: ReportSummary) {
  if (!report.followupId) return "No practice follow-up yet";
  if (!report.followupStatus) return "Practice follow-up created";
  return `Practice follow-up ${report.followupStatus}`;
}

function ReportList({ rounds }: { rounds: RoundFilterOption[] }) {
  const [status, setStatus] = useState<ReportStatusFilter>("all");
  const [quizId, setQuizId] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const queryKey = `${status}\u0000${quizId}\u0000${fromDate}\u0000${toDate}`;
  const activeQueryKey = useRef(queryKey);
  const loadMoreController = useRef<AbortController | null>(null);
  activeQueryKey.current = queryKey;

  const fetchPage = useCallback(
    (cursor?: string, signal?: AbortSignal) =>
      apiFetch<CursorPage<ReportSummary>>(
        `/v1/reports?${buildHistoryQuery({ status, quizId, fromDate, toDate }, cursor)}`,
        { signal },
      ),
    [fromDate, quizId, status, toDate],
  );

  useEffect(() => {
    const controller = new AbortController();
    const requestedQueryKey = queryKey;
    loadMoreController.current?.abort();
    loadMoreController.current = null;
    setLoading(true);
    setLoadingMore(false);
    setReports([]);
    setNextCursor(null);
    setError("");
    void fetchPage(undefined, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || activeQueryKey.current !== requestedQueryKey) return;
        setReports(response.items);
        setNextCursor(response.nextCursor);
      })
      .catch((caught) => {
        if (controller.signal.aborted || activeQueryKey.current !== requestedQueryKey) return;
        setError(humanError(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted && activeQueryKey.current === requestedQueryKey) {
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
      loadMoreController.current?.abort();
    };
  }, [fetchPage, queryKey]);

  async function more() {
    if (!nextCursor) return;
    const requestedQueryKey = queryKey;
    const requestedCursor = nextCursor;
    loadMoreController.current?.abort();
    const controller = new AbortController();
    loadMoreController.current = controller;
    setLoadingMore(true);
    setError("");
    try {
      const response = await fetchPage(requestedCursor, controller.signal);
      if (controller.signal.aborted || activeQueryKey.current !== requestedQueryKey) return;
      setReports((current) => [...current, ...response.items]);
      setNextCursor(response.nextCursor);
    } catch (caught) {
      if (controller.signal.aborted || activeQueryKey.current !== requestedQueryKey) return;
      setError(humanError(caught));
    } finally {
      if (loadMoreController.current === controller) {
        loadMoreController.current = null;
        if (activeQueryKey.current === requestedQueryKey) setLoadingMore(false);
      }
    }
  }

  function clearFilters() {
    setStatus("all");
    setQuizId("all");
    setFromDate("");
    setToDate("");
  }

  return (
    <>
      <HistoryFilters
        fromDate={fromDate}
        onClear={clearFilters}
        onFromDateChange={setFromDate}
        onQuizChange={setQuizId}
        onStatusChange={(value) => setStatus(value as ReportStatusFilter)}
        onToDateChange={setToDate}
        quizId={quizId}
        rounds={rounds}
        status={status}
        statusLabel="Result status"
        statusOptions={[
          { value: "all", label: "All results" },
          { value: "ready", label: "Ready" },
          { value: "pending", label: "Processing" },
          { value: "failed", label: "Needs attention" },
        ]}
        toDate={toDate}
      />
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className={styles.muted} role="status">
          Loading results…
        </p>
      ) : null}
      {!loading && !reports.length && !error ? (
        <div className={styles.emptyState}>
          <h2>No results yet</h2>
          <p>
            {status === "all" && quizId === "all" && !fromDate && !toDate
              ? "Finish a live session and its Recovery Story will appear here."
              : "No results match these filters."}
          </p>
          <Link className="button" href="/dashboard">
            Choose a Round
          </Link>
        </div>
      ) : null}
      <section className={styles.list} aria-label="Results">
        {reports.map((report) => (
          <article className={styles.listCard} key={report.id}>
            <div className={styles.rowTopline}>
              <div>
                <h2>{report.title}</h2>
                <p className={styles.summaryLine}>
                  {formatCompactDate(report.generatedAt ?? report.createdAt)} ·{" "}
                  {report.participantCount} participant{report.participantCount === 1 ? "" : "s"}
                </p>
                <p className={styles.summaryLine}>
                  Evidence expires {formatCompactDate(report.expiresAt)} ·{" "}
                  {followupLifecycleLabel(report)}
                </p>
              </div>
              <span className={styles.status} data-tone={report.status}>
                {report.status}
              </span>
            </div>
            <div className={styles.metricGrid}>
              <div className={styles.metric}>
                <strong>{formatPercent(report.initialAccuracyPercent)}</strong>
                <span>Initial accuracy</span>
              </div>
              <div className={styles.metric}>
                <strong>{formatPercent(report.recovery.percent)}</strong>
                <span>
                  Recovery · {report.recovery.recovered}/{report.recovery.eligible}
                </span>
              </div>
              <div className={styles.metric}>
                <strong>{report.unresolvedConceptCount}</strong>
                <span>Unresolved concepts</span>
              </div>
              <div className={styles.metric}>
                <strong>{report.interventionCount}</strong>
                <span>Interventions</span>
              </div>
            </div>
            <div className={styles.listCardActions}>
              <Link className="button small-button" href={`/report/${report.id}`}>
                {report.status === "ready" ? "Open Recovery Story" : "View status"}
              </Link>
              {report.followupId ? (
                <Link className="button-quiet small-button" href="/results?view=practice">
                  View practice follow-up
                </Link>
              ) : null}
            </div>
          </article>
        ))}
      </section>
      {nextCursor ? (
        <div className={styles.loadMore}>
          <button className="button-quiet" disabled={loadingMore} onClick={() => void more()}>
            {loadingMore ? "Loading…" : "Load more results"}
          </button>
        </div>
      ) : null}
    </>
  );
}

function PracticeList({ rounds }: { rounds: RoundFilterOption[] }) {
  const [status, setStatus] = useState<FollowupStatusFilter>("all");
  const [quizId, setQuizId] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [followups, setFollowups] = useState<FollowupSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const queryKey = `${status}\u0000${quizId}\u0000${fromDate}\u0000${toDate}`;
  const activeQueryKey = useRef(queryKey);
  const loadMoreController = useRef<AbortController | null>(null);
  activeQueryKey.current = queryKey;

  const fetchPage = useCallback(
    (cursor?: string, signal?: AbortSignal) =>
      apiFetch<CursorPage<FollowupSummary>>(
        `/v1/followups?${buildHistoryQuery({ status, quizId, fromDate, toDate }, cursor)}`,
        { signal },
      ),
    [fromDate, quizId, status, toDate],
  );

  useEffect(() => {
    const controller = new AbortController();
    const requestedQueryKey = queryKey;
    loadMoreController.current?.abort();
    loadMoreController.current = null;
    setLoading(true);
    setLoadingMore(false);
    setFollowups([]);
    setNextCursor(null);
    setError("");
    void fetchPage(undefined, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || activeQueryKey.current !== requestedQueryKey) return;
        setFollowups(response.items);
        setNextCursor(response.nextCursor);
      })
      .catch((caught) => {
        if (controller.signal.aborted || activeQueryKey.current !== requestedQueryKey) return;
        setError(humanError(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted && activeQueryKey.current === requestedQueryKey) {
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
      loadMoreController.current?.abort();
    };
  }, [fetchPage, queryKey]);

  async function more() {
    if (!nextCursor) return;
    const requestedQueryKey = queryKey;
    const requestedCursor = nextCursor;
    loadMoreController.current?.abort();
    const controller = new AbortController();
    loadMoreController.current = controller;
    setLoadingMore(true);
    setError("");
    try {
      const response = await fetchPage(requestedCursor, controller.signal);
      if (controller.signal.aborted || activeQueryKey.current !== requestedQueryKey) return;
      setFollowups((current) => [...current, ...response.items]);
      setNextCursor(response.nextCursor);
    } catch (caught) {
      if (controller.signal.aborted || activeQueryKey.current !== requestedQueryKey) return;
      setError(humanError(caught));
    } finally {
      if (loadMoreController.current === controller) {
        loadMoreController.current = null;
        if (activeQueryKey.current === requestedQueryKey) setLoadingMore(false);
      }
    }
  }

  function clearFilters() {
    setStatus("all");
    setQuizId("all");
    setFromDate("");
    setToDate("");
  }

  return (
    <>
      <HistoryFilters
        fromDate={fromDate}
        onClear={clearFilters}
        onFromDateChange={setFromDate}
        onQuizChange={setQuizId}
        onStatusChange={(value) => setStatus(value as FollowupStatusFilter)}
        onToDateChange={setToDate}
        quizId={quizId}
        rounds={rounds}
        status={status}
        statusLabel="Practice status"
        statusOptions={[
          { value: "all", label: "All practice" },
          { value: "scheduled", label: "Scheduled" },
          { value: "open", label: "Open" },
          { value: "closed", label: "Closed" },
          { value: "expired", label: "Expired" },
        ]}
        toDate={toDate}
      />
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className={styles.muted} role="status">
          Loading practice…
        </p>
      ) : null}
      {!loading && !followups.length && !error ? (
        <div className={styles.emptyState}>
          <h2>No practice yet</h2>
          <p>
            {status === "all" && quizId === "all" && !fromDate && !toDate
              ? "Assign a published Round or create a Recovery follow-up from a ready result."
              : "No practice matches these filters."}
          </p>
        </div>
      ) : null}
      <section className={styles.list} aria-label="Practice assignments and follow-ups">
        {followups.map((followup) => (
          <article className={styles.listCard} key={followup.id}>
            <div className={styles.rowTopline}>
              <div>
                <h2>{followup.title}</h2>
                <p className={styles.summaryLine}>
                  Created {formatCompactDate(followup.createdAt)} · {followup.checkpointCount}{" "}
                  question{followup.checkpointCount === 1 ? "" : "s"}
                </p>
                <p className={styles.summaryLine}>
                  Retained until {formatCompactDate(followup.expiresAt)}
                </p>
              </div>
              <div className={styles.conceptList}>
                <span className={styles.subtlePill}>
                  {followup.purpose === "assignment" ? "Assignment" : "Recovery follow-up"}
                </span>
                <span className={styles.status} data-tone={followup.status}>
                  {followup.status}
                </span>
              </div>
            </div>
            <div className={styles.metricGrid}>
              <div className={styles.metric}>
                <strong>{followup.attemptCount}</strong>
                <span>Attempts</span>
              </div>
              <div className={styles.metric}>
                <strong>{followup.completedAttemptCount}</strong>
                <span>Completed</span>
              </div>
              <div className={styles.metric}>
                <strong>{formatCompactDate(followup.opensAt)}</strong>
                <span>Opens</span>
              </div>
              <div className={styles.metric}>
                <strong>{formatCompactDate(followup.closesAt)}</strong>
                <span>Closes</span>
              </div>
            </div>
            {followup.conceptKeys.length ? (
              <div className={styles.conceptList} aria-label="Concepts practised">
                {followup.conceptKeys.map((concept) => (
                  <span className={styles.subtlePill} key={concept}>
                    {concept}
                  </span>
                ))}
              </div>
            ) : null}
            <div className={styles.listCardActions}>
              <Link className="button small-button" href={`/practice/${followup.id}`}>
                Manage practice
              </Link>
              {followup.sourceReportId ? (
                <Link
                  className="button-quiet small-button"
                  href={`/report/${followup.sourceReportId}`}
                >
                  View source result
                </Link>
              ) : null}
            </div>
          </article>
        ))}
      </section>
      {nextCursor ? (
        <div className={styles.loadMore}>
          <button className="button-quiet" disabled={loadingMore} onClick={() => void more()}>
            {loadingMore ? "Loading…" : "Load more practice"}
          </button>
        </div>
      ) : null}
    </>
  );
}

function ResultsContent() {
  const params = useSearchParams();
  const view = params.get("view") === "practice" ? "practice" : "results";
  const [rounds, setRounds] = useState<RoundFilterOption[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<{ quizzes: RoundFilterOption[] }>("/v1/quizzes?archived=true&summary=true", {
      signal: controller.signal,
    })
      .then((response) => {
        if (!controller.signal.aborted) setRounds(response.quizzes);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return (
    <>
      <nav className={styles.tabList} aria-label="Evidence views">
        <Link
          aria-current={view === "results" ? "page" : undefined}
          className={view === "results" ? styles.tabActive : styles.tab}
          href="/results"
        >
          Recovery results
        </Link>
        <Link
          aria-current={view === "practice" ? "page" : undefined}
          className={view === "practice" ? styles.tabActive : styles.tab}
          href="/results?view=practice"
        >
          Practice
        </Link>
      </nav>
      {view === "practice" ? <PracticeList rounds={rounds} /> : <ReportList rounds={rounds} />}
    </>
  );
}

export default function ResultsPage() {
  return (
    <WorkspaceProvider>
      <WorkspaceShell
        description="Review Recovery evidence and track assigned or report-based practice."
        eyebrow="Evidence"
        title="Results"
      >
        <ResultsContent />
      </WorkspaceShell>
    </WorkspaceProvider>
  );
}

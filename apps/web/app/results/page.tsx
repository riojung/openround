"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch, humanError } from "../../lib/api";
import { formatCompactDate, formatPercent } from "../../components/workspace/workspace-model";
import { WorkspaceProvider } from "../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../components/workspace/workspace-shell";
import type {
  CursorPage,
  FollowupSummary,
  ReportSummary,
} from "../../components/workspace/workspace-types";
import styles from "../../components/workspace/workspace-content.module.css";

function followupLifecycleLabel(report: ReportSummary) {
  if (!report.followupId) return "No practice follow-up yet";
  if (!report.followupStatus) return "Practice follow-up created";
  return `Practice follow-up ${report.followupStatus}`;
}

function ReportList() {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (cursor?: string) => {
    const params = new URLSearchParams({ limit: "25" });
    if (cursor) params.set("cursor", cursor);
    const response = await apiFetch<CursorPage<ReportSummary>>(`/v1/reports?${params}`);
    setReports((current) => (cursor ? [...current, ...response.items] : response.items));
    setNextCursor(response.nextCursor);
  }, []);

  useEffect(() => {
    void load()
      .catch((caught) => setError(humanError(caught)))
      .finally(() => setLoading(false));
  }, [load]);

  async function more() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      await load(nextCursor);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading) return <p className={styles.muted}>Loading results…</p>;
  return (
    <>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {!reports.length && !error ? (
        <div className={styles.emptyState}>
          <h2>No results yet</h2>
          <p>Finish a live session and its Recovery Story will appear here.</p>
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

function FollowupList() {
  const [followups, setFollowups] = useState<FollowupSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (cursor?: string) => {
    const params = new URLSearchParams({ limit: "25" });
    if (cursor) params.set("cursor", cursor);
    const response = await apiFetch<CursorPage<FollowupSummary>>(`/v1/followups?${params}`);
    setFollowups((current) => (cursor ? [...current, ...response.items] : response.items));
    setNextCursor(response.nextCursor);
  }, []);

  useEffect(() => {
    void load()
      .catch((caught) => setError(humanError(caught)))
      .finally(() => setLoading(false));
  }, [load]);

  async function more() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      await load(nextCursor);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading) return <p className={styles.muted}>Loading practice follow-ups…</p>;
  return (
    <>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {!followups.length && !error ? (
        <div className={styles.emptyState}>
          <h2>No practice follow-ups yet</h2>
          <p>Create one from a ready Recovery Story to reinforce unresolved concepts.</p>
        </div>
      ) : null}
      <section className={styles.list} aria-label="Practice follow-ups">
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
              <span className={styles.status} data-tone={followup.status}>
                {followup.status}
              </span>
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
              <Link
                className="button-quiet small-button"
                href={`/report/${followup.sourceReportId}`}
              >
                View source result
              </Link>
            </div>
          </article>
        ))}
      </section>
      {nextCursor ? (
        <div className={styles.loadMore}>
          <button className="button-quiet" disabled={loadingMore} onClick={() => void more()}>
            {loadingMore ? "Loading…" : "Load more follow-ups"}
          </button>
        </div>
      ) : null}
    </>
  );
}

function ResultsContent() {
  const params = useSearchParams();
  const view = params.get("view") === "practice" ? "practice" : "results";
  return (
    <>
      <nav className={styles.tabList} aria-label="Result views">
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
          Practice follow-ups
        </Link>
      </nav>
      {view === "practice" ? <FollowupList /> : <ReportList />}
    </>
  );
}

export default function ResultsPage() {
  return (
    <WorkspaceProvider>
      <WorkspaceShell
        description="Find what recovered, what remains unresolved, and the next action for every completed session."
        eyebrow="Evidence"
        title="Results"
      >
        <ResultsContent />
      </WorkspaceShell>
    </WorkspaceProvider>
  );
}

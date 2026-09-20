"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, humanError } from "../../lib/api";
import { formatCompactDate } from "../../components/workspace/workspace-model";
import { WorkspaceProvider, useWorkspace } from "../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../components/workspace/workspace-shell";
import type { CursorPage, SessionSummary } from "../../components/workspace/workspace-types";
import styles from "../../components/workspace/workspace-content.module.css";

type StatusFilter = "all" | SessionSummary["status"];
type ArtifactFilter = "all" | "round" | "presentation";

interface PresentationSessionSummary {
  id: string;
  artifactType: "presentation";
  presentationId: string;
  title: string;
  code: string;
  status: "active" | "finished";
  phase: string;
  currentBlockIndex: number;
  blockCount: number;
  participantCount: number;
  responseCount: number;
  createdAt: string;
}

function SessionsContent() {
  const router = useRouter();
  const { canEdit, productFeatures } = useWorkspace();
  const presentationsEnabled = productFeatures?.presentations === true;
  const [artifactType, setArtifactType] = useState<ArtifactFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [quizId, setQuizId] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [rounds, setRounds] = useState<Array<{ id: string; title: string }>>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [presentationSessions, setPresentationSessions] = useState<PresentationSessionSummary[]>(
    [],
  );
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const queryKey = `${artifactType}\u0000${status}\u0000${quizId}\u0000${fromDate}\u0000${toDate}`;
  const activeQueryKey = useRef(queryKey);
  const loadMoreController = useRef<AbortController | null>(null);
  activeQueryKey.current = queryKey;

  const fetchPage = useCallback(
    (cursor?: string, signal?: AbortSignal) => {
      const params = new URLSearchParams({ limit: "25" });
      if (status !== "all") params.set("status", status);
      if (quizId !== "all") params.set("quizId", quizId);
      if (fromDate) params.set("from", new Date(`${fromDate}T00:00:00`).toISOString());
      if (toDate) params.set("to", new Date(`${toDate}T23:59:59.999`).toISOString());
      if (cursor) params.set("cursor", cursor);
      return apiFetch<CursorPage<SessionSummary>>(`/v1/sessions?${params}`, { signal });
    },
    [fromDate, quizId, status, toDate],
  );

  useEffect(() => {
    void Promise.all([
      apiFetch<{ quizzes: Array<{ id: string; title: string }> }>(
        "/v1/quizzes?archived=true&summary=true",
      ),
      presentationsEnabled
        ? apiFetch<{ sessions: PresentationSessionSummary[] }>("/v1/presentation-sessions")
        : Promise.resolve({ sessions: [] }),
    ])
      .then(([roundResponse, presentationResponse]) => {
        setRounds(roundResponse.quizzes);
        setPresentationSessions(presentationResponse.sessions);
      })
      .catch(() => undefined);
  }, [presentationsEnabled]);

  const visiblePresentationSessions = presentationSessions.filter((session) => {
    if (artifactType === "round") return false;
    if (quizId !== "all") return false;
    if (status !== "all" && status !== session.status) return false;
    const createdAt = new Date(session.createdAt).getTime();
    if (fromDate && createdAt < new Date(`${fromDate}T00:00:00`).getTime()) return false;
    if (toDate && createdAt > new Date(`${toDate}T23:59:59.999`).getTime()) return false;
    return true;
  });

  useEffect(() => {
    const controller = new AbortController();
    const requestedQueryKey = queryKey;
    loadMoreController.current?.abort();
    loadMoreController.current = null;
    setLoading(true);
    setLoadingMore(false);
    setSessions([]);
    setNextCursor(null);
    setError("");
    void fetchPage(undefined, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || activeQueryKey.current !== requestedQueryKey) return;
        setSessions(artifactType === "presentation" ? [] : response.items);
        setNextCursor(artifactType === "presentation" ? null : response.nextCursor);
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
  }, [artifactType, fetchPage, queryKey]);

  async function loadMore() {
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
      setSessions((current) => [...current, ...response.items]);
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

  async function resumeSession(session: SessionSummary) {
    setBusyId(session.id);
    setError("");
    try {
      const response = await apiFetch<{ token: string }>(
        `/v1/sessions/${session.id}/control-pass`,
        { method: "POST", body: "{}" },
      );
      window.sessionStorage.setItem(`openround:host:${session.id}`, response.token);
      router.push(`/host/${session.id}`);
    } catch (caught) {
      setError(humanError(caught));
      setBusyId("");
    }
  }

  return (
    <>
      <div className={styles.filters}>
        {presentationsEnabled ? (
          <label className="field">
            <span>Artifact type</span>
            <select
              className="select"
              onChange={(event) => {
                const next = event.target.value as ArtifactFilter;
                setArtifactType(next);
                if (next === "presentation") setQuizId("all");
              }}
              value={artifactType}
            >
              <option value="all">Rounds and Presentations</option>
              <option value="round">Rounds</option>
              <option value="presentation">Presentations</option>
            </select>
          </label>
        ) : null}
        <label className="field">
          <span>Session status</span>
          <select
            className="select"
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
            value={status}
          >
            <option value="all">All sessions</option>
            <option value="active">Active</option>
            <option value="finished">Finished</option>
            <option value="expired">Access expired</option>
          </select>
        </label>
        <label className="field">
          <span>Round</span>
          <select
            className="select"
            disabled={artifactType === "presentation"}
            onChange={(event) => setQuizId(event.target.value)}
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
            onChange={(event) => setFromDate(event.target.value)}
            type="date"
            value={fromDate}
          />
        </label>
        <label className="field">
          <span>To</span>
          <input
            className="input"
            min={fromDate || undefined}
            onChange={(event) => setToDate(event.target.value)}
            type="date"
            value={toDate}
          />
        </label>
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p className={styles.muted}>Loading sessions…</p> : null}
      {!loading && sessions.length === 0 && visiblePresentationSessions.length === 0 ? (
        <div className={styles.emptyState}>
          <h2>No sessions here yet</h2>
          <p>
            {status === "all"
              ? "Host a published Round or Presentation and its live session will appear here."
              : `There are no ${status} sessions in this workspace.`}
          </p>
          <Link className="button" href="/dashboard">
            Choose a Round
          </Link>
        </div>
      ) : null}
      {visiblePresentationSessions.length ? (
        <section className={styles.list} aria-label="Presentation sessions">
          {visiblePresentationSessions.map((session) => (
            <article className={styles.listCard} key={session.id}>
              <div className={styles.rowTopline}>
                <div>
                  <p className="eyebrow">Presentation</p>
                  <h2>{session.title}</h2>
                  <p className={styles.summaryLine}>
                    Started {formatCompactDate(session.createdAt)} · room {session.code}
                  </p>
                </div>
                <span className={styles.status} data-tone={session.status}>
                  {session.status}
                </span>
              </div>
              <div className={styles.metricGrid}>
                <div className={styles.metric}>
                  <strong>{session.participantCount}</strong>
                  <span>Participants</span>
                </div>
                <div className={styles.metric}>
                  <strong>{session.responseCount}</strong>
                  <span>Current responses</span>
                </div>
                <div className={styles.metric}>
                  <strong>
                    {session.currentBlockIndex < 0
                      ? "Not started"
                      : `${session.currentBlockIndex + 1}/${session.blockCount}`}
                  </strong>
                  <span>Block progress</span>
                </div>
                <div className={styles.metric}>
                  <strong>{session.phase.replaceAll("_", " ")}</strong>
                  <span>Last phase</span>
                </div>
              </div>
              <div className={styles.listCardActions}>
                {session.status === "active" && canEdit ? (
                  <Link
                    className="button small-button"
                    href={`/presentation-session/${session.id}/host`}
                  >
                    Resume Presentation
                  </Link>
                ) : null}
                <Link
                  className="button-quiet small-button"
                  href={`/presentation-session/${session.id}/report`}
                >
                  View report
                </Link>
                <Link
                  className="button-quiet small-button"
                  href={`/presentation/${session.presentationId}`}
                >
                  View Presentation
                </Link>
              </div>
            </article>
          ))}
        </section>
      ) : null}
      {artifactType !== "presentation" ? (
        <section className={styles.list} aria-label="Round session history">
          {sessions.map((session) => (
            <article className={styles.listCard} key={session.id}>
              <div className={styles.rowTopline}>
                <div>
                  <h2>{session.title}</h2>
                  <p className={styles.summaryLine}>
                    Started {formatCompactDate(session.createdAt)} · room {session.code}
                  </p>
                  <p className={styles.summaryLine}>
                    {session.status === "expired" ? "Access expired" : "Access expires"}{" "}
                    {formatCompactDate(session.expiresAt)}
                  </p>
                </div>
                <span className={styles.status} data-tone={session.status}>
                  {session.status === "expired" ? "Access expired" : session.status}
                </span>
              </div>
              <div className={styles.metricGrid}>
                <div className={styles.metric}>
                  <strong>{session.participantCount}</strong>
                  <span>Participants</span>
                </div>
                <div className={styles.metric}>
                  <strong>{session.answerCount}</strong>
                  <span>Answers received</span>
                </div>
                <div className={styles.metric}>
                  <strong>
                    {session.questionPosition === null
                      ? "Not started"
                      : `${session.questionPosition}/${session.questionCount}`}
                  </strong>
                  <span>Question progress</span>
                </div>
                <div className={styles.metric}>
                  <strong>{session.phase.replaceAll("_", " ")}</strong>
                  <span>Last phase</span>
                </div>
              </div>
              <div className={styles.listCardActions}>
                {session.status === "active" && canEdit ? (
                  <button
                    className="button small-button"
                    disabled={Boolean(busyId)}
                    onClick={() => void resumeSession(session)}
                    type="button"
                  >
                    {busyId === session.id ? "Preparing secure resume…" : "Resume session"}
                  </button>
                ) : null}
                {session.reportId ? (
                  <Link className="button-quiet small-button" href={`/report/${session.reportId}`}>
                    View result
                  </Link>
                ) : null}
                <Link
                  className="button-quiet small-button"
                  href={`/quiz/${session.quizId}/preview`}
                >
                  View Round
                </Link>
              </div>
            </article>
          ))}
        </section>
      ) : null}
      {nextCursor ? (
        <div className={styles.loadMore}>
          <button
            className="button-quiet"
            disabled={loadingMore}
            onClick={() => void loadMore()}
            type="button"
          >
            {loadingMore ? "Loading…" : "Load more sessions"}
          </button>
        </div>
      ) : null}
    </>
  );
}

export default function SessionsPage() {
  return (
    <WorkspaceProvider>
      <WorkspaceShell
        description="Return to an active room securely or find the evidence produced by a finished session."
        eyebrow="Live delivery"
        title="Sessions"
      >
        <SessionsContent />
      </WorkspaceShell>
    </WorkspaceProvider>
  );
}

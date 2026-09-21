"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { WorkspaceProvider, useWorkspace } from "../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../components/workspace/workspace-shell";
import { apiFetch, humanError } from "../../lib/api";
import styles from "./activity.module.css";

type ActivityKind = "session" | "assignment" | "result" | "schedule";
type ActivityFilter = "all" | ActivityKind;

interface HomeActivitySummary {
  sessions: Array<{
    id: string;
    artifactType: "round" | "presentation";
    title: string;
    status: string;
    participantCount: number;
    progressLabel: string;
    createdAt: string;
    href: string;
  }>;
  assignments: Array<{
    id: string;
    title: string;
    status: string;
    completedAttemptCount: number;
    attemptCount: number;
    closesAt: string;
    href: string;
  }>;
  resultHighlights: Array<{
    id: string;
    artifactType: "round" | "presentation";
    title: string;
    participantCount: number;
    accuracyPercent: number | null;
    createdAt: string;
    href: string;
  }>;
  groupSchedule: Array<{
    id: string;
    groupName: string;
    artifactTitle: string;
    kind: "live_session" | "round_assignment";
    scheduledFor: string;
    href: string;
  }>;
}

interface ActivityItem {
  id: string;
  kind: ActivityKind;
  title: string;
  eyebrow: string;
  detail: string;
  occurredAt: string;
  href: string;
  active?: boolean;
}

const filters: Array<{ value: ActivityFilter; label: string }> = [
  { value: "all", label: "All activity" },
  { value: "session", label: "Sessions" },
  { value: "assignment", label: "Assignments" },
  { value: "result", label: "Results" },
  { value: "schedule", label: "Scheduled" },
];

function toActivity(summary: HomeActivitySummary): ActivityItem[] {
  const items: ActivityItem[] = [
    ...summary.sessions.map((session) => ({
      id: `session:${session.id}`,
      kind: "session" as const,
      title: session.title,
      eyebrow: `${session.artifactType === "round" ? "Round" : "Presentation"} session`,
      detail: `${session.participantCount} participants · ${session.progressLabel}`,
      occurredAt: session.createdAt,
      href: session.href,
      active: session.status === "active",
    })),
    ...summary.assignments.map((assignment) => ({
      id: `assignment:${assignment.id}`,
      kind: "assignment" as const,
      title: assignment.title,
      eyebrow: `${assignment.status} assignment`,
      detail: `${assignment.completedAttemptCount} of ${assignment.attemptCount} attempts complete`,
      occurredAt: assignment.closesAt,
      href: assignment.href,
      active: assignment.status === "open",
    })),
    ...summary.resultHighlights.map((result) => ({
      id: `result:${result.artifactType}:${result.id}`,
      kind: "result" as const,
      title: result.title,
      eyebrow: `${result.artifactType === "round" ? "Round" : "Presentation"} result`,
      detail: `${result.participantCount} participants · ${result.accuracyPercent === null ? "Not scored" : `${result.accuracyPercent}% accuracy`}`,
      occurredAt: result.createdAt,
      href: result.href,
    })),
    ...summary.groupSchedule.map((item) => ({
      id: `schedule:${item.id}`,
      kind: "schedule" as const,
      title: item.artifactTitle,
      eyebrow: item.kind === "live_session" ? "Scheduled session" : "Scheduled assignment",
      detail: item.groupName,
      occurredAt: item.scheduledFor,
      href: item.href,
    })),
  ];
  return items.sort(
    (left, right) =>
      Number(Boolean(right.active)) - Number(Boolean(left.active)) ||
      new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
  );
}

function ActivityInbox() {
  const { creator } = useWorkspace();
  const [summary, setSummary] = useState<HomeActivitySummary | null>(null);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!creator) return;
    setLoading(true);
    setError("");
    try {
      setSummary(await apiFetch<HomeActivitySummary>("/v1/home/summary"));
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setLoading(false);
    }
  }, [creator]);

  useEffect(() => void refresh(), [refresh]);

  const activity = useMemo(() => {
    const items = summary ? toActivity(summary) : [];
    return filter === "all" ? items : items.filter((item) => item.kind === filter);
  }, [filter, summary]);

  return (
    <WorkspaceShell
      actions={
        <button
          className="button-quiet"
          disabled={loading}
          onClick={() => void refresh()}
          type="button"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      }
      description="Sessions, assignments, evidence, and team plans that need your attention."
      eyebrow="Workspace signal"
      requireBeta={false}
      title="Activity inbox"
    >
      <div className={styles.filters} role="tablist" aria-label="Filter activity">
        {filters.map((option) => (
          <button
            aria-selected={filter === option.value}
            className={filter === option.value ? styles.filterActive : styles.filter}
            key={option.value}
            onClick={() => setFilter(option.value)}
            role="tab"
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>

      {error ? (
        <section className={styles.notice} role="alert">
          <div>
            <strong>Activity could not be refreshed</strong>
            <p>{error}</p>
          </div>
          <button className="button-quiet" onClick={() => void refresh()} type="button">
            Try again
          </button>
        </section>
      ) : null}

      {loading && !summary ? (
        <div className={styles.loading}>Loading workspace activity…</div>
      ) : null}

      {summary && activity.length ? (
        <section className={styles.feed} aria-label="Workspace activity">
          {activity.map((item) => (
            <Link className={styles.item} href={item.href} key={item.id}>
              <span className={styles.kind} data-kind={item.kind} aria-hidden="true">
                {item.kind === "session"
                  ? "▶"
                  : item.kind === "assignment"
                    ? "✓"
                    : item.kind === "result"
                      ? "↗"
                      : "◇"}
              </span>
              <span className={styles.copy}>
                <span className={styles.eyebrow}>
                  {item.active ? <i>Active</i> : null}
                  {item.eyebrow}
                </span>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </span>
              <time dateTime={item.occurredAt}>
                {new Date(item.occurredAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </time>
            </Link>
          ))}
        </section>
      ) : null}

      {summary && !activity.length ? (
        <section className={styles.empty}>
          <span aria-hidden="true">◎</span>
          <h2>Nothing needs attention here</h2>
          <p>New delivery, evidence, and Group schedule activity will appear automatically.</p>
          <Link href="/home">Return Home</Link>
        </section>
      ) : null}
    </WorkspaceShell>
  );
}

export default function ActivityPage() {
  return (
    <WorkspaceProvider>
      <ActivityInbox />
    </WorkspaceProvider>
  );
}

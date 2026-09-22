"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "../../components/locale-provider";
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
  detailIsAuthored?: boolean;
  occurredAt: string;
  href: string;
  active?: boolean;
}

type Translator = ReturnType<typeof useLocale>["t"];

function localizedStatus(status: string, t: Translator) {
  switch (status) {
    case "active":
    case "archived":
    case "closed":
    case "draft":
    case "expired":
    case "finished":
    case "open":
    case "published":
    case "ready":
    case "scheduled":
      return t(`pages.common.status.${status}`);
    default:
      return status;
  }
}

function localizedProgress(label: string, t: Translator) {
  if (label === "Lobby") return t("pages.home.sessions.lobby");
  if (label === "Complete") return t("pages.common.completed");
  const question = /^Question (\d+) of (\d+)$/.exec(label);
  if (question) {
    return t("pages.home.sessions.questionProgress", {
      current: question[1] ?? "",
      total: question[2] ?? "",
    });
  }
  const block = /^Block (\d+) of (\d+)$/.exec(label);
  if (block) {
    return t("pages.home.sessions.blockProgress", {
      current: block[1] ?? "",
      total: block[2] ?? "",
    });
  }
  return label;
}

function toActivity(summary: HomeActivitySummary, t: Translator): ActivityItem[] {
  const items: ActivityItem[] = [
    ...summary.sessions.map((session) => ({
      id: `session:${session.id}`,
      kind: "session" as const,
      title: session.title,
      eyebrow: t(
        session.artifactType === "round"
          ? "pages.activity.roundSession"
          : "pages.activity.presentationSession",
      ),
      detail: `${t("pages.common.participantCount", { count: session.participantCount })} · ${localizedProgress(session.progressLabel, t)}`,
      occurredAt: session.createdAt,
      href: session.href,
      active: session.status === "active",
    })),
    ...summary.assignments.map((assignment) => ({
      id: `assignment:${assignment.id}`,
      kind: "assignment" as const,
      title: assignment.title,
      eyebrow: t("pages.activity.assignment", {
        status: localizedStatus(assignment.status, t),
      }),
      detail: t("pages.home.assignments.attemptsComplete", {
        completed: assignment.completedAttemptCount,
        total: assignment.attemptCount,
      }),
      occurredAt: assignment.closesAt,
      href: assignment.href,
      active: assignment.status === "open",
    })),
    ...summary.resultHighlights.map((result) => ({
      id: `result:${result.artifactType}:${result.id}`,
      kind: "result" as const,
      title: result.title,
      eyebrow: t(
        result.artifactType === "round"
          ? "pages.activity.roundResult"
          : "pages.activity.presentationResult",
      ),
      detail: `${t("pages.common.participantCount", { count: result.participantCount })} · ${
        result.accuracyPercent === null
          ? t("pages.activity.notScored")
          : t("pages.activity.accuracyValue", { value: result.accuracyPercent })
      }`,
      occurredAt: result.createdAt,
      href: result.href,
    })),
    ...summary.groupSchedule.map((item) => ({
      id: `schedule:${item.id}`,
      kind: "schedule" as const,
      title: item.artifactTitle,
      eyebrow: t(
        item.kind === "live_session"
          ? "pages.activity.scheduledSession"
          : "pages.activity.scheduledAssignment",
      ),
      detail: item.groupName,
      detailIsAuthored: true,
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
  const { locale, t } = useLocale();
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
    const items = summary ? toActivity(summary, t) : [];
    return filter === "all" ? items : items.filter((item) => item.kind === filter);
  }, [filter, summary, t]);

  const filters: Array<{ value: ActivityFilter; label: string }> = [
    { value: "all", label: t("pages.activity.filter.all") },
    { value: "session", label: t("pages.common.sessions") },
    { value: "assignment", label: t("pages.common.assignments") },
    { value: "result", label: t("pages.common.results") },
    { value: "schedule", label: t("pages.activity.filter.scheduled") },
  ];

  return (
    <WorkspaceShell
      actions={
        <button
          className="button-quiet"
          disabled={loading}
          onClick={() => void refresh()}
          type="button"
        >
          {loading ? t("pages.common.refreshing") : t("pages.common.refresh")}
        </button>
      }
      description={t("page.activity.description")}
      eyebrow={t("page.activity.eyebrow")}
      requireBeta={false}
      title={t("page.activity.title")}
      translationLevel="full"
    >
      <div className={styles.filters} role="tablist" aria-label={t("pages.activity.filterLabel")}>
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
            <strong>{t("pages.activity.refreshError")}</strong>
            <p lang="en-CA">{error}</p>
          </div>
          <button className="button-quiet" onClick={() => void refresh()} type="button">
            {t("pages.common.tryAgain")}
          </button>
        </section>
      ) : null}

      {loading && !summary ? (
        <div className={styles.loading}>{t("pages.activity.loading")}</div>
      ) : null}

      {summary && activity.length ? (
        <section className={styles.feed} aria-label={t("pages.activity.feedLabel")}>
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
                  {item.active ? <i>{t("pages.common.status.active")}</i> : null}
                  {item.eyebrow}
                </span>
                <strong lang="">{item.title}</strong>
                <small lang={item.detailIsAuthored ? "" : locale}>{item.detail}</small>
              </span>
              <time dateTime={item.occurredAt}>
                {new Date(item.occurredAt).toLocaleString(locale, {
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
          <h2>{t("pages.activity.emptyTitle")}</h2>
          <p>{t("pages.activity.emptyDescription")}</p>
          <Link href="/home">{t("pages.activity.returnHome")}</Link>
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

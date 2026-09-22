"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, humanError } from "../../lib/api";
import { useLocale } from "../../components/locale-provider";
import { WorkspaceProvider, useWorkspace } from "../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../components/workspace/workspace-shell";
import { HomeFirstRunActions } from "./home-first-run-actions";
import { professionalBuilderGuidesAvailable } from "../../lib/help-guide-availability";
import { pluralCategory } from "../../lib/i18n/format";
import styles from "./home.module.css";

type ArtifactType = "round" | "presentation";

interface HomeSummary {
  generatedAt: string;
  recentArtifacts: Array<{
    id: string;
    artifactType: ArtifactType;
    title: string;
    description: string;
    status: "draft" | "published" | "archived";
    itemCount: number;
    updatedAt: string;
    editHref: string;
    actionHref: string;
    actionLabel: string;
  }>;
  sessions: Array<{
    id: string;
    artifactType: ArtifactType;
    artifactId: string;
    title: string;
    status: "active" | "finished" | "expired";
    phase: string;
    code: string;
    participantCount: number;
    progressLabel: string;
    createdAt: string;
    href: string;
  }>;
  assignments: Array<{
    id: string;
    quizId: string;
    title: string;
    status: "scheduled" | "open";
    checkpointCount: number;
    attemptCount: number;
    completedAttemptCount: number;
    opensAt: string;
    closesAt: string;
    href: string;
  }>;
  resultHighlights: Array<{
    id: string;
    artifactType: ArtifactType;
    title: string;
    status: "pending" | "ready" | "failed";
    participantCount: number;
    accuracyPercent: number | null;
    recoveryPercent: number | null;
    createdAt: string;
    href: string;
  }>;
  groupSchedule: Array<{
    id: string;
    groupId: string;
    groupName: string;
    artifactType: ArtifactType;
    artifactId: string;
    artifactTitle: string;
    kind: "live_session" | "round_assignment";
    scheduledFor: string;
    note: string;
    href: string;
  }>;
  totals: {
    artifacts: number;
    activeSessions: number;
    activeAssignments: number;
    upcomingGroupItems: number;
  };
}

type Translator = ReturnType<typeof useLocale>["t"];

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

function HomeWorkspace() {
  const { locale, t } = useLocale();
  const { canEdit, creator, productFeatures } = useWorkspace();
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    [locale],
  );
  const formatDate = useCallback(
    (value: string) => dateFormatter.format(new Date(value)),
    [dateFormatter],
  );

  const loadSummary = useCallback(async () => {
    if (!creator) return;
    setLoading(true);
    setError("");
    try {
      setSummary(await apiFetch<HomeSummary>("/v1/home/summary"));
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setLoading(false);
    }
  }, [creator]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const activeSessions = summary?.sessions.filter((session) => session.status === "active") ?? [];
  const firstName = creator?.email.split("@", 1)[0]?.replace(/[._-]+/g, " ") || "there";
  const createHref = productFeatures?.builderV2 ? "/create" : "/dashboard";
  const artifactLabel = productFeatures?.presentations
    ? t("home.createRoundOrPresentation")
    : t("home.createRound");

  return (
    <WorkspaceShell
      actions={
        canEdit ? (
          <Link className="button" href={createHref} lang={locale}>
            {t("common.create")}
          </Link>
        ) : null
      }
      description={t("home.description")}
      eyebrow={t("home.eyebrow")}
      requireBeta={false}
      title={t("home.title")}
      translationLevel="full"
    >
      <section className={styles.hero} lang={locale}>
        <div>
          <p className={styles.eyebrow}>{t("home.welcome", { name: firstName })}</p>
          <h2>{t("home.headline")}</h2>
          <p>{t("home.introduction")}</p>
          <div className={styles.heroActions}>
            {canEdit ? (
              <Link className={styles.primaryAction} href={createHref}>
                {artifactLabel}
              </Link>
            ) : null}
            <Link className={styles.secondaryAction} href="/library">
              {t("home.openLibrary")}
            </Link>
          </div>
        </div>
        <div aria-label={t("home.snapshotLabel")} className={styles.snapshot}>
          <div>
            <strong>{summary?.totals.artifacts ?? "—"}</strong>
            <span>{t("home.snapshot.artifacts")}</span>
          </div>
          <div>
            <strong>{summary?.totals.activeSessions ?? "—"}</strong>
            <span>{t("home.snapshot.live")}</span>
          </div>
          <div>
            <strong>{summary?.totals.activeAssignments ?? "—"}</strong>
            <span>{t("home.snapshot.assignments")}</span>
          </div>
        </div>
      </section>

      {error ? (
        <section className={styles.errorState} role="alert">
          <div>
            <strong>{t("pages.home.refreshError")}</strong>
            <p lang="en-CA">{error}</p>
          </div>
          <button className="button-quiet" onClick={() => void loadSummary()} type="button">
            {t("pages.common.tryAgain")}
          </button>
        </section>
      ) : null}

      {loading && !summary ? (
        <section aria-label={t("pages.home.loading")} className={styles.loadingGrid}>
          <span />
          <span />
          <span />
        </section>
      ) : null}

      {summary && summary.totals.artifacts === 0 ? (
        <section className={styles.onboarding}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>{t("pages.home.onboarding.eyebrow")}</p>
              <h2>{t("pages.home.onboarding.title")}</h2>
              <p>{t("pages.home.onboarding.description")}</p>
            </div>
          </div>
          <ol className={styles.onboardingSteps}>
            <li>
              <span>1</span>
              <div>
                <strong>{t("pages.home.onboarding.createTitle")}</strong>
                <p>
                  {productFeatures?.presentations
                    ? t("pages.home.onboarding.createWithPresentations")
                    : t("pages.home.onboarding.createRound")}
                </p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>{t("pages.home.onboarding.publishTitle")}</strong>
                <p>{t("pages.home.onboarding.publishDescription")}</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>{t("pages.home.onboarding.reviewTitle")}</strong>
                <p>{t("pages.home.onboarding.reviewDescription")}</p>
              </div>
            </li>
          </ol>
          <HomeFirstRunActions
            canEdit={canEdit}
            createHref={createHref}
            guideAvailable={professionalBuilderGuidesAvailable(productFeatures)}
          />
        </section>
      ) : null}

      {summary ? (
        <div className={styles.dashboardGrid}>
          <div className={styles.mainColumn}>
            <section className={styles.section}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>{t("pages.home.authoring.eyebrow")}</p>
                  <h2>{t("pages.home.authoring.title")}</h2>
                  <p>{t("pages.home.authoring.description")}</p>
                </div>
                <Link href="/library">{t("pages.common.viewLibrary")}</Link>
              </div>
              {summary.recentArtifacts.length ? (
                <div className={styles.artifactGrid}>
                  {summary.recentArtifacts.map((artifact) => (
                    <article
                      className={styles.artifactCard}
                      key={`${artifact.artifactType}:${artifact.id}`}
                    >
                      <div className={styles.cardTopline}>
                        <span
                          className={styles.typePill}
                          data-type={artifact.artifactType}
                          lang={locale}
                        >
                          {t(
                            artifact.artifactType === "round"
                              ? "common.round"
                              : "common.presentation",
                          )}
                        </span>
                        <span className={styles.statusPill} data-status={artifact.status}>
                          {t(`pages.common.status.${artifact.status}`)}
                        </span>
                      </div>
                      <h3 lang="">
                        <Link href={artifact.editHref}>{artifact.title}</Link>
                      </h3>
                      <p className={styles.description}>
                        {artifact.description ? (
                          <span lang="">{artifact.description}</span>
                        ) : (
                          t("pages.common.noDescription")
                        )}
                      </p>
                      <p className={styles.metadata}>
                        {t(
                          artifact.artifactType === "round"
                            ? pluralCategory(locale, artifact.itemCount) === "one"
                              ? "pages.home.authoring.questionCount.one"
                              : "pages.home.authoring.questionCount.other"
                            : "pages.home.authoring.blockCount",
                          { count: artifact.itemCount },
                        )}{" "}
                        ·{" "}
                        <time dateTime={artifact.updatedAt} lang={locale}>
                          {t("pages.common.updated", { date: formatDate(artifact.updatedAt) })}
                        </time>
                      </p>
                      <Link className={styles.cardAction} href={artifact.actionHref}>
                        {t(
                          artifact.status === "published"
                            ? artifact.artifactType === "round"
                              ? "pages.home.authoring.hostRound"
                              : "pages.home.authoring.hostPresentation"
                            : "pages.home.authoring.continueEditing",
                        )}{" "}
                        →
                      </Link>
                    </article>
                  ))}
                </div>
              ) : (
                <div className={styles.compactEmpty}>
                  <p>
                    {productFeatures?.presentations
                      ? t("pages.home.authoring.emptyArtifacts")
                      : t("pages.home.authoring.emptyRounds")}
                  </p>
                  {canEdit ? (
                    <Link href={createHref}>{t("pages.home.authoring.chooseMethod")}</Link>
                  ) : null}
                </div>
              )}
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>{t("pages.home.results.eyebrow")}</p>
                  <h2>{t("pages.home.results.title")}</h2>
                  <p>{t("pages.home.results.description")}</p>
                </div>
                <Link href="/results">{t("pages.common.viewResults")}</Link>
              </div>
              {summary.resultHighlights.length ? (
                <div className={styles.resultList}>
                  {summary.resultHighlights.map((result) => (
                    <Link
                      className={styles.resultRow}
                      href={result.href}
                      key={`${result.artifactType}:${result.id}`}
                    >
                      <div>
                        <span
                          className={styles.typePill}
                          data-type={result.artifactType}
                          lang={locale}
                        >
                          {t(
                            result.artifactType === "round"
                              ? "common.round"
                              : "common.presentation",
                          )}
                        </span>
                        <h3 lang="">{result.title}</h3>
                        <p>
                          <time dateTime={result.createdAt} lang={locale}>
                            {formatDate(result.createdAt)}
                          </time>{" "}
                          ·{" "}
                          {t("pages.common.participantCount", {
                            count: result.participantCount,
                          })}
                        </p>
                      </div>
                      <div className={styles.resultMetrics}>
                        <span>
                          <strong>
                            {result.accuracyPercent === null ? "—" : `${result.accuracyPercent}%`}
                          </strong>
                          {t(
                            result.artifactType === "round"
                              ? "pages.common.initialAccuracy"
                              : "pages.common.accuracy",
                          )}
                        </span>
                        <span>
                          <strong>
                            {result.recoveryPercent === null ? "—" : `${result.recoveryPercent}%`}
                          </strong>
                          {t("pages.common.recovery")}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className={styles.compactEmpty}>
                  <p>{t("pages.home.results.empty")}</p>
                  <Link href="/sessions">{t("pages.common.openSessions")}</Link>
                </div>
              )}
            </section>
          </div>

          <aside className={styles.sideColumn} aria-label={t("pages.home.currentActivity")}>
            <section className={styles.sidePanel}>
              <div className={styles.sideHeading}>
                <div>
                  <p className={styles.eyebrow}>{t("pages.home.sessions.eyebrow")}</p>
                  <h2>{t("pages.common.sessions")}</h2>
                </div>
                <Link href="/sessions">{t("pages.common.all")}</Link>
              </div>
              {summary.sessions.length ? (
                <div className={styles.activityList}>
                  {summary.sessions.slice(0, 4).map((session) => (
                    <Link
                      className={styles.activityItem}
                      href={session.href}
                      key={`${session.artifactType}:${session.id}`}
                    >
                      <div className={styles.activityTopline}>
                        <span
                          className={styles.liveDot}
                          data-active={session.status === "active"}
                        />
                        <span>
                          {session.status === "active" ? (
                            t("pages.common.liveNow")
                          ) : (
                            <time dateTime={session.createdAt} lang={locale}>
                              {formatDate(session.createdAt)}
                            </time>
                          )}
                        </span>
                        <span lang={locale}>
                          {t(
                            session.artifactType === "round"
                              ? "common.round"
                              : "common.presentation",
                          )}
                        </span>
                      </div>
                      <strong lang="">{session.title}</strong>
                      <small>
                        {t("pages.common.participantCount", {
                          count: session.participantCount,
                        })}{" "}
                        · {localizedProgress(session.progressLabel, t)}
                      </small>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className={styles.compactEmpty}>
                  <p>{t("pages.home.sessions.empty")}</p>
                  <Link href="/library">{t("pages.home.sessions.chooseArtifact")}</Link>
                </div>
              )}
              {activeSessions.length ? (
                <p className={styles.notice}>
                  {t("pages.home.sessions.activeCount", { count: activeSessions.length })}
                </p>
              ) : null}
            </section>

            <section className={styles.sidePanel}>
              <div className={styles.sideHeading}>
                <div>
                  <p className={styles.eyebrow}>{t("pages.home.assignments.eyebrow")}</p>
                  <h2>{t("pages.common.assignments")}</h2>
                </div>
                <Link href="/assignments">{t("pages.common.all")}</Link>
              </div>
              {summary.assignments.length ? (
                <div className={styles.activityList}>
                  {summary.assignments.slice(0, 3).map((assignment) => (
                    <Link
                      className={styles.activityItem}
                      href={assignment.href}
                      key={assignment.id}
                    >
                      <div className={styles.activityTopline}>
                        <span className={styles.statusPill} data-status={assignment.status}>
                          {t(`pages.common.status.${assignment.status}`)}
                        </span>
                        <time dateTime={assignment.closesAt} lang={locale}>
                          {t("pages.common.closes", { date: formatDate(assignment.closesAt) })}
                        </time>
                      </div>
                      <strong lang="">{assignment.title}</strong>
                      <small>
                        {t("pages.home.assignments.attemptsComplete", {
                          completed: assignment.completedAttemptCount,
                          total: assignment.attemptCount,
                        })}
                      </small>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className={styles.compactEmpty}>
                  <p>{t("pages.home.assignments.empty")}</p>
                  <Link href="/library">{t("pages.home.assignments.assignRound")}</Link>
                </div>
              )}
            </section>

            {productFeatures?.groups ? (
              <section className={styles.sidePanel}>
                <div className={styles.sideHeading}>
                  <div>
                    <p className={styles.eyebrow}>{t("pages.common.groups")}</p>
                    <h2>{t("pages.common.upcoming")}</h2>
                  </div>
                  <Link href="/groups">{t("pages.common.all")}</Link>
                </div>
                {summary.groupSchedule.length ? (
                  <div className={styles.activityList}>
                    {summary.groupSchedule.map((item) => (
                      <Link className={styles.scheduleItem} href={item.href} key={item.id}>
                        <time dateTime={item.scheduledFor} lang={locale}>
                          <strong>
                            {new Date(item.scheduledFor).toLocaleDateString(locale, {
                              day: "numeric",
                            })}
                          </strong>
                          <span>
                            {new Date(item.scheduledFor).toLocaleDateString(locale, {
                              month: "short",
                            })}
                          </span>
                        </time>
                        <div>
                          <strong lang="">{item.artifactTitle}</strong>
                          <small>
                            <span lang="">{item.groupName}</span> ·{" "}
                            {t(
                              item.kind === "live_session"
                                ? "pages.common.liveSession"
                                : "pages.common.roundAssignment",
                            )}
                          </small>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className={styles.compactEmpty}>
                    <p>{t("pages.home.groups.empty")}</p>
                    <Link href="/groups">{t("pages.common.openGroups")}</Link>
                  </div>
                )}
              </section>
            ) : null}
          </aside>
        </div>
      ) : null}
    </WorkspaceShell>
  );
}

export default function HomePage() {
  return (
    <WorkspaceProvider>
      <HomeWorkspace />
    </WorkspaceProvider>
  );
}

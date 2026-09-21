"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, humanError } from "../../lib/api";
import { WorkspaceProvider, useWorkspace } from "../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../components/workspace/workspace-shell";
import { HomeFirstRunActions } from "./home-first-run-actions";
import { professionalBuilderGuidesAvailable } from "../../lib/help-guide-availability";
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

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}

function typeLabel(type: ArtifactType) {
  return type === "round" ? "Round" : "Presentation";
}

function HomeWorkspace() {
  const { canEdit, creator, productFeatures } = useWorkspace();
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
  const artifactLabel = productFeatures?.presentations ? "Round or Presentation" : "Round";

  return (
    <WorkspaceShell
      actions={
        canEdit ? (
          <Link className="button" href={createHref}>
            Create
          </Link>
        ) : null
      }
      description="Your current work, delivery, and evidence in one workspace view."
      eyebrow="Overview"
      requireBeta={false}
      title="Home"
    >
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Welcome back, {firstName}</p>
          <h2>Make the next learning decision visible.</h2>
          <p>
            Continue authoring, return to a live room, or review what changed after an intervention.
          </p>
          <div className={styles.heroActions}>
            {canEdit ? (
              <Link className={styles.primaryAction} href={createHref}>
                Create a {artifactLabel}
              </Link>
            ) : null}
            <Link className={styles.secondaryAction} href="/library">
              Open Library
            </Link>
          </div>
        </div>
        <div aria-label="Workspace snapshot" className={styles.snapshot}>
          <div>
            <strong>{summary?.totals.artifacts ?? "—"}</strong>
            <span>Artifacts</span>
          </div>
          <div>
            <strong>{summary?.totals.activeSessions ?? "—"}</strong>
            <span>Live now</span>
          </div>
          <div>
            <strong>{summary?.totals.activeAssignments ?? "—"}</strong>
            <span>Assignments</span>
          </div>
        </div>
      </section>

      {error ? (
        <section className={styles.errorState} role="alert">
          <div>
            <strong>Home could not be refreshed</strong>
            <p>{error}</p>
          </div>
          <button className="button-quiet" onClick={() => void loadSummary()} type="button">
            Try again
          </button>
        </section>
      ) : null}

      {loading && !summary ? (
        <section aria-label="Loading workspace summary" className={styles.loadingGrid}>
          <span />
          <span />
          <span />
        </section>
      ) : null}

      {summary && summary.totals.artifacts === 0 ? (
        <section className={styles.onboarding}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Get oriented</p>
              <h2>From a trusted source to useful evidence</h2>
              <p>Three steps establish a reusable workflow without requiring learner accounts.</p>
            </div>
          </div>
          <ol className={styles.onboardingSteps}>
            <li>
              <span>1</span>
              <div>
                <strong>Create from a source or template</strong>
                <p>
                  {productFeatures?.presentations
                    ? "Start a Round for assessment or a Presentation for mixed instruction."
                    : "Start a Round for assessment, evidence, and linked recovery."}
                </p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Publish and facilitate</strong>
                <p>Participants join without workspace accounts from any connected device.</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Review and recover</strong>
                <p>Use response evidence and linked rechecks to decide what happens next.</p>
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
                  <p className={styles.eyebrow}>Authoring</p>
                  <h2>Recent work</h2>
                  <p>Continue a draft or move a published artifact into delivery.</p>
                </div>
                <Link href="/library">View Library</Link>
              </div>
              {summary.recentArtifacts.length ? (
                <div className={styles.artifactGrid}>
                  {summary.recentArtifacts.map((artifact) => (
                    <article
                      className={styles.artifactCard}
                      key={`${artifact.artifactType}:${artifact.id}`}
                    >
                      <div className={styles.cardTopline}>
                        <span className={styles.typePill} data-type={artifact.artifactType}>
                          {typeLabel(artifact.artifactType)}
                        </span>
                        <span className={styles.statusPill} data-status={artifact.status}>
                          {artifact.status}
                        </span>
                      </div>
                      <h3>
                        <Link href={artifact.editHref}>{artifact.title}</Link>
                      </h3>
                      <p className={styles.description}>
                        {artifact.description || "No description added yet."}
                      </p>
                      <p className={styles.metadata}>
                        {artifact.itemCount}{" "}
                        {artifact.artifactType === "round" ? "questions" : "blocks"} · Updated{" "}
                        {formatDate(artifact.updatedAt)}
                      </p>
                      <Link className={styles.cardAction} href={artifact.actionHref}>
                        {artifact.actionLabel} →
                      </Link>
                    </article>
                  ))}
                </div>
              ) : (
                <div className={styles.compactEmpty}>
                  <p>
                    Your recently edited {productFeatures?.presentations ? "artifacts" : "Rounds"}
                    will appear here.
                  </p>
                  {canEdit ? <Link href={createHref}>Choose a starting method</Link> : null}
                </div>
              )}
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>Evidence</p>
                  <h2>Recent result highlights</h2>
                  <p>Fast signals for deciding where a closer review is useful.</p>
                </div>
                <Link href="/results">View Results</Link>
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
                        <span className={styles.typePill} data-type={result.artifactType}>
                          {typeLabel(result.artifactType)}
                        </span>
                        <h3>{result.title}</h3>
                        <p>
                          {formatDate(result.createdAt)} · {result.participantCount} participants
                        </p>
                      </div>
                      <div className={styles.resultMetrics}>
                        <span>
                          <strong>
                            {result.accuracyPercent === null ? "—" : `${result.accuracyPercent}%`}
                          </strong>
                          {result.artifactType === "round" ? "Initial accuracy" : "Accuracy"}
                        </span>
                        <span>
                          <strong>
                            {result.recoveryPercent === null ? "—" : `${result.recoveryPercent}%`}
                          </strong>
                          Recovery
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className={styles.compactEmpty}>
                  <p>Complete a live session to see response and recovery evidence here.</p>
                  <Link href="/sessions">Open Sessions</Link>
                </div>
              )}
            </section>
          </div>

          <aside className={styles.sideColumn} aria-label="Current activity">
            <section className={styles.sidePanel}>
              <div className={styles.sideHeading}>
                <div>
                  <p className={styles.eyebrow}>Delivery</p>
                  <h2>Sessions</h2>
                </div>
                <Link href="/sessions">All</Link>
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
                          {session.status === "active" ? "Live now" : formatDate(session.createdAt)}
                        </span>
                        <span>{typeLabel(session.artifactType)}</span>
                      </div>
                      <strong>{session.title}</strong>
                      <small>
                        {session.participantCount} participants · {session.progressLabel}
                      </small>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className={styles.compactEmpty}>
                  <p>No hosted sessions yet.</p>
                  <Link href="/library">Choose an artifact</Link>
                </div>
              )}
              {activeSessions.length ? (
                <p className={styles.notice}>
                  {activeSessions.length} session{activeSessions.length === 1 ? " is" : "s are"}{" "}
                  active.
                </p>
              ) : null}
            </section>

            <section className={styles.sidePanel}>
              <div className={styles.sideHeading}>
                <div>
                  <p className={styles.eyebrow}>Self-paced</p>
                  <h2>Assignments</h2>
                </div>
                <Link href="/assignments">All</Link>
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
                          {assignment.status}
                        </span>
                        <span>Closes {formatDate(assignment.closesAt)}</span>
                      </div>
                      <strong>{assignment.title}</strong>
                      <small>
                        {assignment.completedAttemptCount} of {assignment.attemptCount} attempts
                        complete
                      </small>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className={styles.compactEmpty}>
                  <p>No active or upcoming Round assignments.</p>
                  <Link href="/library">Assign a published Round</Link>
                </div>
              )}
            </section>

            {productFeatures?.groups ? (
              <section className={styles.sidePanel}>
                <div className={styles.sideHeading}>
                  <div>
                    <p className={styles.eyebrow}>Groups</p>
                    <h2>Upcoming</h2>
                  </div>
                  <Link href="/groups">All</Link>
                </div>
                {summary.groupSchedule.length ? (
                  <div className={styles.activityList}>
                    {summary.groupSchedule.map((item) => (
                      <Link className={styles.scheduleItem} href={item.href} key={item.id}>
                        <time dateTime={item.scheduledFor}>
                          <strong>
                            {new Date(item.scheduledFor).toLocaleDateString(undefined, {
                              day: "numeric",
                            })}
                          </strong>
                          <span>
                            {new Date(item.scheduledFor).toLocaleDateString(undefined, {
                              month: "short",
                            })}
                          </span>
                        </time>
                        <div>
                          <strong>{item.artifactTitle}</strong>
                          <small>
                            {item.groupName} ·{" "}
                            {item.kind === "live_session" ? "Live session" : "Round assignment"}
                          </small>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className={styles.compactEmpty}>
                    <p>Shared group plans will appear here.</p>
                    <Link href="/groups">Open Groups</Link>
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

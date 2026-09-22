"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch, humanError } from "../../lib/api";
import { formatCompactDate } from "../../components/workspace/workspace-model";
import { WorkspaceProvider, useWorkspace } from "../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../components/workspace/workspace-shell";
import type { CursorPage, FollowupSummary } from "../../components/workspace/workspace-types";
import styles from "../../components/workspace/workspace-content.module.css";

function AssignmentsWorkspace() {
  const { canEdit, productFeatures } = useWorkspace();
  const [assignments, setAssignments] = useState<FollowupSummary[]>([]);
  const [hasMorePractice, setHasMorePractice] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (productFeatures?.practiceAssignments !== true) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void apiFetch<CursorPage<FollowupSummary>>("/v1/followups?purpose=assignment&limit=50", {
      signal: controller.signal,
    })
      .then((page) => {
        if (controller.signal.aborted) return;
        setAssignments(page.items.filter((item) => item.purpose === "assignment"));
        setHasMorePractice(Boolean(page.nextCursor));
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(humanError(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [productFeatures?.practiceAssignments]);

  return (
    <WorkspaceShell
      actions={
        <Link className="button-quiet" href="/results?view=practice">
          View all practice
        </Link>
      }
      description="Manage standalone, account-free practice created from published Rounds."
      eyebrow="Self-paced delivery"
      title="Assignments"
    >
      {productFeatures?.practiceAssignments !== true ? (
        <div className={styles.emptyState}>
          <h2>Assignments are not enabled in this workspace</h2>
          <p>
            Existing Recovery follow-ups remain available in Results. A workspace owner can enable
            standalone practice when the feature is available for this deployment.
          </p>
          <Link className="button-quiet" href="/results?view=practice">
            Open practice history
          </Link>
        </div>
      ) : null}

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className={styles.muted} role="status">
          Loading assignments…
        </p>
      ) : null}

      {productFeatures?.practiceAssignments === true &&
      !loading &&
      !error &&
      !assignments.length ? (
        <div className={styles.emptyState}>
          <h2>No assignments yet</h2>
          <p>
            Publish a Round, then choose <strong>Assign practice</strong> from its primary actions.
          </p>
          {canEdit ? (
            <Link className="button" href="/library">
              Choose a Round
            </Link>
          ) : (
            <Link className="button-quiet" href="/library">
              Browse the library
            </Link>
          )}
        </div>
      ) : null}

      <section className={styles.list} aria-label="Practice assignments">
        {assignments.map((assignment) => (
          <article className={styles.listCard} key={assignment.id}>
            <div className={styles.rowTopline}>
              <div>
                <h2>{assignment.title}</h2>
                <p className={styles.summaryLine}>
                  Created {formatCompactDate(assignment.createdAt)} · {assignment.checkpointCount}{" "}
                  question{assignment.checkpointCount === 1 ? "" : "s"}
                </p>
                <p className={styles.summaryLine}>
                  Open {formatCompactDate(assignment.opensAt)} to{" "}
                  {formatCompactDate(assignment.closesAt)}
                </p>
              </div>
              <span className={styles.status} data-tone={assignment.status}>
                {assignment.status}
              </span>
            </div>
            <div className={styles.metricGrid}>
              <div className={styles.metric}>
                <strong>{assignment.attemptCount}</strong>
                <span>Attempts</span>
              </div>
              <div className={styles.metric}>
                <strong>{assignment.completedAttemptCount}</strong>
                <span>Completed</span>
              </div>
              <div className={styles.metric}>
                <strong>{formatCompactDate(assignment.expiresAt)}</strong>
                <span>Evidence retained until</span>
              </div>
            </div>
            <div className={styles.listCardActions}>
              <Link className="button small-button" href={`/practice/${assignment.id}`}>
                Manage assignment
              </Link>
            </div>
          </article>
        ))}
      </section>

      {hasMorePractice ? (
        <p className={styles.muted}>
          More practice history is available in <Link href="/results?view=practice">Results</Link>.
        </p>
      ) : null}
    </WorkspaceShell>
  );
}

export default function AssignmentsPage() {
  return (
    <WorkspaceProvider>
      <AssignmentsWorkspace />
    </WorkspaceProvider>
  );
}

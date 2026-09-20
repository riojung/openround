import type { RoundReadinessIssue } from "../../lib/round-readiness";
import styles from "./round-builder.module.css";

export function ReadinessSummary({
  issues,
  action,
  entityLabel = "Round",
  onSelectIssue,
}: {
  issues: RoundReadinessIssue[];
  action: "preview" | "publish" | null;
  entityLabel?: string;
  onSelectIssue: (issue: RoundReadinessIssue) => void;
}) {
  const ready = issues.length === 0;
  return (
    <section
      aria-label="Round readiness"
      className={`${styles.readiness} validation-guidance`}
      data-ready={ready}
      role={action && !ready ? "alert" : undefined}
    >
      <div className={styles.readinessHeading}>
        <strong>
          {ready
            ? "Ready to preview and publish"
            : action
              ? `Cannot ${action} this ${entityLabel} yet`
              : "Round readiness"}
        </strong>
        <span>
          {ready
            ? "All required content is complete"
            : `${issues.length} item${issues.length === 1 ? "" : "s"} need attention`}
        </span>
      </div>
      {!ready ? (
        <>
          <span className="sr-only">
            Source: {issues[0]?.source}. How to fix: {issues[0]?.resolution}
          </span>
          <div className={styles.issueList}>
            {issues.map((issue) => (
              <button
                className={styles.issueButton}
                key={issue.id}
                onClick={() => onSelectIssue(issue)}
                title={issue.resolution}
                type="button"
              >
                {issue.source}: {issue.resolution}
              </button>
            ))}
          </div>
          <small>Your in-progress draft is still saved automatically.</small>
        </>
      ) : null}
    </section>
  );
}

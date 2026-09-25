import type {
  QuestionHealthFinding,
  QuestionHealthOutcome,
  QuestionHealthResult,
  QuestionHealthUsefulness,
} from "@openround/rehearsal";
import styles from "./research-prototype-lab.module.css";

export interface QuestionHealthFindingDisposition {
  usefulness: QuestionHealthUsefulness | "pending";
  outcome: QuestionHealthOutcome | "pending";
}

export type QuestionHealthDispositionMap = Record<string, QuestionHealthFindingDisposition>;

export function reviewedQuestionHealthCount(
  result: QuestionHealthResult,
  dispositions: QuestionHealthDispositionMap,
) {
  return result.findings.filter((finding) => {
    const disposition = dispositions[finding.id];
    return Boolean(
      disposition && disposition.usefulness !== "pending" && disposition.outcome !== "pending",
    );
  }).length;
}

function FindingCard({
  disposition,
  finding,
  onChange,
}: {
  disposition: QuestionHealthFindingDisposition;
  finding: QuestionHealthFinding;
  onChange: (next: QuestionHealthFindingDisposition) => void;
}) {
  const controlId = finding.id.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
  return (
    <article className={styles.findingCard} data-testid="question-health-finding">
      <div className={styles.findingHeader}>
        <span className={styles.advisoryBadge}>{finding.severity}</span>
        <code>{finding.ruleId}</code>
        <span>Question {finding.questionIndex + 1}</span>
      </div>
      <h3>{finding.reason}</h3>
      <dl className={styles.findingDetails}>
        <div>
          <dt>Evidence</dt>
          <dd>{finding.evidence}</dd>
        </div>
        <div>
          <dt>Suggested next step</dt>
          <dd>{finding.recommendedAction}</dd>
        </div>
        <div>
          <dt>Field</dt>
          <dd>
            <code>{finding.fieldPath}</code>
          </dd>
        </div>
      </dl>
      <div className={styles.dispositionGrid}>
        <label htmlFor={`${controlId}-usefulness`}>
          <span>Was this finding useful?</span>
          <select
            id={`${controlId}-usefulness`}
            onChange={(event) =>
              onChange({
                ...disposition,
                usefulness: event.target.value as QuestionHealthFindingDisposition["usefulness"],
              })
            }
            value={disposition.usefulness}
          >
            <option value="pending">Not reviewed</option>
            <option value="useful">Useful</option>
            <option value="not_useful">Not useful</option>
          </select>
        </label>
        <label htmlFor={`${controlId}-outcome`}>
          <span>Intended outcome</span>
          <select
            id={`${controlId}-outcome`}
            onChange={(event) =>
              onChange({
                ...disposition,
                outcome: event.target.value as QuestionHealthFindingDisposition["outcome"],
              })
            }
            value={disposition.outcome}
          >
            <option value="pending">Not reviewed</option>
            <option value="retained_revision">Would retain a revision</option>
            <option value="deliberate_dismissal">Would deliberately dismiss</option>
            <option value="no_decision">Neither outcome</option>
          </select>
        </label>
      </div>
    </article>
  );
}

export function QuestionHealthPrototypePanel({
  dispositions,
  onDispositionChange,
  result,
}: {
  dispositions: QuestionHealthDispositionMap;
  onDispositionChange: (findingId: string, next: QuestionHealthFindingDisposition) => void;
  result: QuestionHealthResult;
}) {
  const reviewed = reviewedQuestionHealthCount(result, dispositions);

  return (
    <section aria-labelledby="question-health-title" className={styles.panel}>
      <div className={styles.panelHeading}>
        <div>
          <p className={styles.eyebrow}>Prototype 02</p>
          <h2 id="question-health-title">Question Health</h2>
          <p>
            Review deterministic, versioned quality findings against this Round. Findings are
            advisory: this lab never changes a draft or published version.
          </p>
        </div>
        <dl className={styles.summaryStats}>
          <div>
            <dt>Questions checked</dt>
            <dd>{result.evaluatedQuestionCount}</dd>
          </div>
          <div>
            <dt>Advisory findings</dt>
            <dd>{result.findings.length}</dd>
          </div>
          <div>
            <dt>Fully reviewed</dt>
            <dd>{reviewed}</dd>
          </div>
        </dl>
      </div>

      <div aria-live="polite" className={styles.inlineStatus} role="status">
        Ruleset {result.rulesetVersion} · {reviewed} of {result.findings.length} findings have both
        dispositions.
      </div>

      {result.findings.length === 0 ? (
        <div className={styles.emptyPanel}>
          <h3>No advisory findings from this ruleset</h3>
          <p>
            This is not a quality guarantee. Record the zero-finding result and continue human
            review for accuracy, accessibility, and context.
          </p>
        </div>
      ) : (
        <div className={styles.findingList}>
          {result.findings.map((finding) => (
            <FindingCard
              disposition={
                dispositions[finding.id] ?? { usefulness: "pending", outcome: "pending" }
              }
              finding={finding}
              key={finding.id}
              onChange={(next) => onDispositionChange(finding.id, next)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

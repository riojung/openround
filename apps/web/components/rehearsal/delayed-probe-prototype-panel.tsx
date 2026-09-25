import type { DelayedProbeEvaluation } from "@openround/rehearsal";
import type { QuizDraft } from "@openround/contracts";
import styles from "./research-prototype-lab.module.css";

export type DelayedProbeDecision = "would_issue" | "would_not_issue" | "undecided";
export type DelayedProbeEvidenceKind = "personal_paired" | "generic_cohort" | "not_selected";

export interface DelayedProbePrototypeSelection {
  sourceQuestionId: string;
  candidateQuestionId: string;
  decision: DelayedProbeDecision;
  evidenceKind: DelayedProbeEvidenceKind;
}

export function changeDelayedProbePair(
  selection: DelayedProbePrototypeSelection,
  pair: Pick<DelayedProbePrototypeSelection, "sourceQuestionId" | "candidateQuestionId">,
): DelayedProbePrototypeSelection {
  return {
    ...selection,
    ...pair,
    decision: "undecided",
    evidenceKind: "not_selected",
  };
}

const reasonLabels: Record<DelayedProbeEvaluation["rejectionReasons"][number], string> = {
  missing_prompt: "Both questions need a prompt.",
  prompt_not_meaningfully_different: "The prompts are the same or near-duplicates.",
  missing_source_concepts: "The source question has no concept metadata.",
  missing_candidate_concepts: "The candidate has no concept metadata.",
  no_concept_overlap: "The questions have no normalized concept key in common.",
};

export function DelayedProbePrototypePanel({
  content,
  evaluation,
  onSelectionChange,
  selection,
}: {
  content: QuizDraft;
  evaluation: DelayedProbeEvaluation | null;
  selection: DelayedProbePrototypeSelection;
  onSelectionChange: (next: DelayedProbePrototypeSelection) => void;
}) {
  const questions = content.questions;
  const sourceQuestion = questions.find((question) => question.id === selection.sourceQuestionId);
  const candidateQuestion = questions.find(
    (question) => question.id === selection.candidateQuestionId,
  );

  return (
    <section aria-labelledby="delayed-probe-title" className={styles.panel}>
      <div className={styles.panelHeading}>
        <div>
          <p className={styles.eyebrow}>Prototype 03</p>
          <h2 id="delayed-probe-title">Delayed concept-matched probe</h2>
          <p>
            Preview whether two real questions could support a later concierge check. This screen
            does not create, persist, or distribute an access link.
          </p>
        </div>
        <div className={styles.safetyNote}>
          <strong>Research preview only</strong>
          <span>
            A reviewer must independently confirm prompt difference and concept equivalence before
            any candidate counts as valid evidence.
          </span>
        </div>
      </div>

      {questions.length < 2 ? (
        <div className={styles.emptyPanel}>
          <h3>Two questions are required</h3>
          <p>
            Add a meaningfully different question measuring the same concept before evaluating a
            delayed probe candidate.
          </p>
        </div>
      ) : (
        <div className={styles.probeGrid}>
          <div className={styles.probeControls}>
            <label htmlFor="probe-source-question">
              <span>Source diagnostic</span>
              <select
                id="probe-source-question"
                onChange={(event) => {
                  const sourceQuestionId = event.target.value;
                  const candidateQuestionId =
                    selection.candidateQuestionId === sourceQuestionId
                      ? (questions.find((question) => question.id !== sourceQuestionId)?.id ?? "")
                      : selection.candidateQuestionId;
                  onSelectionChange(
                    changeDelayedProbePair(selection, { sourceQuestionId, candidateQuestionId }),
                  );
                }}
                value={selection.sourceQuestionId}
              >
                {questions.map((question, index) => (
                  <option
                    key={question.id}
                    lang={question.prompt ? "" : "en-CA"}
                    value={question.id}
                  >
                    {index + 1}. {question.prompt || "Untitled question"}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="probe-candidate-question">
              <span>Delayed candidate</span>
              <select
                id="probe-candidate-question"
                onChange={(event) =>
                  onSelectionChange(
                    changeDelayedProbePair(selection, {
                      sourceQuestionId: selection.sourceQuestionId,
                      candidateQuestionId: event.target.value,
                    }),
                  )
                }
                value={selection.candidateQuestionId}
              >
                {questions
                  .filter((question) => question.id !== selection.sourceQuestionId)
                  .map((question) => (
                    <option
                      key={question.id}
                      lang={question.prompt ? "" : "en-CA"}
                      value={question.id}
                    >
                      {questions.indexOf(question) + 1}. {question.prompt || "Untitled question"}
                    </option>
                  ))}
              </select>
            </label>

            <div className={styles.questionPair}>
              <article>
                <span>Source</span>
                <p lang={sourceQuestion?.prompt ? "" : "en-CA"}>
                  {sourceQuestion?.prompt || "No source selected"}
                </p>
              </article>
              <span aria-hidden="true">→</span>
              <article>
                <span>Later probe</span>
                <p lang={candidateQuestion?.prompt ? "" : "en-CA"}>
                  {candidateQuestion?.prompt || "No candidate selected"}
                </p>
              </article>
            </div>
          </div>

          <div
            aria-atomic="true"
            aria-live="polite"
            className={styles.probeEvaluation}
            role="status"
          >
            {evaluation ? (
              <>
                <span className={styles.evaluationBadge} data-accepted={evaluation.accepted}>
                  {evaluation.accepted ? "Passed prototype checks" : "Candidate needs revision"}
                </span>
                <dl className={styles.evaluationFacts}>
                  <div>
                    <dt>Prompt screen</dt>
                    <dd>{evaluation.promptDifference.replaceAll("_", " ")}</dd>
                  </div>
                  <div>
                    <dt>Shared concepts</dt>
                    <dd>{evaluation.overlappingConceptCount}</dd>
                  </div>
                  <div>
                    <dt>Prototype version</dt>
                    <dd>{evaluation.version}</dd>
                  </div>
                </dl>
                {evaluation.overlappingConceptKeys.length ? (
                  <div className={styles.conceptList} aria-label="Overlapping concept keys">
                    {evaluation.overlappingConceptKeys.map((concept) => (
                      <code key={concept} lang="">
                        {concept}
                      </code>
                    ))}
                  </div>
                ) : null}
                {evaluation.rejectionReasons.length ? (
                  <ul className={styles.reasonList}>
                    {evaluation.rejectionReasons.map((reason) => (
                      <li key={reason}>{reasonLabels[reason]}</li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.caveat}>
                    Passing deterministic checks is not independent confirmation of equivalence.
                  </p>
                )}
              </>
            ) : (
              <p>Select two different questions to evaluate the candidate.</p>
            )}
          </div>
        </div>
      )}

      <div className={styles.probeDecision}>
        <label htmlFor="probe-evidence-kind">
          <span>Evidence preview</span>
          <select
            id="probe-evidence-kind"
            onChange={(event) =>
              onSelectionChange({
                ...selection,
                evidenceKind: event.target.value as DelayedProbeEvidenceKind,
              })
            }
            value={selection.evidenceKind}
          >
            <option value="not_selected">Not selected</option>
            <option value="personal_paired">Personal source-linked · paired evidence</option>
            <option value="generic_cohort">Generic link · cohort evidence only</option>
          </select>
        </label>
        <label htmlFor="probe-decision">
          <span>Facilitator intent</span>
          <select
            id="probe-decision"
            onChange={(event) =>
              onSelectionChange({
                ...selection,
                decision: event.target.value as DelayedProbeDecision,
              })
            }
            value={selection.decision}
          >
            <option value="undecided">Undecided</option>
            <option value="would_issue">Would issue concierge check</option>
            <option value="would_not_issue">Would not issue</option>
          </select>
        </label>
        <div aria-live="polite" className={styles.evidencePreview} role="status">
          {selection.evidenceKind === "personal_paired" ? (
            <>
              <strong>Paired evidence preview</strong>
              <span>14 completed of 24 invited · source-linked eligibility: 14</span>
            </>
          ) : selection.evidenceKind === "generic_cohort" ? (
            <>
              <strong>Cohort evidence preview</strong>
              <span>14 completed of 24 invited · no individual pairing claimed</span>
            </>
          ) : (
            <>
              <strong>No evidence kind selected</strong>
              <span>Personal and generic evidence are never merged or compared as paired.</span>
            </>
          )}
          <small>
            Synthetic counts · small sample · equivalence pending · no causal or durable-learning
            claim
          </small>
        </div>
      </div>
    </section>
  );
}

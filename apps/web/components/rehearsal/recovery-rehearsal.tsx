"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { QuizDraft, SessionSnapshot } from "@openround/contracts";
import {
  RECOVERY_REHEARSAL_SCENARIOS,
  createRecoveryRehearsalController,
  getHostPhaseView,
  recoveryRehearsalEligibility,
  type HostPhaseCommand,
  type RecoveryRehearsalController,
  type RecoveryRehearsalEligibility,
  type RecoveryRehearsalScenarioId,
} from "@openround/rehearsal";
import { HostCommandBar, HostStage, RecoveryCompass } from "../host-command-center";
import { RecoveryStorySummary } from "../recovery-story";
import { recordRehearsalProductEvent } from "./product-events";
import { defaultRehearsalContentSource, type RehearsalContentSource } from "./rehearsal-access";
import styles from "./rehearsal.module.css";

export interface RecoveryRehearsalQuiz {
  id: string;
  status: "draft" | "published" | "archived";
  draft: QuizDraft;
  currentVersionId: string | null;
}

export interface RecoveryRehearsalVersion {
  id: string;
  version: number;
  content: QuizDraft;
}

function ChoicePreview({ snapshot }: { snapshot: SessionSnapshot }) {
  if (!snapshot.question || snapshot.question.choices.length === 0) return null;
  return (
    <ol aria-label="Question choices" className={styles.choiceGrid}>
      {snapshot.question.choices.map((choice, index) => (
        <li className={styles.choice} key={choice.id}>
          <span aria-hidden="true" className={styles.choiceLetter}>
            {String.fromCharCode(65 + index)}
          </span>
          <span>{choice.label}</span>
        </li>
      ))}
    </ol>
  );
}

function PatternGraphic({
  correct,
  wrong,
  missing,
}: {
  correct: number;
  wrong: number;
  missing: number;
}) {
  const cells = [
    ...Array.from({ length: correct }, () => "correct" as const),
    ...Array.from({ length: wrong }, () => "wrong" as const),
    ...Array.from({ length: missing }, () => "missing" as const),
  ];
  return (
    <div>
      <div
        aria-label={`${correct} correct, ${wrong} wrong, ${missing} no response`}
        className={styles.dotPlot}
        role="img"
      >
        {cells.map((kind, index) => (
          <span className={styles.responseDot} data-kind={kind} key={`${kind}-${index}`} />
        ))}
      </div>
      <div className={styles.legend}>
        <span>
          <i data-kind="correct" /> Correct · {correct}
        </span>
        <span>
          <i data-kind="wrong" /> Leading wrong · {wrong}
        </span>
        {missing > 0 ? (
          <span>
            <i data-kind="missing" /> No response · {missing}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Debrief({ controller }: { controller: RecoveryRehearsalController }) {
  const { debrief, insight, intervention, participants, recheck, scenario } = controller.plan;
  return (
    <div className={styles.debrief} data-testid="rehearsal-debrief">
      <RecoveryStorySummary
        model={{
          recovered: debrief.recoveredCount,
          denominator: debrief.initialWrongCount,
          recoveryPercent: debrief.recoveryPercent,
          initialAccuracyPercent: insight.correctnessPercent,
          evidenceLabel: debrief.evidenceLabel.toLowerCase(),
          unresolvedCount: debrief.unresolvedCount,
          unresolvedNarrative:
            debrief.unresolvedCount > 0
              ? `${debrief.unresolvedCount} synthetic learner${debrief.unresolvedCount === 1 ? "" : "s"} remained incorrect after the recheck.`
              : "No synthetic learner remained incorrect after the recheck.",
          interventions: [
            {
              id: "synthetic-intervention",
              label: intervention.type.replaceAll("_", " "),
              followedByLinkedRecheck: recheck.mode === "linked",
            },
          ],
          nextActionLabel: debrief.unresolvedCount > 0 ? "Target practice" : "Review evidence",
          nextAction:
            debrief.unresolvedCount > 0
              ? "Use the unresolved synthetic pattern to plan focused practice."
              : "Review the simulated evidence, then rehearse another pattern.",
          highConfidenceWrong: scenario.highConfidenceWrongCount,
          correctButUnsure: 0,
          smallSample: debrief.initialWrongCount < 5,
          evidenceNote: `${debrief.evidenceNote} ${debrief.syntheticDataNote}`,
          synthetic: true,
        }}
      />
      <details className={styles.details}>
        <summary>Review synthetic learner outcomes</summary>
        <div className={styles.tableWrap}>
          <table>
            <caption className={styles.visuallyHidden}>
              Synthetic results for the initial question and {recheck.label.toLowerCase()}
            </caption>
            <thead>
              <tr>
                <th scope="col">Learner</th>
                <th scope="col">Initial</th>
                <th scope="col">Recheck</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((participant) => (
                <tr key={participant.id}>
                  <th scope="row">{participant.label}</th>
                  <td>{participant.initial.replace("_", " ")}</td>
                  <td>
                    {participant.recheck.replace("_", " ")}
                    {participant.recovered ? (
                      <span className={styles.recovered}>Recovered</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function ActiveRehearsal({
  controller,
  onExit,
  startedAtMs,
}: {
  controller: RecoveryRehearsalController;
  onExit: () => void;
  startedAtMs: number;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const completionRecorded = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const view = controller.view(stepIndex);
  const { plan } = controller;
  const { step } = view;
  const phaseView = getHostPhaseView(step.snapshot);
  const displayPhaseView =
    step.id === "debrief" ? { ...phaseView, phaseLabel: "Recovery debrief" } : phaseView;
  const missing = plan.scenario.audienceSize - plan.scenario.responseCount;

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  function moveTo(nextIndex: number) {
    if (controller.view(nextIndex).step.id === "debrief" && !completionRecorded.current) {
      completionRecorded.current = true;
      recordRehearsalProductEvent({
        name: "rehearsal_completed",
        scenario: plan.scenario.id,
        elapsedMs: Date.now() - startedAtMs,
      });
    }
    setStepIndex(nextIndex);
  }

  function continueRehearsal() {
    moveTo(controller.next(stepIndex));
  }

  function applyCommand(command: HostPhaseCommand) {
    moveTo(controller.apply(stepIndex, command));
  }

  return (
    <section
      className={styles.active}
      data-recheck-mode={plan.recheck.mode}
      data-scenario={plan.scenario.id}
      data-stage={step.id}
      data-testid="rehearsal-step"
    >
      <div className={styles.activeHeader}>
        <div>
          <p className={styles.eyebrow}>Recovery rehearsal · {plan.scenario.title}</p>
          <h1 ref={headingRef} tabIndex={-1}>
            {plan.sourceQuestion.prompt}
          </h1>
        </div>
        <button className={styles.textButton} onClick={onExit} type="button">
          Exit practice
        </button>
      </div>

      <nav aria-label="Rehearsal progress" className={styles.progressNav} tabIndex={0}>
        <ol>
          {plan.steps.map((candidate, index) => (
            <li
              aria-current={index === stepIndex ? "step" : undefined}
              data-complete={index < stepIndex}
              key={candidate.id}
            >
              <span>{index + 1}</span>
              <small>{candidate.id.replace("_", " ")}</small>
            </li>
          ))}
        </ol>
      </nav>

      <div className={styles.practiceLayout}>
        <HostStage className={styles.stageCard}>
          <div className={styles.stageMeta}>
            <span>{displayPhaseView.phaseLabel}</span>
            <span>{step.snapshot.answerCount} responses</span>
          </div>
          <p className={styles.eyebrow}>{step.eyebrow}</p>
          <h2>{step.title}</h2>
          <p className={styles.guidance}>{step.guidance}</p>

          {step.id === "question_open" || step.id === "recheck" ? (
            <ChoicePreview snapshot={step.snapshot} />
          ) : null}
          {step.id === "responses" ? (
            <PatternGraphic
              correct={plan.scenario.correctCount}
              missing={missing}
              wrong={plan.scenario.wrongCount}
            />
          ) : null}
          {step.id === "diagnosis" ? (
            <div
              className={styles.insightCard}
              data-insight-code={plan.insight.recommendation.code}
            >
              <span className={styles.insightStrength}>
                {plan.insight.recommendation.strong ? "Strong signal" : "Use judgment"}
              </span>
              <dl>
                <div>
                  <dt>Participation</dt>
                  <dd>{plan.insight.participationPercent}%</dd>
                </div>
                <div>
                  <dt>Correct</dt>
                  <dd>{plan.insight.correctnessPercent ?? "—"}%</dd>
                </div>
                <div>
                  <dt>Very-sure wrong</dt>
                  <dd>{plan.insight.highConfidenceWrongPercent ?? "—"}%</dd>
                </div>
              </dl>
              {plan.scenario.id === "split_room" ? (
                <p className={styles.ruleNote}>
                  This is a 5/5 split pattern. The production rule recommends an example first
                  because 50% correct is below its 60% low-correctness threshold.
                </p>
              ) : null}
            </div>
          ) : null}
          {step.id === "revealed" || step.id === "intervention" ? (
            <div className={styles.coachScript}>
              <span>Facilitator prompt</span>
              <blockquote>“What clue would help us rule out the tempting response?”</blockquote>
              <p>
                Keep the learner anonymous. Address the reasoning pattern, then collect fresh
                evidence.
              </p>
            </div>
          ) : null}
          {step.id === "debrief" ? <Debrief controller={controller} /> : null}

          <div className={styles.stageActions}>
            <button
              className={styles.secondaryButton}
              disabled={!view.canGoBack}
              onClick={() => setStepIndex(controller.previous(stepIndex))}
              type="button"
            >
              Back
            </button>
            {view.canContinue && !step.command ? (
              <button className={styles.primaryButton} onClick={continueRehearsal} type="button">
                {step.continueLabel}
              </button>
            ) : view.complete ? (
              <button className={styles.primaryButton} onClick={onExit} type="button">
                Rehearse another pattern
              </button>
            ) : null}
          </div>
        </HostStage>

        <RecoveryCompass phaseView={displayPhaseView} snapshot={step.snapshot} synthetic>
          <p>Production guidance is a prompt for facilitator judgment, not an automatic verdict.</p>
          <dl className={styles.snapshotStats}>
            <div>
              <dt>Synthetic learners</dt>
              <dd>{step.snapshot.participants.length}</dd>
            </div>
            <div>
              <dt>Round evidence</dt>
              <dd>{plan.recheck.label}</dd>
            </div>
            <div>
              <dt>Saved data</dt>
              <dd>No learner records</dd>
            </div>
          </dl>
          {plan.adaptations.map((adaptation) => (
            <p className={styles.adaptation} key={adaptation}>
              {adaptation}
            </p>
          ))}
        </RecoveryCompass>
      </div>
      {step.command ? (
        <HostCommandBar
          busy={false}
          onCommand={applyCommand}
          phaseView={phaseView}
          primary={step.command}
          secondary={[]}
          synthetic
        />
      ) : null}
      <p aria-live="polite" className={styles.visuallyHidden}>
        Step {view.stepIndex + 1} of {view.stepCount}: {step.title}
      </p>
    </section>
  );
}

export function RecoveryRehearsal({
  canEdit,
  quiz,
  currentVersion,
}: {
  canEdit: boolean;
  quiz: RecoveryRehearsalQuiz;
  currentVersion: RecoveryRehearsalVersion | null;
}) {
  const hasPublishedVersion = Boolean(currentVersion);
  const [source, setSource] = useState<RehearsalContentSource>(
    defaultRehearsalContentSource({ status: quiz.status, hasPublishedVersion }),
  );
  const [scenarioId, setScenarioId] = useState<RecoveryRehearsalScenarioId>("low_participation");
  const [questionId, setQuestionId] = useState("");
  const [activeRun, setActiveRun] = useState<{
    controller: RecoveryRehearsalController;
    startedAtMs: number;
  } | null>(null);
  const [startError, setStartError] = useState("");
  const content: QuizDraft =
    source === "published" && currentVersion ? currentVersion.content : quiz.draft;
  const eligibilityByScenario = useMemo(
    () =>
      Object.fromEntries(
        RECOVERY_REHEARSAL_SCENARIOS.map((scenario) => [
          scenario.id,
          recoveryRehearsalEligibility(content, scenario.id),
        ]),
      ) as Record<RecoveryRehearsalScenarioId, RecoveryRehearsalEligibility>,
    [content],
  );
  const eligibility = eligibilityByScenario[scenarioId];
  const anyScenarioEligible = RECOVERY_REHEARSAL_SCENARIOS.some(
    (scenario) => eligibilityByScenario[scenario.id].eligible,
  );

  useEffect(() => {
    if (eligibility.eligible) return;
    const firstEligible = RECOVERY_REHEARSAL_SCENARIOS.find(
      (scenario) => eligibilityByScenario[scenario.id].eligible,
    );
    if (firstEligible) setScenarioId(firstEligible.id);
  }, [eligibility.eligible, eligibilityByScenario]);

  useEffect(() => {
    const stillEligible = eligibility.questions.some((option) => option.questionId === questionId);
    if (!stillEligible) setQuestionId(eligibility.questions[0]?.questionId ?? "");
    setStartError("");
  }, [eligibility, questionId]);

  if (activeRun) {
    return (
      <ActiveRehearsal
        controller={activeRun.controller}
        onExit={() => setActiveRun(null)}
        startedAtMs={activeRun.startedAtMs}
      />
    );
  }

  const selectedOption = eligibility.questions.find((option) => option.questionId === questionId);

  function start() {
    if (!questionId) return;
    try {
      const nextController = createRecoveryRehearsalController({
        quiz: content,
        scenarioId,
        questionId,
      });
      const startedAtMs = Date.now();
      setActiveRun({ controller: nextController, startedAtMs });
      recordRehearsalProductEvent({ name: "rehearsal_started", scenario: scenarioId });
      setStartError("");
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "The rehearsal could not start.");
    }
  }

  return (
    <section className={styles.setup} data-testid="rehearsal-setup">
      <div className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Recovery rehearsal · private beta</p>
          <h1>Practise the moment after answers arrive.</h1>
          <p className={styles.lede}>
            Run a guided, deterministic recovery loop with ten synthetic learners. See the same
            insight, intervention, and recheck states used in a live Round—without creating a
            session or saving a response.
          </p>
        </div>
        <div className={styles.promiseCard}>
          <span aria-hidden="true">◎</span>
          <strong>Safe by design</strong>
          <p>
            Read-only Round content. In-memory engine. No session, participant, or answer records.
          </p>
        </div>
      </div>

      <div className={styles.setupGrid}>
        <form
          className={styles.setupCard}
          onSubmit={(event) => {
            event.preventDefault();
            start();
          }}
        >
          <div className={styles.sectionHeading}>
            <span>01</span>
            <div>
              <h2>Choose the evidence source</h2>
              <p>
                Published Rounds default to their published version; drafts use the latest editor
                content.
              </p>
            </div>
          </div>
          {hasPublishedVersion ? (
            <fieldset className={styles.segmented}>
              <legend className={styles.visuallyHidden}>Rehearsal version</legend>
              <label data-selected={source === "published"}>
                <input
                  checked={source === "published"}
                  name="source"
                  onChange={() => {
                    setSource("published");
                    setActiveRun(null);
                  }}
                  type="radio"
                />
                Published v{currentVersion?.version}
              </label>
              <label data-selected={source === "draft"}>
                <input
                  checked={source === "draft"}
                  name="source"
                  onChange={() => {
                    setSource("draft");
                    setActiveRun(null);
                  }}
                  type="radio"
                />
                Current draft
              </label>
            </fieldset>
          ) : (
            <div className={styles.sourceSummary}>
              <span>Current draft</span>
              <small>{quiz.status === "draft" ? "Not published yet" : quiz.status}</small>
            </div>
          )}

          {eligibility.eligible ? (
            <label className={styles.field}>
              <span>Question</span>
              <select
                data-testid="rehearsal-question"
                value={questionId}
                onChange={(event) => setQuestionId(event.target.value)}
              >
                {eligibility.questions.map((option) => (
                  <option key={option.questionId} value={option.questionId}>
                    {option.questionIndex + 1}. {option.prompt}
                  </option>
                ))}
              </select>
              <small>
                {selectedOption?.recheckMode === "linked"
                  ? `Uses linked recheck: ${selectedOption.recheckPrompt}`
                  : "No eligible linked recheck—practice will use a clearly labelled revote."}
              </small>
            </label>
          ) : (
            <div className={styles.ineligible} role="status">
              <strong>No eligible question yet</strong>
              <p>{eligibility.reason}</p>
              <ul>
                {eligibility.requirements.map((requirement) => (
                  <li key={requirement}>{requirement}</li>
                ))}
              </ul>
              {!anyScenarioEligible ? (
                canEdit ? (
                  <Link href={`/quiz/${quiz.id}#question-diagnostic-details`}>
                    Open the relevant question controls
                  </Link>
                ) : (
                  <>
                    <p>Ask an owner or editor to add the required diagnostic details.</p>
                    <Link href={`/quiz/${quiz.id}/preview`}>Return to read-only preview</Link>
                  </>
                )
              ) : null}
            </div>
          )}

          <div className={styles.sectionHeading}>
            <span>02</span>
            <div>
              <h2>Pick a pressure-tested pattern</h2>
              <p>Every run is exact and repeatable, so teams can compare facilitation choices.</p>
            </div>
          </div>
          <fieldset className={styles.scenarioList}>
            <legend className={styles.visuallyHidden}>Practice scenario</legend>
            {RECOVERY_REHEARSAL_SCENARIOS.map((scenario) => {
              const scenarioEligibility = eligibilityByScenario[scenario.id];
              return (
                <label
                  data-eligible={scenarioEligibility.eligible}
                  data-selected={scenarioId === scenario.id}
                  data-testid={`rehearsal-scenario-${scenario.id}`}
                  key={scenario.id}
                >
                  <input
                    checked={scenarioId === scenario.id}
                    disabled={!scenarioEligibility.eligible}
                    name="scenario"
                    onChange={() => setScenarioId(scenario.id)}
                    type="radio"
                  />
                  <span className={styles.scenarioCheck} aria-hidden="true" />
                  <span>
                    <strong>{scenario.title}</strong>
                    <small>{scenario.shortLabel}</small>
                    <em>{scenario.description}</em>
                    <small className={styles.scenarioEligibility}>
                      {scenarioEligibility.eligible
                        ? `${scenarioEligibility.questions.length} eligible question${scenarioEligibility.questions.length === 1 ? "" : "s"}`
                        : scenarioEligibility.reason}
                    </small>
                  </span>
                </label>
              );
            })}
          </fieldset>

          {startError ? (
            <p className={styles.error} role="alert">
              {startError}
            </p>
          ) : null}
          <button
            className={styles.startButton}
            data-testid="rehearsal-start"
            disabled={!eligibility.eligible || !questionId || !anyScenarioEligible}
            type="submit"
          >
            Start private rehearsal <span aria-hidden="true">→</span>
          </button>
        </form>

        <aside className={styles.explainer}>
          <p className={styles.eyebrow}>The recovery loop</p>
          <ol>
            <li>
              <span>1</span>
              <div>
                <strong>Notice</strong>
                <p>Read participation, correctness, and confidence together.</p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Intervene</strong>
                <p>Respond to the reasoning pattern without singling anyone out.</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Recheck</strong>
                <p>Prefer a linked question; use a revote when none is available.</p>
              </div>
            </li>
            <li>
              <span>4</span>
              <div>
                <strong>Debrief</strong>
                <p>Separate stronger transfer evidence from same-prompt improvement.</p>
              </div>
            </li>
          </ol>
          <div className={styles.callout}>
            <strong>Designed for every workspace role</strong>
            <p>
              Owners, editors, and viewers can rehearse because this flow cannot publish, host,
              edit, or create learner records.
            </p>
            <p className={styles.telemetryNote}>
              OpenRound records only the selected scenario, start/completion, and a coarse duration
              bucket for product learning—never Round text, responses, or learner identifiers.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}

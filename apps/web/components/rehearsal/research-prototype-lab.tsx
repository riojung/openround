"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { QuizDraft } from "@openround/contracts";
import {
  buildPrototypeEvidenceExport,
  createQuestionHealthFindingEvaluation,
  evaluateDelayedProbeCandidate,
  evaluateQuestionHealth,
  type DelayedProbeEvaluation,
  type PrototypeEvidenceExportV1,
  type PrototypeEvidenceSegment,
  type QuestionHealthFindingEvaluation,
} from "@openround/rehearsal";
import {
  CompanionPrototypePanel,
  INITIAL_COMPANION_PROTOTYPE_OBSERVATION,
  type CompanionPrototypeObservation,
} from "./companion-prototype-panel";
import {
  DelayedProbePrototypePanel,
  type DelayedProbePrototypeSelection,
} from "./delayed-probe-prototype-panel";
import {
  QuestionHealthPrototypePanel,
  type QuestionHealthDispositionMap,
} from "./question-health-prototype-panel";
import { defaultRehearsalContentSource, type RehearsalContentSource } from "./rehearsal-access";
import styles from "./research-prototype-lab.module.css";

export interface ResearchPrototypeQuiz {
  id: string;
  status: "draft" | "published" | "archived";
  draft: QuizDraft;
  currentVersionId: string | null;
}

export interface ResearchPrototypeVersion {
  id: string;
  version: number;
  content: QuizDraft;
}

const PROTOTYPE_TABS = ["companion", "question-health", "delayed-probe"] as const;
export type PrototypeTab = (typeof PROTOTYPE_TABS)[number];

const TAB_LABELS: Record<PrototypeTab, string> = {
  companion: "Companion",
  "question-health": "Question Health",
  "delayed-probe": "Delayed probe",
};

export const PROTOTYPE_EVIDENCE_DOWNLOAD_NAME = "openround-phase0-prototype-evidence.json";

export interface PrototypeTimingState {
  activeTab: PrototypeTab;
  activeSinceMs: number;
  documentVisible: boolean;
  elapsedMs: Record<PrototypeTab, number>;
  frozenMs: Partial<Record<PrototypeTab, number>>;
  participated: Record<PrototypeTab, boolean>;
}

function emptyPrototypeDurations(): Record<PrototypeTab, number> {
  return { companion: 0, "question-health": 0, "delayed-probe": 0 };
}

function emptyPrototypeParticipation(): Record<PrototypeTab, boolean> {
  return { companion: false, "question-health": false, "delayed-probe": false };
}

export function createPrototypeTimingState(
  activeTab: PrototypeTab,
  nowMs: number,
  documentVisible = true,
): PrototypeTimingState {
  return {
    activeTab,
    activeSinceMs: nowMs,
    documentVisible,
    elapsedMs: emptyPrototypeDurations(),
    frozenMs: {},
    participated: { ...emptyPrototypeParticipation(), [activeTab]: true },
  };
}

export function prototypeElapsedMs(state: PrototypeTimingState, tab: PrototypeTab, nowMs: number) {
  const frozen = state.frozenMs[tab];
  if (frozen !== undefined) return frozen;
  return (
    state.elapsedMs[tab] +
    (state.documentVisible && state.activeTab === tab
      ? Math.max(0, nowMs - state.activeSinceMs)
      : 0)
  );
}

export function setPrototypeDocumentVisibility(
  state: PrototypeTimingState,
  documentVisible: boolean,
  nowMs: number,
): PrototypeTimingState {
  if (state.documentVisible === documentVisible) return state;
  if (!documentVisible) {
    return {
      ...state,
      activeSinceMs: nowMs,
      documentVisible: false,
      elapsedMs: {
        ...state.elapsedMs,
        [state.activeTab]: prototypeElapsedMs(state, state.activeTab, nowMs),
      },
    };
  }
  return { ...state, activeSinceMs: nowMs, documentVisible: true };
}

export function switchPrototypeTiming(
  state: PrototypeTimingState,
  nextTab: PrototypeTab,
  nowMs: number,
): PrototypeTimingState {
  if (state.activeTab === nextTab) return state;
  return {
    ...state,
    activeTab: nextTab,
    activeSinceMs: nowMs,
    elapsedMs: {
      ...state.elapsedMs,
      [state.activeTab]: prototypeElapsedMs(state, state.activeTab, nowMs),
    },
    participated: { ...state.participated, [nextTab]: true },
  };
}

export function freezePrototypeTiming(
  state: PrototypeTimingState,
  tab: PrototypeTab,
  nowMs: number,
): PrototypeTimingState {
  const elapsed = prototypeElapsedMs(state, tab, nowMs);
  return {
    ...state,
    ...(state.activeTab === tab ? { activeSinceMs: nowMs } : {}),
    elapsedMs: { ...state.elapsedMs, [tab]: elapsed },
    frozenMs: { ...state.frozenMs, [tab]: elapsed },
  };
}

export function resumePrototypeTiming(
  state: PrototypeTimingState,
  tab: PrototypeTab,
  nowMs: number,
): PrototypeTimingState {
  const frozenMs = { ...state.frozenMs };
  delete frozenMs[tab];
  return {
    ...state,
    ...(state.activeTab === tab ? { activeSinceMs: nowMs } : {}),
    frozenMs,
  };
}

export function resetPrototypeTabTiming(
  state: PrototypeTimingState,
  tab: PrototypeTab,
  nowMs: number,
): PrototypeTimingState {
  const frozenMs = { ...state.frozenMs };
  delete frozenMs[tab];
  return {
    ...state,
    ...(state.activeTab === tab ? { activeSinceMs: nowMs } : {}),
    elapsedMs: { ...state.elapsedMs, [tab]: 0 },
    frozenMs,
    participated: { ...state.participated, [tab]: true },
  };
}

export function nextPrototypeTabIndex(
  currentIndex: number,
  key: string,
  tabCount = PROTOTYPE_TABS.length,
) {
  if (tabCount < 1) return 0;
  if (key === "Home") return 0;
  if (key === "End") return tabCount - 1;
  if (key === "ArrowRight" || key === "ArrowDown") return (currentIndex + 1) % tabCount;
  if (key === "ArrowLeft" || key === "ArrowUp") return (currentIndex - 1 + tabCount) % tabCount;
  return currentIndex;
}

export function serializePrototypeEvidence(evidence: PrototypeEvidenceExportV1) {
  return `${JSON.stringify(evidence, null, 2)}\n`;
}

function prototypeNowMs() {
  return typeof performance === "undefined" ? 0 : performance.now();
}

function prototypeDocumentIsVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

export interface ResearchPrototypeEvidenceInput {
  segment: PrototypeEvidenceSegment;
  participated: Record<PrototypeTab, boolean>;
  durationMs: Record<PrototypeTab, number>;
  companion: CompanionPrototypeObservation;
  questionHealthEvaluatedCount: number;
  questionHealthEvaluations: readonly QuestionHealthFindingEvaluation[];
  delayedProbe: null | {
    evaluation: DelayedProbeEvaluation;
    selection: Pick<DelayedProbePrototypeSelection, "decision" | "evidenceKind">;
  };
}

export function buildResearchPrototypeEvidence(
  input: ResearchPrototypeEvidenceInput,
): PrototypeEvidenceExportV1 {
  return buildPrototypeEvidenceExport({
    segment: input.segment,
    ...(input.participated.companion && input.companion.completion !== "in_progress"
      ? {
          companion: {
            durationMs: input.durationMs.companion,
            completion: input.companion.completion,
            returnToDeckOutcome:
              input.companion.overlayOpenCount === 0
                ? ("not_tested" as const)
                : input.companion.returnedToSidecar
                  ? ("successful" as const)
                  : ("unsuccessful" as const),
            primaryActionCount: input.companion.primaryActionCount,
            overlayOpenCount: input.companion.overlayOpenCount,
          },
        }
      : {}),
    ...(input.participated["question-health"]
      ? {
          questionHealth: {
            durationMs: input.durationMs["question-health"],
            evaluatedQuestionCount: input.questionHealthEvaluatedCount,
            evaluations: input.questionHealthEvaluations,
          },
        }
      : {}),
    ...(input.participated["delayed-probe"] && input.delayedProbe
      ? {
          delayedProbe: {
            durationMs: input.durationMs["delayed-probe"],
            evaluation: input.delayedProbe.evaluation,
            decision: input.delayedProbe.selection.decision,
            evidenceKind: input.delayedProbe.selection.evidenceKind,
          },
        }
      : {}),
  });
}

function initialSegment(content: QuizDraft): PrototypeEvidenceSegment {
  if (content.category === "education") return "education";
  if (content.category === "business" || content.category === "safety_compliance") {
    return "workplace";
  }
  return "unclassified";
}

function initialProbeSelection(content: QuizDraft): DelayedProbePrototypeSelection {
  return {
    sourceQuestionId: content.questions[0]?.id ?? "",
    candidateQuestionId: content.questions[1]?.id ?? "",
    decision: "undecided",
    evidenceKind: "not_selected",
  };
}

export function recordedQuestionHealthEvaluations(
  findings: ReturnType<typeof evaluateQuestionHealth>["findings"],
  dispositions: QuestionHealthDispositionMap,
): QuestionHealthFindingEvaluation[] {
  return findings.map((finding) => {
    const disposition = dispositions[finding.id] ?? {
      usefulness: "pending" as const,
      outcome: "pending" as const,
    };
    return createQuestionHealthFindingEvaluation(
      finding,
      disposition.usefulness,
      disposition.outcome,
    );
  });
}

export function ResearchPrototypeLab({
  currentVersion,
  quiz,
}: {
  currentVersion: ResearchPrototypeVersion | null;
  quiz: ResearchPrototypeQuiz;
}) {
  const hasPublishedVersion = Boolean(currentVersion);
  const [source, setSource] = useState<RehearsalContentSource>(() =>
    defaultRehearsalContentSource({ status: quiz.status, hasPublishedVersion }),
  );
  const content = source === "published" && currentVersion ? currentVersion.content : quiz.draft;
  const [activeTab, setActiveTab] = useState<PrototypeTab>("companion");
  const [segment, setSegment] = useState<PrototypeEvidenceSegment>(() => initialSegment(content));
  const [companionObservation, setCompanionObservation] = useState<CompanionPrototypeObservation>(
    () => ({ ...INITIAL_COMPANION_PROTOTYPE_OBSERVATION }),
  );
  const [questionHealthDispositions, setQuestionHealthDispositions] =
    useState<QuestionHealthDispositionMap>({});
  const [probeSelection, setProbeSelection] = useState<DelayedProbePrototypeSelection>(() =>
    initialProbeSelection(content),
  );
  const [exportStatus, setExportStatus] = useState("");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const timing = useRef<PrototypeTimingState>(
    createPrototypeTimingState("companion", prototypeNowMs(), prototypeDocumentIsVisible()),
  );

  useEffect(() => {
    const setDocumentVisibility = (documentVisible: boolean) => {
      timing.current = setPrototypeDocumentVisibility(
        timing.current,
        documentVisible,
        prototypeNowMs(),
      );
    };
    const handleVisibilityChange = () => setDocumentVisibility(prototypeDocumentIsVisible());
    const handlePageHide = () => setDocumentVisibility(false);
    const handlePageShow = () => setDocumentVisibility(prototypeDocumentIsVisible());

    handleVisibilityChange();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  const questionHealth = useMemo(() => evaluateQuestionHealth(content), [content]);
  const sourceQuestion = content.questions.find(
    (question) => question.id === probeSelection.sourceQuestionId,
  );
  const candidateQuestion = content.questions.find(
    (question) => question.id === probeSelection.candidateQuestionId,
  );
  const delayedProbeEvaluation = useMemo(
    () =>
      sourceQuestion && candidateQuestion && sourceQuestion.id !== candidateQuestion.id
        ? evaluateDelayedProbeCandidate({ source: sourceQuestion, candidate: candidateQuestion })
        : null,
    [candidateQuestion, sourceQuestion],
  );

  function selectSource(nextSource: RehearsalContentSource) {
    if (source === nextSource) return;
    const nextContent =
      nextSource === "published" && currentVersion ? currentVersion.content : quiz.draft;
    setSource(nextSource);
    setCompanionObservation({ ...INITIAL_COMPANION_PROTOTYPE_OBSERVATION });
    setQuestionHealthDispositions({});
    setProbeSelection(initialProbeSelection(nextContent));
    setSegment(initialSegment(nextContent));
    setExportStatus("");
    timing.current = createPrototypeTimingState(
      activeTab,
      prototypeNowMs(),
      prototypeDocumentIsVisible(),
    );
  }

  function selectTab(nextTab: PrototypeTab) {
    timing.current = switchPrototypeTiming(timing.current, nextTab, prototypeNowMs());
    setActiveTab(nextTab);
    setExportStatus("");
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const nextIndex = nextPrototypeTabIndex(index, event.key);
    if (nextIndex === index && !["Home", "End"].includes(event.key)) return;
    if (!["Home", "End", "ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const nextTab = PROTOTYPE_TABS[nextIndex];
    if (!nextTab) return;
    selectTab(nextTab);
    tabRefs.current[nextIndex]?.focus();
  }

  function elapsedFor(tab: PrototypeTab) {
    return prototypeElapsedMs(timing.current, tab, prototypeNowMs());
  }

  function updateCompanionObservation(next: CompanionPrototypeObservation) {
    const wasFinal = companionObservation.completion !== "in_progress";
    const isFinal = next.completion !== "in_progress";
    if (!wasFinal && isFinal) {
      timing.current = freezePrototypeTiming(timing.current, "companion", prototypeNowMs());
    } else if (wasFinal && !isFinal) {
      timing.current = resumePrototypeTiming(timing.current, "companion", prototypeNowMs());
    }
    setCompanionObservation(next);
  }

  function evidenceExport() {
    const evaluations = recordedQuestionHealthEvaluations(
      questionHealth.findings,
      questionHealthDispositions,
    );
    return buildResearchPrototypeEvidence({
      segment,
      participated: timing.current.participated,
      durationMs: {
        companion: elapsedFor("companion"),
        "question-health": elapsedFor("question-health"),
        "delayed-probe": elapsedFor("delayed-probe"),
      },
      companion: companionObservation,
      questionHealthEvaluatedCount: questionHealth.evaluatedQuestionCount,
      questionHealthEvaluations: evaluations,
      delayedProbe: delayedProbeEvaluation
        ? { evaluation: delayedProbeEvaluation, selection: probeSelection }
        : null,
    });
  }

  function downloadEvidence() {
    const evidence = evidenceExport();
    const url = URL.createObjectURL(
      new Blob([serializePrototypeEvidence(evidence)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = PROTOTYPE_EVIDENCE_DOWNLOAD_NAME;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setExportStatus(
      `Downloaded aggregate-only evidence for ${evidence.prototypeCount} prototype${evidence.prototypeCount === 1 ? "" : "s"}.`,
    );
  }

  return (
    <section className={styles.lab} data-testid="research-prototype-lab">
      <div className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Phase 0 · research instrument</p>
          <h1>Prototype Lab</h1>
          <p className={styles.lede}>
            Test three ideas against real Round content without selecting a roadmap branch or
            changing production data.
          </p>
        </div>
        <div className={styles.memoryPromise}>
          <span aria-hidden="true">◌</span>
          <div>
            <strong>Browser memory only</strong>
            <p>
              Refreshing clears every disposition and observation. Prototype observations are not
              written to local storage, cookies, or the server, and no new credential is created.
            </p>
          </div>
        </div>
      </div>

      <div className={styles.labControls}>
        <fieldset className={styles.sourceControl}>
          <legend>Content snapshot</legend>
          {hasPublishedVersion ? (
            <div>
              <label data-selected={source === "published"}>
                <input
                  checked={source === "published"}
                  name="prototype-source"
                  onChange={() => selectSource("published")}
                  type="radio"
                />
                Published v{currentVersion?.version}
              </label>
              <label data-selected={source === "draft"}>
                <input
                  checked={source === "draft"}
                  name="prototype-source"
                  onChange={() => selectSource("draft")}
                  type="radio"
                />
                Current draft
              </label>
            </div>
          ) : (
            <span>Current draft · no published version</span>
          )}
        </fieldset>
        <label className={styles.segmentControl} htmlFor="prototype-segment">
          <span>Research segment</span>
          <select
            id="prototype-segment"
            onChange={(event) => setSegment(event.target.value as PrototypeEvidenceSegment)}
            value={segment}
          >
            <option value="unclassified">Unclassified</option>
            <option value="education">Higher education</option>
            <option value="workplace">Workplace training</option>
          </select>
        </label>
        <div className={styles.snapshotSummary}>
          <span>Read-only snapshot</span>
          <strong lang={content.title ? "" : "en-CA"}>{content.title || "Untitled Round"}</strong>
          <small>{content.questions.length} real question(s) available to the prototypes</small>
        </div>
      </div>

      <div aria-label="Research prototypes" className={styles.tabList} role="tablist">
        {PROTOTYPE_TABS.map((tab, index) => (
          <button
            aria-controls={`prototype-panel-${tab}`}
            aria-selected={activeTab === tab}
            id={`prototype-tab-${tab}`}
            key={tab}
            onClick={() => selectTab(tab)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            role="tab"
            tabIndex={activeTab === tab ? 0 : -1}
            type="button"
          >
            <span>0{index + 1}</span>
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      <div
        aria-labelledby="prototype-tab-companion"
        hidden={activeTab !== "companion"}
        id="prototype-panel-companion"
        role="tabpanel"
        tabIndex={0}
      >
        <CompanionPrototypePanel
          key={source}
          observation={companionObservation}
          onObservationChange={updateCompanionObservation}
          onReset={() => {
            timing.current = resetPrototypeTabTiming(timing.current, "companion", prototypeNowMs());
            setExportStatus("");
          }}
        />
      </div>
      <div
        aria-labelledby="prototype-tab-question-health"
        hidden={activeTab !== "question-health"}
        id="prototype-panel-question-health"
        role="tabpanel"
        tabIndex={0}
      >
        <QuestionHealthPrototypePanel
          dispositions={questionHealthDispositions}
          onDispositionChange={(findingId, next) =>
            setQuestionHealthDispositions((current) => ({ ...current, [findingId]: next }))
          }
          result={questionHealth}
        />
      </div>
      <div
        aria-labelledby="prototype-tab-delayed-probe"
        hidden={activeTab !== "delayed-probe"}
        id="prototype-panel-delayed-probe"
        role="tabpanel"
        tabIndex={0}
      >
        <DelayedProbePrototypePanel
          content={content}
          evaluation={delayedProbeEvaluation}
          onSelectionChange={setProbeSelection}
          selection={probeSelection}
        />
      </div>

      <aside className={styles.exportCard} aria-labelledby="prototype-export-title">
        <div>
          <p className={styles.eyebrow}>Redacted study summary</p>
          <h2 id="prototype-export-title">Export bounded evidence</h2>
          <p>
            The JSON contains only schema versions, bounded enums, aggregate counts, rule IDs, and
            duration buckets. It excludes prompts, choices, rationales, citations, identifiers,
            aliases, URLs, tokens, and free text.
          </p>
        </div>
        <div className={styles.exportActions}>
          <button className={styles.primaryButton} onClick={downloadEvidence} type="button">
            Download redacted JSON
          </button>
          <span aria-live="polite" role="status">
            {exportStatus || "Nothing is uploaded when you export."}
          </span>
        </div>
      </aside>
    </section>
  );
}

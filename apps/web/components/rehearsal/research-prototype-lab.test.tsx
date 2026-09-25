import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { QuizDraft } from "@openround/contracts";
import { buildPrototypeEvidenceExport, evaluateDelayedProbeCandidate } from "@openround/rehearsal";
import {
  buildResearchPrototypeEvidence,
  createPrototypeTimingState,
  freezePrototypeTiming,
  nextPrototypeTabIndex,
  PROTOTYPE_EVIDENCE_DOWNLOAD_NAME,
  prototypeElapsedMs,
  recordedQuestionHealthEvaluations,
  resetPrototypeTabTiming,
  ResearchPrototypeLab,
  serializePrototypeEvidence,
  setPrototypeDocumentVisibility,
  switchPrototypeTiming,
} from "./research-prototype-lab";
import { isOverlayDismissKey } from "./companion-prototype-panel";
import { changeDelayedProbePair } from "./delayed-probe-prototype-panel";
import { reviewedQuestionHealthCount } from "./question-health-prototype-panel";

function id(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

const draft: QuizDraft = {
  title: "Private habitat lesson",
  description: "Must never enter the study export",
  category: "education",
  experiencePreset: { id: "campus", version: 1 },
  questions: [
    {
      id: id(1),
      type: "single_select",
      prompt: "Which change best protects the wetland habitat?",
      purpose: "diagnostic",
      confidence: "off",
      delivery: "main",
      conceptKeys: ["habitat.change"],
      linkedRecheckQuestionId: id(4),
      choices: [
        { id: id(2), label: "Restore native plants", isCorrect: true },
        { id: id(3), label: "Pave the shoreline", isCorrect: false },
      ],
      timeLimitSeconds: 20,
      basePoints: 1_000,
      explanation: "Native plants restore shelter and food.",
      mediaId: null,
      mediaAlt: null,
    },
    {
      id: id(4),
      type: "single_select",
      prompt: "A marsh loses most native cover. Which restoration should be prioritized?",
      purpose: "practice",
      confidence: "off",
      delivery: "recheck",
      conceptKeys: ["habitat.change"],
      linkedRecheckQuestionId: null,
      choices: [
        { id: id(5), label: "Replant local species", isCorrect: true },
        { id: id(6), label: "Add a parking area", isCorrect: false },
      ],
      timeLimitSeconds: 25,
      basePoints: 1_000,
      explanation: "Local species rebuild habitat structure.",
      mediaId: null,
      mediaAlt: null,
    },
  ],
};

describe("Phase 0 research prototype lab", () => {
  it("renders keyboard-operable tabs, status regions, privacy boundaries, and all prototypes", () => {
    const markup = renderToStaticMarkup(
      <ResearchPrototypeLab
        currentVersion={{ id: id(10), version: 3, content: draft }}
        quiz={{ id: id(11), status: "published", draft, currentVersionId: id(10) }}
      />,
    );

    expect(markup).toContain('role="tablist"');
    expect(markup.match(/role="tab"/g)).toHaveLength(3);
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Companion sidecar");
    expect(markup).toContain("Question Health");
    expect(markup).toContain("Delayed concept-matched probe");
    expect(markup).toContain("Browser memory only");
    expect(markup).toContain("Prototype observations are not");
    expect(markup).toContain("written to local storage, cookies, or the server");
    expect(markup).toContain("Download redacted JSON");
    expect(markup).toContain("room code, link, or");
    expect(markup).toContain("credential enter the sidecar");
    expect(markup).toContain('<strong lang="">Private habitat lesson</strong>');
    expect(markup).toContain('<option lang="" value="00000000-0000-4000-8000-000000000001"');
    expect(markup).not.toContain("action=");
  });

  it("wraps arrow-key navigation and supports Home and End", () => {
    expect(nextPrototypeTabIndex(0, "ArrowRight")).toBe(1);
    expect(nextPrototypeTabIndex(2, "ArrowRight")).toBe(0);
    expect(nextPrototypeTabIndex(0, "ArrowLeft")).toBe(2);
    expect(nextPrototypeTabIndex(1, "Home")).toBe(0);
    expect(nextPrototypeTabIndex(1, "End")).toBe(2);
    expect(nextPrototypeTabIndex(1, "Enter")).toBe(1);
    expect(isOverlayDismissKey("Escape")).toBe(true);
    expect(isOverlayDismissKey("Enter")).toBe(false);
  });

  it("clears delayed-probe dispositions when the evaluated pair changes", () => {
    expect(
      changeDelayedProbePair(
        {
          sourceQuestionId: id(1),
          candidateQuestionId: id(4),
          decision: "would_issue",
          evidenceKind: "personal_paired",
        },
        { sourceQuestionId: id(4), candidateQuestionId: id(1) },
      ),
    ).toEqual({
      sourceQuestionId: id(4),
      candidateQuestionId: id(1),
      decision: "undecided",
      evidenceKind: "not_selected",
    });
  });

  it("counts only active prototype time and freezes a finalized Companion attempt", () => {
    let timing = createPrototypeTimingState("companion", 1_000);
    timing = switchPrototypeTiming(timing, "question-health", 31_000);

    expect(prototypeElapsedMs(timing, "companion", 931_000)).toBe(30_000);
    expect(prototypeElapsedMs(timing, "question-health", 931_000)).toBe(900_000);

    timing = switchPrototypeTiming(timing, "companion", 931_000);
    timing = freezePrototypeTiming(timing, "companion", 961_000);
    expect(prototypeElapsedMs(timing, "companion", 1_861_000)).toBe(60_000);

    timing = resetPrototypeTabTiming(timing, "companion", 1_861_000);
    expect(prototypeElapsedMs(timing, "companion", 1_871_000)).toBe(10_000);
  });

  it("pauses elapsed time while the document is hidden", () => {
    let timing = createPrototypeTimingState("companion", 1_000);
    timing = setPrototypeDocumentVisibility(timing, false, 31_000);

    expect(prototypeElapsedMs(timing, "companion", 931_000)).toBe(30_000);

    timing = switchPrototypeTiming(timing, "question-health", 931_000);
    expect(prototypeElapsedMs(timing, "question-health", 1_831_000)).toBe(0);

    timing = setPrototypeDocumentVisibility(timing, true, 1_831_000);
    expect(prototypeElapsedMs(timing, "question-health", 1_841_000)).toBe(10_000);

    timing = setPrototypeDocumentVisibility(timing, false, 1_841_000);
    expect(prototypeElapsedMs(timing, "question-health", 2_741_000)).toBe(10_000);
  });

  it("preserves freeze and reset semantics across visibility transitions", () => {
    let timing = createPrototypeTimingState("companion", 1_000);
    timing = setPrototypeDocumentVisibility(timing, false, 31_000);
    timing = freezePrototypeTiming(timing, "companion", 331_000);
    timing = setPrototypeDocumentVisibility(timing, true, 631_000);

    expect(prototypeElapsedMs(timing, "companion", 931_000)).toBe(30_000);

    timing = resetPrototypeTabTiming(timing, "companion", 931_000);
    expect(prototypeElapsedMs(timing, "companion", 941_000)).toBe(10_000);
  });

  it("does not count missing or partial Question Health dispositions as fully reviewed", () => {
    const result = {
      rulesetVersion: "p0.1.0" as const,
      evaluatedQuestionCount: 1,
      findings: [
        {
          id: "finding-1",
          ruleId: "question.missing_citation" as const,
          ruleVersion: 1 as const,
          rulesetVersion: "p0.1.0" as const,
          severity: "advisory" as const,
          questionIndex: 0,
          fieldPath: "questions.0.sourceCitations",
          contentHash: "hash",
          reason: "Citation missing",
          evidence: "No citation is present.",
          recommendedAction: "Review a source.",
        },
      ],
    };

    expect(reviewedQuestionHealthCount(result, {})).toBe(0);
    expect(
      reviewedQuestionHealthCount(result, {
        "finding-1": { usefulness: "useful", outcome: "pending" },
      }),
    ).toBe(0);
    expect(
      reviewedQuestionHealthCount(result, {
        "finding-1": { usefulness: "useful", outcome: "retained_revision" },
      }),
    ).toBe(1);

    expect(
      recordedQuestionHealthEvaluations(result.findings, {
        "finding-1": { usefulness: "useful", outcome: "pending" },
      }),
    ).toEqual([
      {
        ruleId: "question.missing_citation",
        ruleVersion: 1,
        rulesetVersion: "p0.1.0",
        usefulness: "useful",
        outcome: "pending",
      },
    ]);
    expect(
      recordedQuestionHealthEvaluations(result.findings, {
        "finding-1": { usefulness: "pending", outcome: "pending" },
      }),
    ).toEqual([
      {
        ruleId: "question.missing_citation",
        ruleVersion: 1,
        rulesetVersion: "p0.1.0",
        usefulness: "pending",
        outcome: "pending",
      },
    ]);
  });

  it("includes only prototypes that were actually opened and finalized where required", () => {
    const evaluation = evaluateDelayedProbeCandidate({
      source: draft.questions[0]!,
      candidate: draft.questions[1]!,
    });
    const baseline = {
      segment: "education" as const,
      durationMs: { companion: 20_000, "question-health": 40_000, "delayed-probe": 60_000 },
      companion: {
        completion: "in_progress" as const,
        primaryActionCount: 1,
        overlayOpenCount: 0,
        returnedToSidecar: false,
      },
      questionHealthEvaluatedCount: 2,
      questionHealthEvaluations: [],
      delayedProbe: {
        evaluation,
        selection: { decision: "undecided" as const, evidenceKind: "not_selected" as const },
      },
    };

    expect(
      buildResearchPrototypeEvidence({
        ...baseline,
        participated: { companion: true, "question-health": false, "delayed-probe": false },
      }).prototypeCount,
    ).toBe(0);
    expect(
      buildResearchPrototypeEvidence({
        ...baseline,
        participated: { companion: true, "question-health": true, "delayed-probe": false },
      }).prototypeCount,
    ).toBe(1);
    expect(
      buildResearchPrototypeEvidence({
        ...baseline,
        companion: { ...baseline.companion, completion: "completed" },
        participated: { companion: true, "question-health": true, "delayed-probe": true },
      }).prototypeCount,
    ).toBe(3);
  });

  it("serializes only the aggregate evidence contract and uses a content-free filename", () => {
    const evaluation = evaluateDelayedProbeCandidate({
      source: draft.questions[0]!,
      candidate: draft.questions[1]!,
    });
    const evidence = buildPrototypeEvidenceExport({
      segment: "education",
      companion: {
        durationMs: 90_000,
        completion: "completed",
        returnToDeckOutcome: "successful",
        primaryActionCount: 3,
        overlayOpenCount: 1,
      },
      delayedProbe: {
        durationMs: 180_000,
        evaluation,
        decision: "would_issue",
        evidenceKind: "personal_paired",
      },
      questionHealth: {
        durationMs: 200_000,
        evaluatedQuestionCount: 2,
        evaluations: [
          {
            ruleId: "question.missing_citation",
            ruleVersion: 1,
            rulesetVersion: "p0.1.0",
            usefulness: "useful",
            outcome: "retained_revision",
          },
        ],
      },
    });
    const serialized = serializePrototypeEvidence(evidence);

    expect(PROTOTYPE_EVIDENCE_DOWNLOAD_NAME).toBe("openround-phase0-prototype-evidence.json");
    expect(serialized.endsWith("\n")).toBe(true);
    expect(JSON.parse(serialized)).toEqual(evidence);
    expect(serialized).not.toContain(draft.title);
    expect(serialized).not.toContain(draft.description);
    for (const question of draft.questions) {
      expect(serialized).not.toContain(question.id);
      expect(serialized).not.toContain(question.prompt);
      if ("choices" in question) {
        for (const choice of question.choices) expect(serialized).not.toContain(choice.label);
      }
    }
  });
});

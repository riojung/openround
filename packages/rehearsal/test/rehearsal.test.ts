import { SessionSnapshotSchema, type QuestionDraft, type QuizDraft } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  buildRecoveryRehearsal,
  createRecoveryRehearsalController,
  getHostPhaseView,
  isLegalHostPhaseCommand,
  recoveryRehearsalEligibility,
  RecoveryRehearsalError,
} from "../src/index.js";

function id(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function sourceQuestion(overrides: Partial<QuestionDraft> = {}): QuestionDraft {
  return {
    id: id(1),
    type: "single_select",
    prompt: "Which change best protects the habitat?",
    purpose: "diagnostic",
    confidence: "off",
    delivery: "main",
    conceptKeys: ["habitat.change"],
    linkedRecheckQuestionId: null,
    choices: [
      { id: id(2), label: "Restore the wetland", isCorrect: true },
      { id: id(3), label: "Pave the wetland", isCorrect: false },
    ],
    timeLimitSeconds: 20,
    basePoints: 1_000,
    explanation: "Wetlands provide habitat and absorb water.",
    mediaId: null,
    mediaAlt: null,
    ...overrides,
  } as QuestionDraft;
}

function recheckQuestion(): QuestionDraft {
  return {
    id: id(4),
    type: "true_false",
    prompt: "Restoring a wetland can protect habitat and manage water.",
    purpose: "practice",
    confidence: "off",
    delivery: "recheck",
    linkedRecheckQuestionId: null,
    choices: [
      { id: id(5), label: "True", isCorrect: true },
      { id: id(6), label: "False", isCorrect: false },
    ],
    timeLimitSeconds: 15,
    basePoints: 1_000,
    explanation: "The statement applies the same idea in a new form.",
    mediaId: null,
    mediaAlt: null,
  };
}

function confidentSourceQuestion(overrides: Partial<QuestionDraft> = {}): QuestionDraft {
  return sourceQuestion({
    confidence: "required",
    choices: [
      { id: id(2), label: "Restore the wetland", isCorrect: true },
      {
        id: id(3),
        label: "Pave the wetland",
        isCorrect: false,
        misconceptionKey: "habitat.paving-helps",
      },
    ],
    ...overrides,
  });
}

function quiz(questions: QuestionDraft[] = [sourceQuestion()]): QuizDraft {
  return {
    title: "Habitat recovery",
    description: "A deterministic rehearsal fixture",
    category: "education",
    experiencePreset: { id: "campus", version: 1 },
    questions,
  };
}

describe("recovery rehearsal eligibility", () => {
  it("accepts complete scored main choice checkpoints with an untagged wrong option", () => {
    const linked = recheckQuestion();
    const source = sourceQuestion({ linkedRecheckQuestionId: linked.id });
    const result = recoveryRehearsalEligibility(quiz([source, linked]));

    expect(result.eligible).toBe(true);
    expect(result.questions).toEqual([
      {
        questionId: id(1),
        questionIndex: 0,
        prompt: "Which change best protects the habitat?",
        wrongChoiceId: id(3),
        wrongChoiceLabel: "Pave the wetland",
        recheckMode: "linked",
        recheckQuestionId: id(4),
        recheckPrompt: "Restoring a wetland can protect habitat and manage water.",
      },
    ]);
  });

  it("rejects tagged-only, opinion, incomplete, and unsupported checkpoints", () => {
    const tagged = sourceQuestion({
      choices: [
        { id: id(20), label: "Correct", isCorrect: true },
        {
          id: id(21),
          label: "Tagged wrong",
          isCorrect: false,
          misconceptionKey: "known.error",
        },
      ],
    });
    const opinion = sourceQuestion({ id: id(22), purpose: "opinion" });
    const incomplete = sourceQuestion({ id: id(23), prompt: "" });
    const numeric: QuestionDraft = {
      id: id(24),
      type: "numeric",
      prompt: "How many?",
      purpose: "diagnostic",
      confidence: "off",
      delivery: "main",
      linkedRecheckQuestionId: null,
      correctValue: "4",
      tolerance: "0",
      unit: null,
      timeLimitSeconds: 20,
      basePoints: 1_000,
      explanation: "Four.",
      mediaId: null,
      mediaAlt: null,
    };
    const result = recoveryRehearsalEligibility(
      quiz([tagged, opinion, incomplete, numeric]),
      "split_room",
    );

    expect(result.eligible).toBe(false);
    expect(result.questions).toEqual([]);
    expect(result.reason).toContain("untagged wrong choice");
    expect(result.requirements).toHaveLength(3);
  });

  it("requires authored confidence and a tagged wrong choice for confident misconception", () => {
    const confidenceOff = confidentSourceQuestion({ confidence: "off" });
    const untagged = sourceQuestion({ confidence: "required" });
    const eligible = confidentSourceQuestion({ id: id(30) });

    expect(
      recoveryRehearsalEligibility(quiz([confidenceOff, untagged]), "confident_misconception")
        .eligible,
    ).toBe(false);
    expect(
      recoveryRehearsalEligibility(quiz([eligible]), "confident_misconception").questions[0],
    ).toMatchObject({ questionId: id(30), wrongChoiceLabel: "Pave the wetland" });
  });
});

describe("deterministic guided scenarios", () => {
  it("emits contract-valid snapshots with a deterministic synthetic room code", () => {
    const plans = [
      buildRecoveryRehearsal({ quiz: quiz(), scenarioId: "low_participation" }),
      buildRecoveryRehearsal({ quiz: quiz(), scenarioId: "split_room" }),
      buildRecoveryRehearsal({
        quiz: quiz([confidentSourceQuestion()]),
        scenarioId: "confident_misconception",
      }),
    ];

    for (const plan of plans) {
      for (const step of plan.steps) {
        expect(step.snapshot.code).toBe("0000000");
        expect(SessionSnapshotSchema.parse(step.snapshot)).toEqual(step.snapshot);
      }
    }
  });

  it("runs the exact 10 active / 6 response low-participation scenario", () => {
    const plan = buildRecoveryRehearsal({
      quiz: quiz(),
      scenarioId: "low_participation",
    });

    expect(plan.insight).toMatchObject({
      sampleSize: 6,
      activeParticipantCount: 10,
      participationPercent: 60,
      correctnessPercent: 33.3,
      recommendation: {
        code: "low_participation",
        action: "wait_or_check_access",
      },
    });
    expect(plan.intervention.type).toBe("explain");
    expect(plan.steps.map((step) => step.snapshot.phase)).toEqual([
      "lobby",
      "question_open",
      "question_open",
      "question_locked",
      "question_reveal",
      "intervention",
      "question_reveal",
      "question_open",
      "question_locked",
    ]);
    expect(plan.steps[3]?.snapshot.insight).toEqual(plan.insight);
    expect(
      plan.participants.filter((participant) => participant.initial === "no_response"),
    ).toHaveLength(4);
    expect(plan.debrief).toMatchObject({
      evidenceLabel: "Revote improvement",
      initialWrongCount: 4,
      recoveredCount: 3,
      recoveryPercent: 75,
      unresolvedCount: 1,
    });
  });

  it("documents that the real insight priority classifies an exact 5/5 split as low correctness", () => {
    const plan = buildRecoveryRehearsal({
      quiz: quiz(),
      scenarioId: "split_room",
    });

    expect(plan.insight).toMatchObject({
      sampleSize: 10,
      participationPercent: 100,
      correctnessPercent: 50,
      highConfidenceWrongPercent: 0,
      dominantMisconception: null,
      recommendation: {
        code: "low_correctness",
        action: "show_example",
      },
    });
    expect(plan.intervention.type).toBe("example");
    expect(
      plan.participants.filter((participant) => participant.initial === "correct"),
    ).toHaveLength(5);
    expect(
      plan.participants.filter((participant) => participant.initial === "incorrect"),
    ).toHaveLength(5);
    expect(plan.debrief.recoveredCount).toBe(4);
    expect(plan.debrief.recoveryPercent).toBe(80);
  });

  it("runs 4 high-confidence wrong and 6 correct through the production confidence rule", () => {
    const plan = buildRecoveryRehearsal({
      quiz: quiz([confidentSourceQuestion()]),
      scenarioId: "confident_misconception",
    });

    expect(plan.insight).toMatchObject({
      sampleSize: 10,
      correctnessPercent: 60,
      highConfidenceWrongPercent: 40,
      recommendation: {
        code: "high_confidence_error",
        action: "target_misconception",
      },
    });
    expect(plan.intervention.type).toBe("explain");
    expect(
      plan.participants.filter((participant) => participant.initial === "incorrect"),
    ).toHaveLength(4);
    expect(plan.debrief).toMatchObject({
      initialWrongCount: 4,
      recoveredCount: 3,
      recoveryPercent: 75,
    });
    expect(plan.adaptations).toEqual([]);
  });

  it("prefers an eligible linked recheck and otherwise uses a clearly labelled revote", () => {
    const linked = recheckQuestion();
    const withLinked = buildRecoveryRehearsal({
      quiz: quiz([confidentSourceQuestion({ linkedRecheckQuestionId: linked.id }), linked]),
      scenarioId: "confident_misconception",
    });
    const withoutLinked = buildRecoveryRehearsal({
      quiz: quiz([confidentSourceQuestion()]),
      scenarioId: "confident_misconception",
    });

    expect(withLinked.recheck).toMatchObject({
      mode: "linked",
      roundKind: "linked_recheck",
      questionId: id(4),
      label: "Linked recheck",
    });
    expect(withLinked.debrief.evidenceLabel).toBe("Linked recheck recovery");
    expect(withLinked.debrief.evidenceNote).toContain("stronger transfer evidence");
    expect(withLinked.steps[7]?.snapshot.roundKind).toBe("linked_recheck");
    expect(withoutLinked.recheck).toMatchObject({
      mode: "revote",
      roundKind: "revote",
      questionId: id(1),
      label: "Same-question revote",
    });
    expect(withoutLinked.debrief.evidenceNote).toContain("not independent transfer evidence");
    expect(withoutLinked.steps[7]?.snapshot.roundKind).toBe("revote");
  });

  it("is repeatable, leaves quiz content untouched, and exposes a bounded controller", () => {
    const inputQuiz = quiz([confidentSourceQuestion()]);
    const before = structuredClone(inputQuiz);
    const first = buildRecoveryRehearsal({
      quiz: inputQuiz,
      scenarioId: "confident_misconception",
    });
    const second = buildRecoveryRehearsal({
      quiz: inputQuiz,
      scenarioId: "confident_misconception",
    });
    const controller = createRecoveryRehearsalController({
      quiz: inputQuiz,
      scenarioId: "confident_misconception",
    });

    expect(first).toEqual(second);
    expect(inputQuiz).toEqual(before);
    expect(first.steps.map((step) => step.id)).toEqual([
      "briefing",
      "question_open",
      "responses",
      "diagnosis",
      "revealed",
      "intervention",
      "verify",
      "recheck",
      "debrief",
    ]);
    expect(controller.previous(0)).toBe(0);
    expect(controller.next(8)).toBe(8);
    expect(controller.view(99)).toMatchObject({
      stepIndex: 8,
      stepCount: 9,
      progressPercent: 100,
      canContinue: false,
      complete: true,
    });
    for (const [index, step] of first.steps.entries()) {
      if (!step.command) continue;
      expect(isLegalHostPhaseCommand(getHostPhaseView(step.snapshot), step.command)).toBe(true);
      expect(controller.apply(index, step.command)).toBe(index + 1);
    }
    expect(() => controller.apply(0, { action: "end", label: "End" })).toThrowError(
      "That action is not part of this guided rehearsal step.",
    );
    expect(
      first.participants.every((participant) => participant.label.startsWith("Synthetic ")),
    ).toBe(true);
    expect(first.debrief.syntheticDataNote).toContain("never saved");
  });

  it("throws a stable eligibility error instead of starting an invalid simulation", () => {
    const invalid = quiz([sourceQuestion({ prompt: "" })]);

    expect(() =>
      buildRecoveryRehearsal({ quiz: invalid, scenarioId: "low_participation" }),
    ).toThrowError(RecoveryRehearsalError);
    try {
      buildRecoveryRehearsal({ quiz: invalid, scenarioId: "low_participation" });
    } catch (error) {
      expect(error).toMatchObject({ code: "NO_ELIGIBLE_CHECKPOINT" });
    }
  });
});

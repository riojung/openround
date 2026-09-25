import { QuestionSchema, type QuestionDraft, type QuizDraft } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  buildCompanionPrototypeProjection,
  buildPrototypeEvidenceExport,
  createQuestionHealthFindingEvaluation,
  evaluateDelayedProbeCandidate,
  evaluateQuestionHealth,
  prototypeDurationBucket,
  QUESTION_HEALTH_RULESET_VERSION,
  type CompanionPrototypeInput,
  type PrototypeEvidenceInput,
} from "../src/index.js";

function id(value: number) {
  return `10000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function question(value: number, overrides: Partial<QuestionDraft> = {}): QuestionDraft {
  return {
    id: id(value),
    type: "single_select",
    prompt: "Which response best protects the wetland?",
    purpose: "diagnostic",
    confidence: "off",
    delivery: "main",
    conceptKeys: ["Habitat.Change"],
    linkedRecheckQuestionId: null,
    choices: [
      {
        id: id(value + 100),
        label: "Restore native plants",
        isCorrect: true,
        feedback: "Native plants restore habitat.",
      },
      {
        id: id(value + 200),
        label: "Pave the wetland",
        isCorrect: false,
        feedback: "Paving removes habitat.",
      },
    ],
    timeLimitSeconds: 30,
    basePoints: 1_000,
    explanation: "Restoration supports habitat and water management.",
    mediaId: null,
    mediaAlt: null,
    sourceCitations: [
      {
        sourceName: "Reviewed source",
        sourceDigest: "a".repeat(64),
        locator: "section 1",
        excerpt: "Wetland restoration supports habitat.",
      },
    ],
    ...overrides,
  } as QuestionDraft;
}

function quiz(questions: QuestionDraft[]): QuizDraft {
  return {
    title: "Prototype fixture",
    description: "Deterministic test content",
    category: "education",
    experiencePreset: { id: "campus", version: 1 },
    questions,
  };
}

describe("Question Health prototype", () => {
  it("returns versioned advisory findings with deterministic stable IDs", () => {
    const recheck = question(2, {
      prompt: "Which response best protects the wetland?!",
      delivery: "recheck",
      conceptKeys: ["unrelated.topic"],
    });
    const source = question(1, {
      linkedRecheckQuestionId: recheck.id,
      explanation: "",
      sourceCitations: [],
      choices: [
        { id: id(101), label: "Restore native plants", isCorrect: true },
        { id: id(201), label: "restore native plants!", isCorrect: false },
      ],
    });
    const input = quiz([source, recheck]);
    const first = evaluateQuestionHealth(input);
    const second = evaluateQuestionHealth(structuredClone(input));

    expect(first).toEqual(second);
    expect(first.rulesetVersion).toBe(QUESTION_HEALTH_RULESET_VERSION);
    expect(first.findings.every((finding) => finding.severity === "advisory")).toBe(true);
    expect(first.findings.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining([
        "question.missing_explanation",
        "question.missing_citation",
        "choice.duplicate",
        "choice.missing_rationale",
        "recheck.same_prompt",
        "recheck.concept_mismatch",
      ]),
    );
    expect(new Set(first.findings.map((finding) => finding.id)).size).toBe(first.findings.length);

    const titleOnlyChange = { ...input, title: "A different draft title" };
    expect(evaluateQuestionHealth(titleOnlyChange).findings.map((finding) => finding.id)).toEqual(
      first.findings.map((finding) => finding.id),
    );

    const changedRecheck = {
      ...input,
      questions: [source, { ...recheck, conceptKeys: ["another.unrelated.topic"] }],
    };
    const firstMismatch = first.findings.find(
      (finding) => finding.ruleId === "recheck.concept_mismatch",
    );
    const changedMismatch = evaluateQuestionHealth(changedRecheck).findings.find(
      (finding) => finding.ruleId === "recheck.concept_mismatch",
    );
    expect(changedMismatch?.id).not.toBe(firstMismatch?.id);
    expect(changedMismatch?.contentHash).not.toBe(firstMismatch?.contentHash);
  });

  it("records useful/not-useful judgments and bounded outcomes", () => {
    const findings = evaluateQuestionHealth(
      quiz([
        question(1, {
          explanation: "",
          sourceCitations: [],
        }),
      ]),
    ).findings;
    const explanation = findings.find(
      (finding) => finding.ruleId === "question.missing_explanation",
    )!;
    const citation = findings.find((finding) => finding.ruleId === "question.missing_citation")!;
    const evaluations = [
      createQuestionHealthFindingEvaluation(explanation, "useful", "retained_revision"),
      createQuestionHealthFindingEvaluation(citation, "not_useful", "deliberate_dismissal"),
    ];
    const exported = buildPrototypeEvidenceExport({
      segment: "education",
      questionHealth: { durationMs: 75_000, evaluatedQuestionCount: 1, evaluations },
    });

    expect(exported.questionHealth).toMatchObject({
      rulesetVersion: QUESTION_HEALTH_RULESET_VERSION,
      durationBucket: "1_to_2m",
      counts: {
        questionsEvaluated: 1,
        findingsRecorded: 2,
        fullyReviewed: 2,
        usefulnessReviewed: 2,
        usefulnessPending: 0,
        useful: 1,
        notUseful: 1,
        outcomesReviewed: 2,
        outcomePending: 0,
        retainedRevision: 1,
        deliberateDismissal: 1,
        noDecision: 0,
      },
    });
    expect(exported.questionHealth?.rules).toEqual([
      expect.objectContaining({
        ruleId: "question.missing_explanation",
        ruleVersion: 1,
        usefulCount: 1,
      }),
      expect.objectContaining({
        ruleId: "question.missing_citation",
        ruleVersion: 1,
        notUsefulCount: 1,
      }),
    ]);
  });

  it("keeps usefulness and outcome denominators independent while review is incomplete", () => {
    const findings = evaluateQuestionHealth(
      quiz([question(1, { explanation: "", sourceCitations: [] })]),
    ).findings;
    const explanation = findings.find(
      (finding) => finding.ruleId === "question.missing_explanation",
    )!;
    const citation = findings.find((finding) => finding.ruleId === "question.missing_citation")!;
    const exported = buildPrototypeEvidenceExport({
      segment: "education",
      questionHealth: {
        durationMs: 30_000,
        evaluatedQuestionCount: 1,
        evaluations: [
          createQuestionHealthFindingEvaluation(explanation, "useful", "pending"),
          createQuestionHealthFindingEvaluation(citation, "pending", "deliberate_dismissal"),
        ],
      },
    });

    expect(exported.questionHealth?.counts).toEqual({
      questionsEvaluated: 1,
      findingsRecorded: 2,
      fullyReviewed: 0,
      usefulnessReviewed: 1,
      usefulnessPending: 1,
      useful: 1,
      notUseful: 0,
      outcomesReviewed: 1,
      outcomePending: 1,
      retainedRevision: 0,
      deliberateDismissal: 1,
      noDecision: 0,
    });
  });

  it("does not collapse distinct schema-valid concept-key separators", () => {
    const recheck = question(2, {
      delivery: "recheck",
      conceptKeys: ["risk-high"],
    });
    const source = question(1, {
      linkedRecheckQuestionId: recheck.id,
      conceptKeys: ["risk.high"],
    });

    expect(evaluateQuestionHealth(quiz([source, recheck])).findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ ruleId: "recheck.concept_mismatch" })]),
    );
    expect(evaluateDelayedProbeCandidate({ source, candidate: recheck })).toMatchObject({
      accepted: false,
      rejectionReasons: expect.arrayContaining(["no_concept_overlap"]),
    });
  });

  it("does not report publish blockers as advisory configuration findings", () => {
    const invalidPoll = question(1, {
      type: "poll",
      purpose: "opinion",
      confidence: "required",
      basePoints: 500,
      choices: [
        { id: id(101), label: "Yes", isCorrect: false },
        { id: id(201), label: "No", isCorrect: false },
      ],
    });
    const invalidRating = {
      id: id(2),
      type: "rating",
      prompt: "How confident are you in the proposed response?",
      purpose: "opinion",
      confidence: "optional",
      delivery: "main",
      conceptKeys: ["habitat.change"],
      linkedRecheckQuestionId: null,
      min: 1,
      max: 5,
      minLabel: "Not confident",
      maxLabel: "Very confident",
      timeLimitSeconds: 30,
      basePoints: 500,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
      sourceCitations: [],
    } satisfies QuestionDraft;
    const invalidRecheck = question(3, {
      delivery: "recheck",
      linkedRecheckQuestionId: id(4),
    });

    for (const publishBlocked of [invalidPoll, invalidRating, invalidRecheck]) {
      expect(QuestionSchema.safeParse(publishBlocked).success).toBe(false);
      expect(
        evaluateQuestionHealth(quiz([publishBlocked])).findings.some(
          (finding) => finding.ruleId === "question.configuration_mismatch",
        ),
      ).toBe(false);
    }
  });

  it("retains advisory configuration findings for publish-valid question types", () => {
    const publishValidOpinion = question(1, {
      purpose: "opinion",
      confidence: "required",
      basePoints: 500,
    });

    expect(QuestionSchema.safeParse(publishValidOpinion).success).toBe(true);
    expect(evaluateQuestionHealth(quiz([publishValidOpinion])).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "question.configuration_mismatch",
          fieldPath: "questions.0.purpose",
        }),
      ]),
    );
  });

  it("points dense-content findings at the content that triggered them", () => {
    const promptDense = question(1, { prompt: "P".repeat(241) });
    const longChoiceDense = question(2, {
      choices: [
        { id: id(102), label: "Brief answer", isCorrect: true },
        { id: id(202), label: "L".repeat(141), isCorrect: false, feedback: "Not supported." },
      ],
    });
    const aggregateDense = question(3, {
      choices: ["A", "B", "C", "D", "E"].map((prefix, index) => ({
        id: id(303 + index),
        label: `${prefix}${prefix.toLowerCase().repeat(120)}`,
        isCorrect: index === 0,
        feedback: index === 0 ? "Supported." : "Not supported.",
      })),
    });

    const densePaths = (draft: QuestionDraft) =>
      evaluateQuestionHealth(quiz([draft]))
        .findings.filter((finding) => finding.ruleId === "question.dense_content")
        .map((finding) => finding.fieldPath);

    expect(densePaths(promptDense)).toEqual(["questions.0.prompt"]);
    expect(densePaths(longChoiceDense)).toEqual(["questions.0.choices.1.label"]);
    expect(densePaths(aggregateDense)).toEqual(["questions.0.choices"]);
  });
});

describe("delayed probe prototype", () => {
  it("rejects repeated prompts and concept mismatches", () => {
    const source = question(1);
    const repeated = evaluateDelayedProbeCandidate({
      source,
      candidate: question(2, { prompt: source.prompt, delivery: "recheck" }),
    });
    const mismatched = evaluateDelayedProbeCandidate({
      source,
      candidate: question(3, {
        prompt: "A storm changes the shoreline. Which restoration should the team prioritize?",
        delivery: "recheck",
        conceptKeys: ["shoreline.cost"],
      }),
    });

    expect(repeated).toMatchObject({
      accepted: false,
      promptDifference: "same_or_near_duplicate",
      rejectionReasons: ["prompt_not_meaningfully_different"],
    });
    expect(mismatched).toMatchObject({
      accepted: false,
      promptDifference: "meaningfully_different",
      rejectionReasons: ["no_concept_overlap"],
    });
  });

  it("accepts a meaningfully different prompt with normalized concept overlap", () => {
    const result = evaluateDelayedProbeCandidate({
      source: question(1, { conceptKeys: [" Habitat.Change ", "water.flow"] }),
      candidate: question(2, {
        prompt:
          "After a new road increases runoff, which project would restore breeding areas and slow the water?",
        delivery: "recheck",
        conceptKeys: ["habitat.change", "runoff.management"],
      }),
    });

    expect(result).toEqual({
      version: "p0.1.0",
      accepted: true,
      promptDifference: "meaningfully_different",
      sourceConceptCount: 2,
      candidateConceptCount: 2,
      overlappingConceptCount: 1,
      overlappingConceptKeys: ["habitat.change"],
      rejectionReasons: [],
    });
  });
});

describe("participant-safe Companion prototype", () => {
  it("projects only sidecar-safe fields and disables commands while reconnecting", () => {
    const secret = "PRIVATE-ANSWER-KEY";
    const untypedInput = {
      phase: "question_locked",
      roundKind: "main",
      joinedCount: 12,
      connectedCount: 9,
      answeredCount: 8,
      connectionState: "reconnecting",
      answerKey: secret,
      choices: [secret],
      participantAlias: secret,
      citations: [{ url: `https://private.example/${secret}` }],
      hiddenDiagnostic: secret,
    } as CompanionPrototypeInput & Record<string, unknown>;

    const projection = buildCompanionPrototypeProjection(untypedInput);

    expect(projection).toEqual({
      version: "p0.1.0",
      projection: "companion_prototype",
      phase: "question_locked",
      phaseLabel: "Diagnose",
      roundKind: "main",
      roomStatus: {
        joinedCount: 12,
        connectedCount: 9,
        disconnectedCount: 3,
        answeredCount: 8,
      },
      connectionState: "reconnecting",
      primaryAction: { action: "none", label: "Reconnecting", enabled: false },
    });
    expect(JSON.stringify(projection)).not.toContain(secret);
  });

  it("fails closed when an untyped caller supplies raw strings in enum fields", () => {
    const secret = "PRIVATE-PROMPT-AS-PHASE";
    const projection = buildCompanionPrototypeProjection({
      phase: secret,
      roundKind: secret,
      joinedCount: 2,
      connectedCount: 2,
      answeredCount: 1,
      connectionState: secret,
    } as unknown as CompanionPrototypeInput);

    expect(projection).toMatchObject({
      phase: "finished",
      phaseLabel: "Complete",
      roundKind: "main",
      connectionState: "disconnected",
      primaryAction: { action: "none", enabled: false },
    });
    expect(JSON.stringify(projection)).not.toContain(secret);
  });
});

describe("redacted prototype evidence", () => {
  it("exports only versioned enums, counts, rule IDs, and duration buckets", () => {
    const secret = "DO-NOT-EXPORT-CONTENT";
    const evaluation = evaluateDelayedProbeCandidate({
      source: question(1, { conceptKeys: [`${secret}.source`] }),
      candidate: question(2, {
        prompt: "Apply the idea in a new operational scenario.",
        conceptKeys: [`${secret}.source`],
      }),
    });
    const untypedInput = {
      segment: "workplace",
      companion: {
        durationMs: 20_000,
        completion: "completed",
        returnToDeckOutcome: "successful",
        primaryActionCount: 2,
        overlayOpenCount: 1,
        alias: secret,
        url: `https://private.example/${secret}`,
      },
      questionHealth: {
        durationMs: 6 * 60_000,
        evaluatedQuestionCount: 1,
        evaluations: [
          {
            ruleId: "choice.duplicate",
            ruleVersion: 1,
            rulesetVersion: QUESTION_HEALTH_RULESET_VERSION,
            usefulness: "useful",
            outcome: "retained_revision",
            findingId: secret,
            prompt: secret,
          },
        ],
      },
      delayedProbe: {
        durationMs: 16 * 60_000,
        evaluation,
        decision: "would_issue",
        evidenceKind: "generic_cohort",
        accessUrl: `https://private.example/${secret}`,
      },
      facilitatorId: secret,
      freeText: secret,
    } as unknown as PrototypeEvidenceInput & Record<string, unknown>;

    const exported = buildPrototypeEvidenceExport(untypedInput);
    const serialized = JSON.stringify(exported);

    expect(exported).toMatchObject({
      schemaVersion: "openround.phase0-prototype-evidence.v1",
      protocolVersion: "p0-2026",
      segment: "workplace",
      prototypeCount: 3,
      companion: {
        durationBucket: "under_1m",
        counts: { primaryActions: 2, overlaysOpened: 1 },
      },
      questionHealth: {
        durationBucket: "5_to_15m",
        rulesetVersion: QUESTION_HEALTH_RULESET_VERSION,
        counts: { findingsRecorded: 1, usefulnessReviewed: 1, useful: 1 },
      },
      delayedProbe: {
        durationBucket: "over_15m",
        candidate: "accepted",
        counts: { sourceConcepts: 1, candidateConcepts: 1, overlappingConcepts: 1 },
      },
    });
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("https://");
    expect(serialized).not.toContain("findingId");
    expect(serialized).not.toContain("overlappingConceptKeys");
    expect(serialized).not.toContain("prompt");
  });

  it("preserves the one- and two-minute research thresholds", () => {
    expect(prototypeDurationBucket(59_999)).toBe("under_1m");
    expect(prototypeDurationBucket(60_000)).toBe("1_to_2m");
    expect(prototypeDurationBucket(119_999)).toBe("1_to_2m");
    expect(prototypeDurationBucket(120_000)).toBe("2_to_5m");
  });

  it("clamps untyped enum fields and filters unknown rejection reasons", () => {
    const malicious = "RAW-CUSTOMER-CONTENT";
    const evaluation = {
      ...evaluateDelayedProbeCandidate({
        source: question(1),
        candidate: question(2, { prompt: "Apply this concept to a new flooding scenario." }),
      }),
      rejectionReasons: [malicious],
    };
    const input = {
      segment: malicious,
      companion: {
        durationMs: 1,
        completion: malicious,
        returnToDeckOutcome: malicious,
        primaryActionCount: 1,
        overlayOpenCount: 1,
      },
      delayedProbe: {
        durationMs: 1,
        evaluation,
        decision: malicious,
        evidenceKind: malicious,
      },
      questionHealth: {
        evaluatedQuestionCount: 1,
        durationMs: 1,
        evaluations: [
          {
            ruleId: "choice.duplicate",
            usefulness: malicious,
            outcome: malicious,
          },
          {
            ruleId: malicious,
            usefulness: "useful",
            outcome: "retained_revision",
          },
        ],
      },
    } as unknown as PrototypeEvidenceInput;

    const exported = buildPrototypeEvidenceExport(input);
    expect(exported).toMatchObject({
      segment: "unclassified",
      companion: {
        completion: "abandoned",
        returnToDeckOutcome: "not_tested",
      },
      delayedProbe: {
        decision: "undecided",
        evidenceKind: "not_selected",
        rejectionReasons: [],
      },
      questionHealth: {
        counts: { findingsRecorded: 0 },
        rules: [],
      },
    });
    expect(JSON.stringify(exported)).not.toContain(malicious);
  });

  it("rejects internally inconsistent delayed-probe evidence", () => {
    const evaluation = {
      ...evaluateDelayedProbeCandidate({
        source: question(1),
        candidate: question(2, {
          prompt: "Apply habitat change in a new flooding scenario.",
        }),
      }),
      accepted: true,
      overlappingConceptCount: 0,
      rejectionReasons: [],
    };
    const exported = buildPrototypeEvidenceExport({
      segment: "education",
      delayedProbe: {
        durationMs: 1,
        evaluation,
        decision: "would_issue",
        evidenceKind: "personal_paired",
      },
    });

    expect(exported.delayedProbe).toMatchObject({
      candidate: "rejected",
      rejectionReasons: ["no_concept_overlap"],
      counts: { overlappingConcepts: 0 },
    });
  });
});

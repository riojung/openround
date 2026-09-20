import { describe, expect, it } from "vitest";
import type { QuestionDraft } from "@openround/contracts";
import {
  cloneQuestionReuseSelections,
  cloneQuestionsForReuse,
  findQuestionReuseSources,
  normalizeQuestionReuseSelections,
  questionReuseBatchCapacity,
  questionReuseCapacity,
  resolveQuestionsForReuse,
  type QuestionReuseSource,
} from "./question-reuse";

const ids = {
  source: "00000000-0000-4000-8000-000000000001",
  secondSource: "00000000-0000-4000-8000-000000000002",
  main: "10000000-0000-4000-8000-000000000001",
  recheck: "10000000-0000-4000-8000-000000000002",
  numeric: "10000000-0000-4000-8000-000000000003",
  sharedMain: "10000000-0000-4000-8000-000000000004",
  invalidMain: "10000000-0000-4000-8000-000000000005",
  orphanRecheck: "10000000-0000-4000-8000-000000000006",
  foreignMain: "20000000-0000-4000-8000-000000000001",
  missing: "90000000-0000-4000-8000-000000000001",
  media: "30000000-0000-4000-8000-000000000001",
  choiceA: "40000000-0000-4000-8000-000000000001",
  choiceB: "40000000-0000-4000-8000-000000000002",
} as const;

function choiceQuestion(
  input: Partial<QuestionDraft> & Pick<QuestionDraft, "id" | "prompt">,
): QuestionDraft {
  const { id, prompt, ...overrides } = input;
  return {
    id,
    type: "single_select",
    prompt,
    purpose: "diagnostic",
    confidence: "required",
    delivery: "main",
    conceptKeys: ["fractions", "rate-vs-total"],
    linkedRecheckQuestionId: null,
    timeLimitSeconds: 30,
    basePoints: 1_000,
    explanation: "Compare the numerator with the whole.",
    mediaId: ids.media,
    mediaAlt: "A fraction model",
    sourceCitations: [
      {
        sourceName: "Private handbook",
        sourceDigest: "a".repeat(64),
        locator: "p. 4",
        excerpt: "A fraction describes a part relative to a whole.",
      },
    ],
    choices: [
      { id: ids.choiceA, label: "Part over whole", isCorrect: true },
      {
        id: ids.choiceB,
        label: "Part plus whole",
        isCorrect: false,
        misconceptionKey: "fractions.add",
        feedback: "Use a ratio rather than a sum.",
      },
    ],
    ...overrides,
  } as QuestionDraft;
}

function source(): QuestionReuseSource {
  const main = choiceQuestion({
    id: ids.main,
    prompt: "Which fraction represents the shaded area?",
    linkedRecheckQuestionId: ids.recheck,
  });
  const recheck = choiceQuestion({
    id: ids.recheck,
    prompt: "Transfer the fraction model to a new diagram.",
    delivery: "recheck",
    linkedRecheckQuestionId: null,
  });
  const numeric: QuestionDraft = {
    id: ids.numeric,
    type: "numeric",
    prompt: "Calculate the final measurement.",
    purpose: "practice",
    confidence: "optional",
    delivery: "main",
    conceptKeys: ["measurement.delta"],
    linkedRecheckQuestionId: null,
    correctValue: "42",
    tolerance: "0.5",
    unit: "kg",
    timeLimitSeconds: 45,
    basePoints: 900,
    explanation: "Subtract the baseline before rounding.",
    mediaId: null,
    mediaAlt: null,
  };
  const sharedMain = choiceQuestion({
    id: ids.sharedMain,
    prompt: "Which second example uses the same fraction model?",
    linkedRecheckQuestionId: ids.recheck,
  });
  const invalidMain = choiceQuestion({
    id: ids.invalidMain,
    prompt: "Select every safe action.",
    type: "multi_select",
    conceptKeys: ["safety.sequence"],
    linkedRecheckQuestionId: ids.numeric,
  });
  const orphanRecheck = choiceQuestion({
    id: ids.orphanRecheck,
    prompt: "An orphan recheck must not be selected directly.",
    delivery: "recheck",
  });
  return {
    id: ids.source,
    title: "Fraction foundations",
    draft: { questions: [main, recheck, numeric, sharedMain, invalidMain, orphanRecheck] },
  };
}

function secondSource(): QuestionReuseSource {
  return {
    id: ids.secondSource,
    title: "Safety orientation",
    draft: {
      questions: [
        choiceQuestion({
          id: ids.foreignMain,
          prompt: "Which action should happen first?",
          type: "poll",
          purpose: "opinion",
          confidence: "off",
          conceptKeys: ["incident.response"],
          basePoints: 0,
          choices: [
            { id: ids.choiceA, label: "Pause", isCorrect: false },
            { id: ids.choiceB, label: "Continue", isCorrect: false },
          ],
        }),
      ],
    },
  };
}

function sequenceFactory(prefix = "fresh") {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

describe("workspace question reuse", () => {
  it("searches Round titles, prompts, response types, concepts, and paired rechecks", () => {
    const sources = [source(), secondSource()];

    expect(findQuestionReuseSources(sources, "safety")[0]?.candidates).toHaveLength(1);
    expect(
      findQuestionReuseSources(sources, "final measurement")[0]?.candidates[0]?.mainQuestion.id,
    ).toBe(ids.numeric);
    expect(
      findQuestionReuseSources(sources, "multiple select")[0]?.candidates[0]?.mainQuestion.id,
    ).toBe(ids.invalidMain);
    expect(
      findQuestionReuseSources(sources, "rate vs total")[0]?.candidates.map(
        (item) => item.mainQuestion.id,
      ),
    ).toEqual([ids.main, ids.sharedMain]);
    expect(findQuestionReuseSources(sources, "transfer diagram")[0]?.candidates[0]).toMatchObject({
      mainQuestion: { id: ids.main },
      linkedRecheck: { id: ids.recheck },
      includedQuestionCount: 2,
    });
    expect(findQuestionReuseSources(sources, "does not exist")).toEqual([]);
  });

  it("never exposes a recheck as a standalone selection", () => {
    const candidates = findQuestionReuseSources([source()], "")[0]!.candidates;
    expect(candidates.map(({ mainQuestion }) => mainQuestion.id)).toEqual([
      ids.main,
      ids.numeric,
      ids.sharedMain,
      ids.invalidMain,
    ]);
    expect(candidates.some(({ mainQuestion }) => mainQuestion.id === ids.orphanRecheck)).toBe(
      false,
    );
  });

  it("rejects ambiguous source IDs instead of cloning duplicate destination IDs", () => {
    const ambiguous = source();
    const duplicatedMain = {
      ...ambiguous.draft.questions[0]!,
      prompt: "A duplicate source record with the same stable ID.",
    };
    const duplicatedRecheck = {
      ...ambiguous.draft.questions[1]!,
      prompt: "A duplicate recheck record with the same stable ID.",
    };
    ambiguous.draft.questions.splice(1, 0, duplicatedMain);
    ambiguous.draft.questions.splice(3, 0, duplicatedRecheck);

    const candidates = findQuestionReuseSources([ambiguous], "")[0]!.candidates;
    expect(candidates.map(({ mainQuestion }) => mainQuestion.id)).not.toContain(ids.main);
    expect(resolveQuestionsForReuse(ambiguous, [ids.main])).toEqual({
      questions: [],
      selectedMainQuestionCount: 0,
    });
    expect(
      normalizeQuestionReuseSelections(
        [ambiguous],
        [{ sourceQuizId: ambiguous.id, selectedMainQuestionIds: [ids.main] }],
      ),
    ).toEqual([]);
    expect(cloneQuestionsForReuse(ambiguous, [ids.main], sequenceFactory()).questions).toEqual([]);

    const sharedMain = candidates.find(({ mainQuestion }) => mainQuestion.id === ids.sharedMain);
    expect(sharedMain?.linkedRecheck).toBeNull();
    expect(cloneQuestionsForReuse(ambiguous, [ids.sharedMain], sequenceFactory())).toMatchObject({
      includedQuestionCount: 1,
      questions: [{ linkedRecheckQuestionId: null }],
    });
  });

  it("deduplicates selections and shared rechecks while preserving source order", () => {
    const resolved = resolveQuestionsForReuse(source(), [
      ids.sharedMain,
      ids.main,
      ids.main,
      ids.recheck,
      ids.missing,
    ]);

    expect(resolved.selectedMainQuestionCount).toBe(2);
    expect(resolved.questions.map(({ id }) => id)).toEqual([ids.main, ids.recheck, ids.sharedMain]);
  });

  it("creates fresh IDs, remaps valid links, clears invalid links, and preserves metadata", () => {
    const original = source();
    const cloned = cloneQuestionsForReuse(original, [ids.main, ids.invalidMain], sequenceFactory());

    expect(cloned).toMatchObject({
      selectedMainQuestionCount: 2,
      includedQuestionCount: 3,
      firstQuestionId: "fresh-1",
    });
    expect(cloned.questions.map(({ id }) => id)).toEqual(["fresh-1", "fresh-2", "fresh-3"]);
    expect(cloned.questions[0]?.linkedRecheckQuestionId).toBe("fresh-2");
    expect(cloned.questions[1]?.linkedRecheckQuestionId).toBeNull();
    expect(cloned.questions[2]?.linkedRecheckQuestionId).toBeNull();

    const clonedMain = cloned.questions[0]!;
    const originalMain = original.draft.questions[0]!;
    expect(clonedMain).toMatchObject({
      prompt: originalMain.prompt,
      confidence: "required",
      mediaId: ids.media,
      mediaAlt: "A fraction model",
      explanation: "Compare the numerator with the whole.",
    });
    if (!("choices" in clonedMain) || !("choices" in originalMain)) {
      throw new Error("Expected choice questions");
    }
    expect(clonedMain.choices.map(({ id }) => id)).toEqual(["fresh-4", "fresh-5"]);
    expect(clonedMain.choices[1]).toMatchObject({
      misconceptionKey: "fractions.add",
      feedback: "Use a ratio rather than a sum.",
    });
    expect(clonedMain.choices).not.toBe(originalMain.choices);
    expect(clonedMain.choices[0]).not.toBe(originalMain.choices[0]);
    expect(clonedMain.conceptKeys).not.toBe(originalMain.conceptKeys);
    expect(clonedMain.sourceCitations).not.toBe(originalMain.sourceCitations);
    expect(clonedMain.sourceCitations?.[0]).not.toBe(originalMain.sourceCitations?.[0]);

    clonedMain.choices[0]!.label = "Changed copy";
    clonedMain.conceptKeys![0] = "changed-copy";
    clonedMain.sourceCitations![0]!.excerpt = "Changed copy";
    expect(originalMain.choices[0]!.label).toBe("Part over whole");
    expect(originalMain.conceptKeys?.[0]).toBe("fractions");
    expect(originalMain.sourceCitations?.[0]?.excerpt).toBe(
      "A fraction describes a part relative to a whole.",
    );
  });

  it("normalizes and clones multi-Round selections in source order", () => {
    const sources = [secondSource(), source()];
    const selections = [
      { sourceQuizId: ids.source, selectedMainQuestionIds: [ids.numeric, ids.main] },
      {
        sourceQuizId: ids.secondSource,
        selectedMainQuestionIds: [ids.foreignMain, ids.foreignMain],
      },
      { sourceQuizId: ids.source, selectedMainQuestionIds: [ids.recheck, ids.main] },
      { sourceQuizId: ids.missing, selectedMainQuestionIds: [ids.main] },
    ];

    expect(normalizeQuestionReuseSelections(sources, selections)).toEqual([
      { sourceQuizId: ids.secondSource, selectedMainQuestionIds: [ids.foreignMain] },
      { sourceQuizId: ids.source, selectedMainQuestionIds: [ids.main, ids.numeric] },
    ]);
    const cloned = cloneQuestionReuseSelections(sources, selections, sequenceFactory("batch"));
    expect(cloned.selectedMainQuestionCount).toBe(3);
    expect(cloned.includedQuestionCount).toBe(4);
    expect(cloned.questions.map(({ prompt }) => prompt)).toEqual([
      "Which action should happen first?",
      "Which fraction represents the shaded area?",
      "Transfer the fraction model to a new diagram.",
      "Calculate the final measurement.",
    ]);
    expect(new Set(cloned.questions.map(({ id }) => id)).size).toBe(4);
  });

  it("reports capacity including automatically paired and deduplicated rechecks", () => {
    const selected = [ids.main, ids.sharedMain];
    expect(questionReuseCapacity(source(), selected, 197)).toMatchObject({
      remainingQuestionCount: 3,
      selectedMainQuestionCount: 2,
      includedQuestionCount: 3,
      pairedRecheckCount: 1,
      remainingAfterReuse: 0,
      fits: true,
      message: "Adds 3 questions (2 selected questions, 1 paired recheck). 0 slots will remain.",
    });
    expect(questionReuseCapacity(source(), selected, 198)).toMatchObject({
      fits: false,
      message: "Select fewer questions. This selection adds 3, but only 2 slots remain.",
    });
    expect(questionReuseCapacity(source(), [], 190).message).toBe("10 question slots available.");
    expect(questionReuseCapacity(source(), [ids.main], 250).message).toBe(
      "This Round has reached its 200 questions limit.",
    );
  });

  it("reports one capacity result for a batch spanning multiple Rounds", () => {
    const sources = [source(), secondSource()];
    const selections = [
      { sourceQuizId: ids.secondSource, selectedMainQuestionIds: [ids.foreignMain] },
      { sourceQuizId: ids.source, selectedMainQuestionIds: [ids.main] },
    ];
    expect(questionReuseBatchCapacity(sources, selections, 196)).toMatchObject({
      selectedMainQuestionCount: 2,
      includedQuestionCount: 3,
      pairedRecheckCount: 1,
      remainingAfterReuse: 1,
      fits: true,
    });
  });
});

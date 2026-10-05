import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CreateRecoveryPackSchema,
  InsertRecoveryPackSchema,
  PublishRecoveryPackSchema,
  QuestionDraftSchema,
  QuestionSchema,
  QuizContentSchema,
  QuizDraftSchema,
  RecoveryPackContentSchema,
  RecoveryPackDraftSchema,
  RecoveryPackJsonSchema,
  RecoveryPackSourceSchema,
  UpdateRecoveryPackSchema,
  type RecoveryPackDraft,
} from "../src/index.js";

const contentHash = "a".repeat(64);
const sourceCitation = {
  sourceName: "Safety handbook",
  sourceDigest: "b".repeat(64),
  locator: "Section 2",
  excerpt: "Physically isolate hazardous energy before maintenance.",
};

function question(prompt: string) {
  return {
    id: randomUUID(),
    type: "single_select" as const,
    prompt,
    purpose: "practice" as const,
    confidence: "optional" as const,
    delivery: "main" as const,
    conceptKeys: ["hazardous-energy"],
    linkedRecheckQuestionId: null as string | null,
    timeLimitSeconds: 30,
    basePoints: 1_000,
    explanation: "A warning sign does not physically isolate hazardous energy.",
    mediaId: null,
    mediaAlt: null,
    sourceCitations: [sourceCitation],
    choices: [
      { id: randomUUID(), label: "Isolate the energy source", isCorrect: true },
      { id: randomUUID(), label: "Post a warning sign", isCorrect: false },
    ],
  };
}

function pack(): RecoveryPackDraft {
  const recheck = {
    ...question("How would you make this maintenance scenario safe?"),
    delivery: "recheck" as const,
  };
  return {
    schemaVersion: 1,
    title: "Hazardous energy recovery",
    description: "Diagnose and recheck physical isolation.",
    diagnostic: {
      ...question("Which action physically isolates hazardous energy?"),
      purpose: "diagnostic",
      linkedRecheckQuestionId: recheck.id,
    },
    interventions: [
      {
        id: randomUUID(),
        title: "Warning is not isolation",
        body: "Contrast a warning sign with a physical lockout device.",
        citations: [sourceCitation],
      },
    ],
    recheck,
    delayedProbe: question("What must happen before repairing this energy-powered machine?"),
    conceptKeys: ["hazardous-energy"],
    misconceptionKeys: ["warning-is-isolation"],
    citations: [sourceCitation],
  };
}

function provenance() {
  return {
    artifactType: "recovery_pack" as const,
    packId: randomUUID(),
    packVersionId: randomUUID(),
    packVersion: 2,
    sourceItemId: randomUUID(),
    role: "diagnostic" as const,
    contentHash,
  };
}

describe("Recovery Pack authoring and publication contracts", () => {
  it("accepts an immutable recovery topology with cited interventions and an optional delayed probe", () => {
    const draft = pack();
    expect(RecoveryPackContentSchema.parse(draft)).toEqual(draft);
    expect(
      RecoveryPackContentSchema.parse({ ...draft, delayedProbe: null }).delayedProbe,
    ).toBeNull();
  });

  it("stores incomplete bounded draft checkpoints without treating them as publishable", () => {
    const draft = pack();
    draft.title = "";
    draft.diagnostic.prompt = "";
    if ("choices" in draft.diagnostic) {
      draft.diagnostic.choices = draft.diagnostic.choices.map((choice) => ({
        ...choice,
        label: "",
        isCorrect: false,
      }));
    }
    draft.interventions = [];
    draft.conceptKeys = [];
    expect(RecoveryPackDraftSchema.safeParse(draft).success).toBe(true);
    expect(CreateRecoveryPackSchema.safeParse({ draft }).success).toBe(true);
    expect(RecoveryPackContentSchema.safeParse(draft).success).toBe(false);
  });

  it("permits incomplete intervention text in a draft but blocks publication", () => {
    const draft = pack();
    draft.interventions[0] = { ...draft.interventions[0]!, title: "", body: "" };
    expect(RecoveryPackDraftSchema.safeParse(draft).success).toBe(true);
    expect(RecoveryPackContentSchema.safeParse(draft).success).toBe(false);
  });

  it.each([
    ["title", (draft: RecoveryPackDraft) => ({ ...draft, title: "x".repeat(161) })],
    ["description", (draft: RecoveryPackDraft) => ({ ...draft, description: "x".repeat(1_001) })],
    [
      "intervention count",
      (draft: RecoveryPackDraft) => ({
        ...draft,
        interventions: Array.from({ length: 6 }, () => ({
          ...draft.interventions[0]!,
          id: randomUUID(),
        })),
      }),
    ],
    [
      "intervention body",
      (draft: RecoveryPackDraft) => ({
        ...draft,
        interventions: [{ ...draft.interventions[0]!, body: "x".repeat(2_001) }],
      }),
    ],
    [
      "concept count",
      (draft: RecoveryPackDraft) => ({
        ...draft,
        conceptKeys: Array.from({ length: 13 }, (_, index) => `concept-${index}`),
      }),
    ],
    [
      "citation count",
      (draft: RecoveryPackDraft) => ({
        ...draft,
        citations: Array.from({ length: 21 }, () => sourceCitation),
      }),
    ],
  ])("bounds %s even for unfinished drafts", (_name, mutation) => {
    expect(RecoveryPackDraftSchema.safeParse(mutation(pack())).success).toBe(false);
  });

  it.each([
    [
      "diagnostic delivery",
      (draft: RecoveryPackDraft) => ({
        ...draft,
        diagnostic: { ...draft.diagnostic, delivery: "recheck" },
      }),
    ],
    [
      "diagnostic purpose",
      (draft: RecoveryPackDraft) => ({
        ...draft,
        diagnostic: { ...draft.diagnostic, purpose: "practice" },
      }),
    ],
    [
      "missing link",
      (draft: RecoveryPackDraft) => ({
        ...draft,
        diagnostic: { ...draft.diagnostic, linkedRecheckQuestionId: null },
      }),
    ],
    [
      "wrong link",
      (draft: RecoveryPackDraft) => ({
        ...draft,
        diagnostic: { ...draft.diagnostic, linkedRecheckQuestionId: randomUUID() },
      }),
    ],
    [
      "recheck delivery",
      (draft: RecoveryPackDraft) => ({ ...draft, recheck: { ...draft.recheck, delivery: "main" } }),
    ],
    [
      "recheck chaining",
      (draft: RecoveryPackDraft) => ({
        ...draft,
        recheck: { ...draft.recheck, linkedRecheckQuestionId: randomUUID() },
      }),
    ],
    [
      "delayed delivery",
      (draft: RecoveryPackDraft) => ({
        ...draft,
        delayedProbe: { ...draft.delayedProbe!, delivery: "recheck" },
      }),
    ],
    [
      "delayed link",
      (draft: RecoveryPackDraft) => ({
        ...draft,
        delayedProbe: { ...draft.delayedProbe!, linkedRecheckQuestionId: draft.recheck.id },
      }),
    ],
  ])("rejects invalid published %s", (_name, mutation) => {
    expect(RecoveryPackContentSchema.safeParse(mutation(pack())).success).toBe(false);
  });

  it.each(["diagnostic", "recheck", "delayedProbe"] as const)(
    "requires the %s to share a Pack concept",
    (role) => {
      const draft = pack();
      const item = draft[role]!;
      expect(
        RecoveryPackContentSchema.safeParse({
          ...draft,
          [role]: { ...item, conceptKeys: ["unrelated-concept"] },
        }).success,
      ).toBe(false);
      expect(
        RecoveryPackContentSchema.safeParse({ ...draft, [role]: { ...item, conceptKeys: [] } })
          .success,
      ).toBe(false);
      expect(
        RecoveryPackContentSchema.safeParse({
          ...draft,
          [role]: { ...item, conceptKeys: ["unrelated-concept", ...draft.conceptKeys] },
        }).success,
      ).toBe(true);
    },
  );

  it("rejects duplicated question or intervention item IDs", () => {
    const draft = pack();
    expect(
      RecoveryPackContentSchema.safeParse({
        ...draft,
        interventions: [{ ...draft.interventions[0]!, id: draft.diagnostic.id }],
      }).success,
    ).toBe(false);
    expect(
      RecoveryPackContentSchema.safeParse({
        ...draft,
        delayedProbe: { ...draft.delayedProbe!, id: draft.recheck.id },
      }).success,
    ).toBe(false);
    expect(
      RecoveryPackContentSchema.safeParse({
        ...draft,
        interventions: [draft.interventions[0]!, draft.interventions[0]!],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicated choice IDs within every checkpoint", () => {
    const draft = pack();
    for (const role of ["diagnostic", "recheck", "delayedProbe"] as const) {
      const item = draft[role]!;
      if (!("choices" in item)) throw new Error("Expected a choice checkpoint");
      const choices = item.choices.map((choice) => ({ ...choice, id: item.choices[0]!.id }));
      expect(
        RecoveryPackContentSchema.safeParse({ ...draft, [role]: { ...item, choices } }).success,
      ).toBe(false);
    }
  });

  it("rejects normalized copies of diagnostic or immediate recheck prompts", () => {
    const draft = pack();
    const equivalentPrompt = `  ${draft.diagnostic.prompt.toUpperCase().replaceAll(" ", "   ")}  `;
    expect(
      RecoveryPackContentSchema.safeParse({
        ...draft,
        recheck: { ...draft.recheck, prompt: equivalentPrompt },
      }).success,
    ).toBe(false);
    expect(
      RecoveryPackContentSchema.safeParse({
        ...draft,
        delayedProbe: { ...draft.delayedProbe!, prompt: equivalentPrompt },
      }).success,
    ).toBe(false);
    expect(
      RecoveryPackContentSchema.safeParse({
        ...draft,
        delayedProbe: { ...draft.delayedProbe!, prompt: draft.recheck.prompt },
      }).success,
    ).toBe(false);
  });

  it("normalizes Unicode compatibility characters before comparing transfer prompts", () => {
    const draft = pack();
    draft.diagnostic.prompt = "Select A";
    draft.recheck.prompt = "Ｓｅｌｅｃｔ Ａ";
    expect(RecoveryPackContentSchema.safeParse(draft).success).toBe(false);
  });

  it.each(["diagnostic", "recheck", "delayedProbe"] as const)(
    "rejects nested Pack provenance on the %s source item",
    (role) => {
      const draft = pack();
      expect(
        RecoveryPackContentSchema.safeParse({
          ...draft,
          [role]: { ...draft[role]!, recoveryPackSource: provenance() },
        }).success,
      ).toBe(false);
    },
  );

  it.each(["poll", "rating"] as const)("rejects %s checkpoints in recovery content", (type) => {
    const draft = pack();
    const common = { ...draft.recheck, type, purpose: "opinion", confidence: "off", basePoints: 0 };
    const recheck =
      type === "poll"
        ? {
            ...common,
            choices: question("Unused").choices.map((choice) => ({ ...choice, isCorrect: false })),
          }
        : { ...common, min: 1, max: 5, minLabel: "Low", maxLabel: "High" };
    // Each item is otherwise a valid question, isolating the Recovery-specific format rule.
    expect(QuestionSchema.safeParse(recheck).success).toBe(true);
    expect(RecoveryPackContentSchema.safeParse({ ...draft, recheck }).success).toBe(false);
  });

  it.each(["single_select", "true_false", "multi_select", "numeric"] as const)(
    "permits the scored %s recovery format",
    (type) => {
      const draft = pack();
      const recheck =
        type === "numeric"
          ? { ...draft.recheck, type, correctValue: "10", tolerance: "0", unit: null }
          : { ...draft.recheck, type };
      expect(RecoveryPackContentSchema.safeParse({ ...draft, recheck }).success).toBe(true);
    },
  );
});

describe("Recovery Pack provenance and interchange contracts", () => {
  it("preserves source metadata in draft and published checkpoint parsing", () => {
    const source = provenance();
    const item = { ...question("Which action isolates energy?"), recoveryPackSource: source };
    expect(QuestionDraftSchema.parse(item).recoveryPackSource).toEqual(source);
    expect(QuestionSchema.parse(item).recoveryPackSource).toEqual(source);
  });

  it("preserves copied source metadata and frozen baselines in Round draft and content parsing", () => {
    const content = RecoveryPackContentSchema.parse(pack());
    const source = provenance();
    const diagnostic = {
      ...content.diagnostic,
      recoveryPackSource: { ...source, sourceItemId: content.diagnostic.id },
    };
    const recheck = {
      ...content.recheck,
      recoveryPackSource: { ...source, role: "recheck" as const, sourceItemId: content.recheck.id },
    };
    const insertion = {
      id: randomUUID(),
      packId: source.packId,
      packVersionId: source.packVersionId,
      packVersion: source.packVersion,
      contentHash,
      diagnosticQuestionId: diagnostic.id,
      recheckQuestionId: recheck.id,
      originalContent: content,
    };
    const round = {
      title: "Round",
      description: "",
      questions: [diagnostic, recheck],
      recoveryPackInsertions: [insertion],
    };
    for (const schema of [QuizDraftSchema, QuizContentSchema]) {
      const parsed = schema.parse(round);
      expect(parsed.questions[0]!.recoveryPackSource).toEqual(diagnostic.recoveryPackSource);
      expect(parsed.questions[1]!.recoveryPackSource).toEqual(recheck.recoveryPackSource);
      expect(parsed.recoveryPackInsertions).toEqual([insertion]);
    }
  });

  it("continues parsing legacy Rounds without adding Pack metadata", () => {
    const legacy = {
      title: "Existing Round",
      questions: [question("Which action isolates energy?")],
    };
    for (const schema of [QuizDraftSchema, QuizContentSchema]) {
      const parsed = schema.parse(legacy);
      expect(parsed.recoveryPackInsertions).toBeUndefined();
      expect(parsed.questions[0]!.recoveryPackSource).toBeUndefined();
      expect(parsed.description).toBe("");
    }
  });

  it("round-trips all Pack content through the versioned native JSON envelope", () => {
    const content = RecoveryPackContentSchema.parse(pack());
    const exported = { format: "openround-recovery-pack", schemaVersion: 1, content };
    const parsed = RecoveryPackJsonSchema.parse(JSON.parse(JSON.stringify(exported)));
    expect(parsed).toEqual(exported);
    expect(parsed.content.citations).toEqual([sourceCitation]);
    expect(parsed.content.interventions[0]!.citations).toEqual([sourceCitation]);
    expect(parsed.content.delayedProbe).toEqual(content.delayedProbe);
  });

  it("rejects unsupported interchange and provenance versions", () => {
    const content = RecoveryPackContentSchema.parse(pack());
    expect(
      RecoveryPackJsonSchema.safeParse({
        format: "openround-recovery-pack",
        schemaVersion: 2,
        content,
      }).success,
    ).toBe(false);
    expect(
      RecoveryPackJsonSchema.safeParse({ format: "qti", schemaVersion: 1, content }).success,
    ).toBe(false);
    expect(RecoveryPackSourceSchema.safeParse({ ...provenance(), packVersion: 0 }).success).toBe(
      false,
    );
    expect(
      RecoveryPackSourceSchema.safeParse({ ...provenance(), contentHash: "not-a-digest" }).success,
    ).toBe(false);
    expect(
      RecoveryPackSourceSchema.safeParse({ ...provenance(), role: "intervention" }).success,
    ).toBe(false);
  });
});

describe("Recovery Pack mutation envelopes", () => {
  it("requires revision fences and idempotency IDs for draft updates and insertion", () => {
    const update = { draft: pack(), expectedRevision: 0, mutationId: randomUUID() };
    const insert = {
      packVersionId: randomUUID(),
      quizId: randomUUID(),
      expectedRevision: 3,
      mutationId: randomUUID(),
    };
    expect(UpdateRecoveryPackSchema.parse(update)).toEqual(update);
    expect(InsertRecoveryPackSchema.parse(insert)).toEqual(insert);
    expect(UpdateRecoveryPackSchema.safeParse({ ...update, expectedRevision: -1 }).success).toBe(
      false,
    );
    expect(
      UpdateRecoveryPackSchema.safeParse({ draft: update.draft, expectedRevision: 0 }).success,
    ).toBe(false);
    expect(InsertRecoveryPackSchema.safeParse({ ...insert, mutationId: "retry" }).success).toBe(
      false,
    );
    expect(InsertRecoveryPackSchema.safeParse({ ...insert, expectedRevision: 1.5 }).success).toBe(
      false,
    );
  });

  it("fences publication against the intended draft revision", () => {
    expect(PublishRecoveryPackSchema.parse({ expectedDraftRevision: 4 })).toEqual({
      expectedDraftRevision: 4,
    });
    expect(PublishRecoveryPackSchema.safeParse({}).success).toBe(false);
    expect(PublishRecoveryPackSchema.safeParse({ expectedDraftRevision: -1 }).success).toBe(false);
  });
});

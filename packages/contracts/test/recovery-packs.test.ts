import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CreateRecoveryPackSchema,
  ApplySourceRecoveryPackSchema,
  ApproveRecoveryPackSourceSchema,
  AuthoringDraftSchema,
  RecoveryPackSourceProposalSchema,
  RecoveryPackSourceReviewSchema,
  InsertRecoveryPackSchema,
  OpenRoundCheckpointSetExportSchema,
  PublishRecoveryPackSchema,
  QuestionDraftSchema,
  QuestionSchema,
  QuizContentSchema,
  QuizDraftSchema,
  RecoveryPackContentSchema,
  RecoveryPackDraftSchema,
  RecoveryPackInsertionSchema,
  RecoveryPackJsonSchema,
  RecoveryPackSourceSchema,
  UpdateRecoveryPackSchema,
  recoveryPackContentHash,
  authoringDraftContentHash,
  type RecoveryPackContent,
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

function insertion(content = RecoveryPackContentSchema.parse(pack())) {
  return {
    id: randomUUID(),
    packId: randomUUID(),
    packVersionId: randomUUID(),
    packVersion: 1,
    contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
    diagnosticQuestionId: randomUUID(),
    recheckQuestionId: randomUUID(),
    originalContent: content,
  };
}

function reversePropertyOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversePropertyOrder);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, item]) => [key, reversePropertyOrder(item)]),
    );
  }
  return value;
}

describe("Recovery Pack authoring and publication contracts", () => {
  it("binds source proposals and review requests to complete canonical content with strict hashes and intent", () => {
    const draft = RecoveryPackContentSchema.parse(pack());
    const expectedContentHash = recoveryPackContentHash(draft);
    const proposal = {
      schemaVersion: 1,
      authoringJobId: randomUUID(),
      sourceName: sourceCitation.sourceName,
      sourceDigest: sourceCitation.sourceDigest,
      sourceOutputHash: contentHash,
      contentHash: expectedContentHash,
      draft,
      conversionNotes: ["Review the linked recheck."],
    };
    expect(RecoveryPackSourceProposalSchema.parse(proposal)).toEqual(proposal);
    expect(RecoveryPackSourceProposalSchema.safeParse({ ...proposal, contentHash }).success).toBe(
      false,
    );
    expect(
      RecoveryPackSourceProposalSchema.safeParse({
        ...proposal,
        conversionNotes: Array(11).fill("Note"),
      }).success,
    ).toBe(false);
    const apply = {
      draft,
      sourceOutputHash: contentHash,
      expectedContentHash,
      mutationId: randomUUID(),
    };
    const approval = {
      expectedDraftRevision: 0,
      expectedContentHash,
      sourceDigest: sourceCitation.sourceDigest,
      sourceOutputHash: contentHash,
      mutationId: randomUUID(),
      approveContent: true,
      approveCitations: true,
    };
    expect(ApplySourceRecoveryPackSchema.parse(apply)).toEqual(apply);
    expect(ApproveRecoveryPackSourceSchema.parse(approval)).toEqual(approval);
    for (const malformed of ["abc", "G".repeat(64), "A".repeat(64), "a".repeat(65)]) {
      expect(
        ApplySourceRecoveryPackSchema.safeParse({ ...apply, sourceOutputHash: malformed }).success,
      ).toBe(false);
      expect(
        ApproveRecoveryPackSourceSchema.safeParse({ ...approval, expectedContentHash: malformed })
          .success,
      ).toBe(false);
    }
    expect(
      ApplySourceRecoveryPackSchema.safeParse({ ...apply, approveContent: true }).success,
    ).toBe(false);
    expect(
      ApproveRecoveryPackSourceSchema.safeParse({ ...approval, approveCitations: false }).success,
    ).toBe(false);
    expect(
      ApproveRecoveryPackSourceSchema.safeParse({ ...approval, expectedDraftRevision: -1 }).success,
    ).toBe(false);
    expect(
      ApproveRecoveryPackSourceSchema.safeParse({ ...approval, reviewer: randomUUID() }).success,
    ).toBe(false);
    const review = {
      schemaVersion: 1,
      authoringJobId: proposal.authoringJobId,
      sourceName: proposal.sourceName,
      sourceDigest: proposal.sourceDigest,
      sourceOutputHash: contentHash,
      contentHash: expectedContentHash,
      approvedContentHash: null,
      approvedDraftRevision: null,
      approvedAt: null,
      approved: false,
    };
    expect(RecoveryPackSourceReviewSchema.parse(review)).toEqual(review);
    expect(
      RecoveryPackSourceReviewSchema.safeParse({ ...review, citationCatalog: [sourceCitation] })
        .success,
    ).toBe(false);
    expect(RecoveryPackContentSchema.parse({ ...draft, sourceReview: review })).toEqual(draft);
    expect(
      RecoveryPackJsonSchema.parse({
        format: "openround-recovery-pack",
        schemaVersion: 1,
        content: draft,
      }),
    ).not.toHaveProperty("sourceReview");
  });

  it("canonicalizes authoring output for source-output binding after JSONB property reordering", () => {
    const draft = pack();
    const output = AuthoringDraftSchema.parse({
      schemaVersion: 1,
      sourceName: sourceCitation.sourceName,
      sourceDigest: sourceCitation.sourceDigest,
      checkpointSet: {
        title: "Source checkpoints",
        description: "",
        questions: [draft.diagnostic, draft.recheck],
      },
      citations: [draft.diagnostic, draft.recheck].map((item) => ({
        checkpointId: item.id,
        locator: sourceCitation.locator,
        excerpt: sourceCitation.excerpt,
      })),
      generatedAt: new Date().toISOString(),
      provider: "test",
      model: "test",
      conversionNotes: ["Review source"],
    });
    expect(authoringDraftContentHash(reversePropertyOrder(output))).toBe(
      authoringDraftContentHash(output),
    );
    expect(authoringDraftContentHash({ ...output, sourceName: "Different source" })).not.toBe(
      authoringDraftContentHash(output),
    );
    expect(() => authoringDraftContentHash({ ...output, schemaVersion: 2 })).toThrow();
  });

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
      contentHash: recoveryPackContentHash(content),
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

describe("Recovery Pack insertion baseline integrity", () => {
  it("matches the existing Node publication hash for strict parsed content and UTF-8 text", () => {
    const draft = pack();
    draft.title = "回復 🧠 — café";
    draft.interventions[0]!.body = "Évidence: compare the same units. \u{1F9E0}";
    const content = RecoveryPackContentSchema.parse(draft);
    const snapshot = insertion(content);
    expect(recoveryPackContentHash(content)).toBe(snapshot.contentHash);
    expect(RecoveryPackInsertionSchema.parse(snapshot)).toEqual(snapshot);
  });

  it.each([
    [
      "intervention body",
      (content: RecoveryPackContent) => {
        content.interventions[0]!.body = "Altered baseline instruction";
      },
    ],
    [
      "diagnostic prompt",
      (content: RecoveryPackContent) => {
        content.diagnostic.prompt = "An altered diagnostic prompt?";
      },
    ],
    [
      "recheck explanation",
      (content: RecoveryPackContent) => {
        content.recheck.explanation = "Altered answer rationale";
      },
    ],
    [
      "delayed probe",
      (content: RecoveryPackContent) => {
        content.delayedProbe!.prompt = "An altered delayed transfer scenario?";
      },
    ],
    [
      "source item ID",
      (content: RecoveryPackContent) => {
        content.interventions[0]!.id = randomUUID();
      },
    ],
    [
      "citation excerpt",
      (content: RecoveryPackContent) => {
        content.citations[0]!.excerpt = "An altered cited excerpt.";
      },
    ],
  ])("rejects a changed %s carrying the previous published hash", (_name, alter) => {
    const snapshot = insertion();
    const changed = structuredClone(snapshot.originalContent);
    alter(changed);
    // Isolate digest validation: the altered content still meets all publication rules.
    expect(RecoveryPackContentSchema.safeParse(changed).success).toBe(true);
    const result = RecoveryPackInsertionSchema.safeParse({ ...snapshot, originalContent: changed });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual([
        expect.objectContaining({
          path: ["contentHash"],
          message: "The Recovery Pack baseline does not match its content hash",
        }),
      ]);
    }
    for (const schema of [QuizDraftSchema, QuizContentSchema]) {
      expect(
        schema.safeParse({
          title: "Round",
          questions: [question("Diagnostic?")],
          recoveryPackInsertions: [{ ...snapshot, originalContent: changed }],
        }).success,
      ).toBe(false);
    }
  });

  it("normalizes object property ordering without changing published hash semantics", () => {
    const snapshot = insertion();
    const reordered = reversePropertyOrder(snapshot.originalContent);
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(snapshot.originalContent));
    expect(recoveryPackContentHash(reordered)).toBe(snapshot.contentHash);
    expect(RecoveryPackInsertionSchema.parse({ ...snapshot, originalContent: reordered })).toEqual(
      snapshot,
    );
  });

  it("hashes schema defaults and trimmed text exactly as publication does", () => {
    const content = RecoveryPackContentSchema.parse(pack());
    const withDefaultedFields = {
      ...content,
      title: `  ${content.title}  `,
      schemaVersion: undefined,
      description: undefined,
      misconceptionKeys: undefined,
      citations: undefined,
      delayedProbe: undefined,
    };
    const parsed = RecoveryPackContentSchema.parse(withDefaultedFields);
    const snapshot = insertion(parsed);
    expect(recoveryPackContentHash(withDefaultedFields)).toBe(snapshot.contentHash);
    expect(
      RecoveryPackInsertionSchema.parse({ ...snapshot, originalContent: withDefaultedFields })
        .originalContent,
    ).toEqual(parsed);
  });

  it("round-trips valid snapshots through native v3 JSON, including reordered JSONB-like objects", () => {
    const snapshot = insertion();
    const checkpointSet = {
      title: "Round",
      questions: [question("Diagnostic?")],
      recoveryPackInsertions: [snapshot],
    };
    const exported = OpenRoundCheckpointSetExportSchema.parse({
      format: "openround.checkpoint-set",
      version: 3,
      exportedAt: new Date().toISOString(),
      checkpointSet,
    });
    expect(
      OpenRoundCheckpointSetExportSchema.parse(
        reversePropertyOrder(JSON.parse(JSON.stringify(exported))),
      ),
    ).toEqual(exported);
  });

  it("checks baseline integrity without claiming external source identity or approval verification", () => {
    const snapshot = insertion();
    expect(
      RecoveryPackInsertionSchema.parse({
        ...snapshot,
        packId: randomUUID(),
        packVersionId: randomUUID(),
      }).originalContent,
    ).toEqual(snapshot.originalContent);
    expect(() =>
      recoveryPackContentHash({ ...snapshot.originalContent, interventions: [] }),
    ).toThrow();
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

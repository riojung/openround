import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  InsertRecoveryPackIntoPresentationSchema,
  PresentationContentSchema,
  PresentationDraftMutationSchema,
  PresentationDraftSchema,
  QuizContentSchema,
  QuizDraftSchema,
  RecoveryPackContentSchema,
  RecoveryPackInsertionSchema,
  migratePresentationV1,
  recoveryPackContentHash,
  type PresentationDraft,
  type Question,
  type RecoveryPackContent,
} from "../src/index.js";

const citation = {
  sourceName: "Maintenance handbook",
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
    sourceCitations: [citation],
    choices: [
      { id: randomUUID(), label: "Isolate the energy source", isCorrect: true },
      { id: randomUUID(), label: "Post a warning sign", isCorrect: false },
    ],
  };
}

function pack(): RecoveryPackContent {
  const recheck = {
    ...question("How would you make this maintenance scenario safe?"),
    delivery: "recheck" as const,
  };
  return RecoveryPackContentSchema.parse({
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
        citations: [citation],
      },
    ],
    recheck,
    delayedProbe: question("What must happen before repairing this energy-powered machine?"),
    conceptKeys: ["hazardous-energy"],
    misconceptionKeys: ["warning-is-isolation"],
    citations: [citation],
  });
}

function presentation(): PresentationDraft {
  const originalContent = pack();
  const insertion = RecoveryPackInsertionSchema.parse({
    id: randomUUID(),
    packId: randomUUID(),
    packVersionId: randomUUID(),
    packVersion: 1,
    contentHash: recoveryPackContentHash(originalContent),
    diagnosticQuestionId: randomUUID(),
    recheckQuestionId: randomUUID(),
    originalContent,
  });
  const copy = (role: "diagnostic" | "recheck"): Question => {
    const source = originalContent[role];
    const destination = structuredClone(source);
    destination.id =
      role === "diagnostic" ? insertion.diagnosticQuestionId : insertion.recheckQuestionId;
    destination.linkedRecheckQuestionId =
      role === "diagnostic" ? insertion.recheckQuestionId : null;
    if ("choices" in destination) {
      destination.choices = destination.choices.map((choice) => ({ ...choice, id: randomUUID() }));
    }
    destination.recoveryPackSource = {
      artifactType: "recovery_pack",
      packId: insertion.packId,
      packVersionId: insertion.packVersionId,
      packVersion: insertion.packVersion,
      contentHash: insertion.contentHash,
      sourceItemId: source.id,
      role,
    };
    return destination;
  };
  return PresentationDraftSchema.parse({
    title: "Recovery lecture",
    schemaVersion: 3,
    recoveryPackInsertions: [insertion],
    blocks: [
      { id: randomUUID(), kind: "question", question: copy("diagnostic") },
      { id: randomUUID(), kind: "question", question: copy("recheck") },
    ],
  });
}

function checkpoint(draft: PresentationDraft, index: number) {
  const block = draft.blocks[index];
  if (block?.kind !== "question") throw new Error("Expected a checkpoint");
  return block.question;
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

describe("Recovery Packs in versioned Presentations", () => {
  it("retains immutable Pack context, remapped question provenance, and accepted baselines", () => {
    const draft = presentation();
    const insertion = draft.recoveryPackInsertions![0]!;
    const latest = structuredClone(insertion.originalContent);
    latest.interventions[0]!.body = "Compare a tagged switch with a physically locked isolator.";
    insertion.updateBaseline = {
      packVersionId: randomUUID(),
      packVersion: 2,
      contentHash: recoveryPackContentHash(latest),
      content: latest,
    };
    const parsed = PresentationContentSchema.parse(JSON.parse(JSON.stringify(draft)));
    expect(parsed).toEqual(draft);
    expect(parsed.recoveryPackInsertions![0]!.originalContent.interventions[0]!.citations).toEqual([
      citation,
    ]);
    expect(parsed.recoveryPackInsertions![0]!.originalContent.delayedProbe).not.toBeNull();
    expect(checkpoint(draft, 0).recoveryPackSource).toMatchObject({
      artifactType: "recovery_pack",
      sourceItemId: insertion.originalContent.diagnostic.id,
      role: "diagnostic",
    });
    expect(checkpoint(draft, 0).id).not.toBe(insertion.originalContent.diagnostic.id);
    expect(checkpoint(draft, 0).linkedRecheckQuestionId).toBe(insertion.recheckQuestionId);
  });

  it("keeps ordinary and legacy documents at v2 and preserves already-current v3 recovery", () => {
    const ordinary = { title: "Ordinary deck", blocks: [] };
    expect(PresentationDraftSchema.parse(ordinary).schemaVersion).toBe(2);
    expect(
      PresentationDraftSchema.parse(migratePresentationV1({ ...ordinary, schemaVersion: 1 }))
        .schemaVersion,
    ).toBe(2);
    const draft = presentation();
    expect(migratePresentationV1(draft)).toEqual(draft);
    expect(PresentationDraftSchema.parse(migratePresentationV1(draft))).toEqual(draft);
    // The historical embedded-version guard rejects Pack-bearing documents instead of stripping them.
    const historicalVersionGuard = z.object({ schemaVersion: z.literal(2) });
    expect(historicalVersionGuard.safeParse(draft).success).toBe(false);
    expect(historicalVersionGuard.safeParse({ ...ordinary, schemaVersion: 2 }).success).toBe(true);
  });

  it("rejects new frozen baselines on v2, including the ordinary draft default", () => {
    const draft = presentation();
    expect(PresentationDraftSchema.safeParse({ ...draft, schemaVersion: 2 }).success).toBe(false);
    expect(PresentationContentSchema.safeParse({ ...draft, schemaVersion: 2 }).success).toBe(false);
    const withoutVersion: Partial<PresentationDraft> = { ...draft };
    delete withoutVersion.schemaVersion;
    expect(PresentationDraftSchema.safeParse(withoutVersion).success).toBe(false);
  });

  it("retains provenance-only v2 Round imports in drafts, publications, and browser recovery", () => {
    const draft = presentation();
    const sourceOnly = {
      ...draft,
      schemaVersion: 2 as const,
      recoveryPackInsertions: undefined,
    };
    expect(PresentationDraftSchema.parse(sourceOnly)).toEqual(sourceOnly);
    expect(PresentationContentSchema.parse(sourceOnly)).toEqual(sourceOnly);
    expect(PresentationDraftSchema.parse(migratePresentationV1(sourceOnly))).toEqual(sourceOnly);
    expect(PresentationContentSchema.parse(migratePresentationV1(sourceOnly))).toEqual(sourceOnly);
    expect(checkpoint(sourceOnly, 0).recoveryPackSource).toEqual(
      checkpoint(draft, 0).recoveryPackSource,
    );
    expect(PresentationContentSchema.safeParse({ ...sourceOnly, schemaVersion: 3 }).success).toBe(
      true,
    );
  });

  it("keeps the v2 draft mutation envelope independent from embedded artifact v3", () => {
    const mutation = {
      schemaVersion: 2,
      mutationId: randomUUID(),
      expectedRevision: 7,
      draft: presentation(),
    };
    expect(PresentationDraftMutationSchema.parse(mutation).draft.schemaVersion).toBe(3);
    expect(
      PresentationDraftMutationSchema.safeParse({ ...mutation, schemaVersion: 3 }).success,
    ).toBe(false);
  });

  it("validates insertion request fencing and defaults insertion at the beginning", () => {
    const request = {
      packVersionId: randomUUID(),
      expectedRevision: 0,
      mutationId: randomUUID(),
    };
    expect(InsertRecoveryPackIntoPresentationSchema.parse(request)).toEqual({
      ...request,
      afterBlockId: null,
    });
    const afterBlockId = randomUUID();
    expect(InsertRecoveryPackIntoPresentationSchema.parse({ ...request, afterBlockId })).toEqual({
      ...request,
      afterBlockId,
    });
    expect(
      InsertRecoveryPackIntoPresentationSchema.safeParse({ ...request, expectedRevision: -1 })
        .success,
    ).toBe(false);
    expect(
      InsertRecoveryPackIntoPresentationSchema.safeParse({ ...request, afterBlockId: "invalid" })
        .success,
    ).toBe(false);
  });

  it.each(["question", "card", "accepted baseline"])(
    "rejects a changed %s with a stale frozen hash",
    (change) => {
      const draft = presentation();
      const insertion = draft.recoveryPackInsertions![0]!;
      if (change === "question") insertion.originalContent.diagnostic.prompt = "Altered baseline";
      else if (change === "card") insertion.originalContent.interventions[0]!.body = "Altered card";
      else {
        const content = structuredClone(insertion.originalContent);
        insertion.updateBaseline = {
          packVersionId: randomUUID(),
          packVersion: 2,
          contentHash: recoveryPackContentHash(content),
          content,
        };
        content.interventions[0]!.body = "Altered accepted baseline";
      }
      expect(PresentationDraftSchema.safeParse(draft).success).toBe(false);
      expect(PresentationContentSchema.safeParse(draft).success).toBe(false);
    },
  );

  it("canonicalizes reordered properties before validating frozen content hashes", () => {
    const draft = presentation();
    expect(PresentationContentSchema.parse(reversePropertyOrder(draft))).toEqual(draft);
  });

  it.each(["insertion ID", "same pair", "overlapping pair"])(
    "rejects ambiguous %s metadata even when draft copies have been deleted",
    (duplicate) => {
      const draft = presentation();
      draft.blocks = [
        { id: randomUUID(), kind: "question", question: question("What would you do next?") },
      ];
      const first = draft.recoveryPackInsertions![0]!;
      if (duplicate === "same pair") first.recheckQuestionId = first.diagnosticQuestionId;
      else {
        draft.recoveryPackInsertions!.push({
          ...structuredClone(first),
          id: duplicate === "insertion ID" ? first.id : randomUUID(),
          diagnosticQuestionId:
            duplicate === "overlapping pair" ? first.recheckQuestionId : randomUUID(),
          recheckQuestionId: randomUUID(),
        });
      }
      expect(PresentationDraftSchema.safeParse(draft).success).toBe(false);
      expect(PresentationContentSchema.safeParse(draft).success).toBe(false);
    },
  );

  it.each(["block", "question", "choice"])("retains unique %s guards in v3", (duplicate) => {
    const draft = presentation();
    if (duplicate === "block") draft.blocks[1]!.id = draft.blocks[0]!.id;
    else if (duplicate === "question") checkpoint(draft, 1).id = checkpoint(draft, 0).id;
    else {
      const first = checkpoint(draft, 0);
      const second = checkpoint(draft, 1);
      if (!("choices" in first) || !("choices" in second)) throw new Error("Expected choices");
      second.choices[0]!.id = first.choices[0]!.id;
    }
    expect(PresentationDraftSchema.safeParse(draft).success).toBe(false);
    expect(PresentationContentSchema.safeParse(draft).success).toBe(false);
  });

  it("allows incomplete local edits and missing copies without altering frozen baselines", () => {
    const draft = presentation();
    const insertion = structuredClone(draft.recoveryPackInsertions![0]!);
    checkpoint(draft, 0).prompt = "";
    checkpoint(draft, 0).linkedRecheckQuestionId = randomUUID();
    draft.blocks.splice(1, 1);
    expect(PresentationDraftSchema.parse(draft).recoveryPackInsertions).toEqual([insertion]);
    expect(PresentationContentSchema.safeParse(draft).success).toBe(false);
    draft.blocks = [];
    expect(PresentationDraftSchema.parse(draft).recoveryPackInsertions).toEqual([insertion]);
  });

  it("publishes a valid remaining question after copies are deleted while preserving context", () => {
    const draft = presentation();
    const insertion = structuredClone(draft.recoveryPackInsertions![0]!);
    draft.blocks = [
      { id: randomUUID(), kind: "question", question: question("What would you do next?") },
    ];
    expect(PresentationContentSchema.parse(draft).recoveryPackInsertions).toEqual([insertion]);
  });

  it("publishes a valid locally repurposed question without rewriting the frozen reference", () => {
    const draft = presentation();
    const insertion = structuredClone(draft.recoveryPackInsertions![0]!);
    const local = checkpoint(draft, 0);
    local.prompt = "Which isolation technique fits our local equipment?";
    local.purpose = "practice";
    local.linkedRecheckQuestionId = null;
    draft.blocks.splice(1, 1);
    const published = PresentationContentSchema.parse(draft);
    expect(published.recoveryPackInsertions).toEqual([insertion]);
    expect(published.blocks[0]).toMatchObject({
      question: {
        prompt: local.prompt,
        purpose: "practice",
        recoveryPackSource: local.recoveryPackSource,
      },
    });
  });

  it("keeps the immutable insertion array bounded", () => {
    const draft = presentation();
    const insertion = draft.recoveryPackInsertions![0]!;
    draft.recoveryPackInsertions = Array.from({ length: 101 }, () => ({
      ...insertion,
      id: randomUUID(),
      diagnosticQuestionId: randomUUID(),
      recheckQuestionId: randomUUID(),
    }));
    expect(PresentationDraftSchema.safeParse(draft).success).toBe(false);
    expect(PresentationContentSchema.safeParse(draft).success).toBe(false);
  });

  it.each(["missing recheck", "reordered recheck", "orphan recheck"])(
    "still rejects published %s topology",
    (change) => {
      const draft = presentation();
      if (change === "missing recheck") draft.blocks.splice(1, 1);
      else if (change === "reordered recheck") draft.blocks.reverse();
      else checkpoint(draft, 0).linkedRecheckQuestionId = null;
      expect(PresentationDraftSchema.safeParse(draft).success).toBe(true);
      expect(PresentationContentSchema.safeParse(draft).success).toBe(false);
    },
  );

  it("does not change existing Round Pack contracts or provenance behavior", () => {
    const draft = presentation();
    const round = {
      title: draft.title,
      questions: draft.blocks.flatMap((block) =>
        block.kind === "question" ? [block.question] : [],
      ),
      recoveryPackInsertions: draft.recoveryPackInsertions,
    };
    const parsed = QuizDraftSchema.parse(round);
    expect(QuizContentSchema.parse(round)).toEqual(parsed);
    expect(parsed.recoveryPackInsertions).toEqual(draft.recoveryPackInsertions);
    expect(parsed.questions[0]!.recoveryPackSource).toEqual(
      checkpoint(draft, 0).recoveryPackSource,
    );
  });
});

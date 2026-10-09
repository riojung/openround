import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PresentationCommandSchema,
  PresentationCompanionCommandSchema,
  PresentationCompanionPublishedQuestionCatalogSchema,
  PresentationContentSchema,
  PresentationDraftSchema,
  PresentationPublishedQuestionSelectionSchema,
} from "../src/index";

function fixture() {
  const selection = {
    sourceQuizVersionId: randomUUID(),
    sourceQuestionId: randomUUID(),
    contentHash: "a".repeat(64),
  };
  const block = {
    id: randomUUID(),
    kind: "question" as const,
    provenance: {
      sourceQuizVersionId: selection.sourceQuizVersionId,
      sourceQuestionId: selection.sourceQuestionId,
    },
    question: {
      id: randomUUID(),
      type: "numeric" as const,
      prompt: "What is one plus one?",
      correctValue: "2",
      tolerance: "0",
      unit: null,
      delivery: "main" as const,
      timeLimitSeconds: 30,
      basePoints: 100,
      explanation: "Synthetic private explanation.",
      mediaId: null,
      mediaAlt: null,
    },
  };
  const insertion = {
    ...selection,
    commandId: randomUUID(),
    blockId: block.id,
    sourceQuizId: randomUUID(),
    sourceQuizVersion: 1,
  };
  return {
    selection,
    block,
    insertion,
    content: {
      title: "Synthetic destination",
      description: "",
      schemaVersion: 2,
      blocks: [block],
      livePublishedQuestions: [insertion],
    },
  };
}

describe("Companion published question contracts", () => {
  it("accepts only an exact immutable selection, without content or host authority", () => {
    const { selection } = fixture();
    expect(PresentationPublishedQuestionSelectionSchema.parse(selection)).toEqual(selection);
    for (const invalid of [
      { sourceQuestionId: "invalid" },
      { sourceQuizVersionId: "invalid" },
      { contentHash: "x".repeat(64) },
      { contentHash: "a".repeat(63) },
      { prompt: "Mutable content" },
      { choices: [] },
      { correctValue: "2" },
    ])
      expect(
        PresentationPublishedQuestionSelectionSchema.safeParse({ ...selection, ...invalid })
          .success,
      ).toBe(false);
    const command = {
      sessionId: randomUUID(),
      companionToken: "c".repeat(32),
      commandId: randomUUID(),
      expectedRevision: 0,
      action: "insert_published_question",
      publishedQuestion: selection,
    };
    expect(PresentationCompanionCommandSchema.parse(command)).toEqual(command);
    expect(PresentationCommandSchema.safeParse(command).success).toBe(false);
    expect(
      PresentationCompanionCommandSchema.safeParse({ ...command, controlToken: "h".repeat(32) })
        .success,
    ).toBe(false);
  });

  it("bounds catalog metadata and rejects hidden fields or duplicate references", () => {
    const { selection, insertion, block } = fixture();
    const item = {
      ...selection,
      sourceQuizId: insertion.sourceQuizId,
      sourceQuizVersion: 1,
      title: "Published title",
      prompt: block.question.prompt,
      type: block.question.type,
    };
    expect(
      PresentationCompanionPublishedQuestionCatalogSchema.parse({
        questions: [item],
        hasMore: false,
      }),
    ).toEqual({ questions: [item], hasMore: false });
    for (const field of [
      "correctValue",
      "explanation",
      "choices",
      "conceptKeys",
      "sourceCitations",
      "mediaId",
    ]) {
      expect(
        PresentationCompanionPublishedQuestionCatalogSchema.safeParse({
          questions: [{ ...item, [field]: "private" }],
          hasMore: false,
        }).success,
      ).toBe(false);
    }
    expect(
      PresentationCompanionPublishedQuestionCatalogSchema.safeParse({
        questions: [item, item],
        hasMore: false,
      }).success,
    ).toBe(false);
    expect(
      PresentationCompanionPublishedQuestionCatalogSchema.safeParse({
        questions: Array.from({ length: 101 }, () => ({ ...item, sourceQuestionId: randomUUID() })),
        hasMore: true,
      }).success,
    ).toBe(false);
    expect(
      PresentationCompanionPublishedQuestionCatalogSchema.safeParse({
        questions: [],
        hasMore: false,
        draft: {},
      }).success,
    ).toBe(false);
  });

  it("retains frozen session provenance without extending authoring drafts", () => {
    const { content, insertion } = fixture();
    expect(PresentationContentSchema.parse(content).livePublishedQuestions).toEqual([insertion]);
    expect(PresentationDraftSchema.parse(content)).not.toHaveProperty("livePublishedQuestions");
    expect(
      PresentationContentSchema.parse({ ...content, livePublishedQuestions: undefined })
        .livePublishedQuestions,
    ).toBeUndefined();
    for (const marker of [
      { ...insertion, blockId: randomUUID() },
      { ...insertion, sourceQuestionId: randomUUID() },
      { ...insertion, sourceQuizVersionId: randomUUID() },
      { ...insertion, sourceQuizVersion: 0 },
      { ...insertion, contentHash: "invalid" },
      { ...insertion, nickname: "Synthetic alias" },
    ])
      expect(
        PresentationContentSchema.safeParse({ ...content, livePublishedQuestions: [marker] })
          .success,
      ).toBe(false);
    expect(
      PresentationContentSchema.safeParse({
        ...content,
        livePublishedQuestions: [insertion, insertion],
      }).success,
    ).toBe(false);
    expect(
      PresentationContentSchema.safeParse({ ...content, livePublishedQuestions: [] }).success,
    ).toBe(false);
  });

  it("rejects media, recovery roles, and missing provenance on a marked copy", () => {
    const { content, block } = fixture();
    for (const modified of [
      { ...block, provenance: undefined },
      {
        ...block,
        question: { ...block.question, mediaId: randomUUID(), mediaAlt: "Synthetic image" },
      },
      { ...block, question: { ...block.question, delivery: "recheck" } },
      { ...block, question: { ...block.question, linkedRecheckQuestionId: randomUUID() } },
    ])
      expect(PresentationContentSchema.safeParse({ ...content, blocks: [modified] }).success).toBe(
        false,
      );
  });
});

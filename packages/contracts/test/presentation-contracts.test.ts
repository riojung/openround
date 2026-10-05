import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ContentSlideDraftSchema,
  ContentSlideFrameSchema,
  PresentationContentSchema,
  PresentationDraftMutationSchema,
  PresentationDraftSchema,
  migratePresentationV1,
  type ContentSlideDraft,
} from "../src/index";

function questionBlock() {
  return {
    id: randomUUID(),
    kind: "question" as const,
    question: {
      id: randomUUID(),
      type: "single_select" as const,
      prompt: "Which evidence should guide the decision?",
      choices: [
        { id: randomUUID(), label: "Observed behaviour", isCorrect: true },
        { id: randomUUID(), label: "Volume alone", isCorrect: false },
      ],
      purpose: "diagnostic" as const,
      confidence: "optional" as const,
      delivery: "main" as "main" | "recheck",
      conceptKeys: ["evidence"],
      linkedRecheckQuestionId: null as string | null,
      timeLimitSeconds: 20,
      basePoints: 1000,
      explanation: "Observed behaviour is direct evidence.",
      mediaId: null,
      mediaAlt: null,
    },
  };
}

function contentBlock(title = "", body = ""): ContentSlideDraft {
  const id = randomUUID();
  return {
    id,
    kind: "content" as const,
    layout: "title_body" as const,
    textElements: [
      {
        id: `${id}:title`,
        role: "title" as const,
        text: title,
        region: "top_center" as const,
        order: 0,
      },
      {
        id: `${id}:body`,
        role: "body" as const,
        text: body,
        region: "middle_center" as const,
        order: 0,
      },
    ],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: "",
  };
}

describe("presentation contracts", () => {
  it("retains optional bounded text frames in draft mutations and published content", () => {
    const slide = contentBlock("Positioned title", "Positioned body");
    slide.textElements[0]!.frame = { x: 8, y: 20, width: 84, height: 22 };
    slide.textElements[1]!.frame = { x: 8, y: 48, width: 84, height: 40 };
    const mutation = PresentationDraftMutationSchema.parse({
      schemaVersion: 2,
      mutationId: randomUUID(),
      expectedRevision: 0,
      draft: {
        title: "Bounded geometry",
        schemaVersion: 2,
        blocks: [slide, questionBlock()],
      },
    });
    const content = PresentationContentSchema.parse(mutation.draft);
    const publishedSlide = content.blocks[0];
    expect(publishedSlide?.kind).toBe("content");
    if (publishedSlide?.kind !== "content") throw new Error("Expected the content slide");
    expect(publishedSlide.textElements).toEqual(slide.textElements);
    expect(ContentSlideFrameSchema.parse({ x: 88, y: 94, width: 12, height: 6 })).toEqual({
      x: 88,
      y: 94,
      width: 12,
      height: 6,
    });
  });

  it.each([
    { x: -1, y: 0, width: 12, height: 6 },
    { x: 0, y: -1, width: 12, height: 6 },
    { x: 0, y: 0, width: 11, height: 6 },
    { x: 0, y: 0, width: 12, height: 5 },
    { x: 89, y: 0, width: 12, height: 6 },
    { x: 0, y: 95, width: 12, height: 6 },
    { x: 0, y: 0, width: 101, height: 6 },
    { x: 0, y: 0, width: 12, height: 101 },
    { x: Number.NaN, y: 0, width: 12, height: 6 },
    { x: 0, y: Number.POSITIVE_INFINITY, width: 12, height: 6 },
    { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 6 },
    { x: 0, y: 0, width: 12, height: Number.NEGATIVE_INFINITY },
  ])("rejects unbounded text frame %j", (frame) => {
    const slide = contentBlock("Bounded title", "");
    slide.textElements[0]!.frame = frame;
    expect(ContentSlideDraftSchema.safeParse(slide).success).toBe(false);
  });

  it("keeps legacy slides valid without frames and preserves frames during migration", () => {
    const legacySlide = {
      id: randomUUID(),
      kind: "content",
      layout: "quote",
      title: "Recovered title",
      body: "Recovered body",
      mediaId: null,
      mediaAlt: null,
      speakerNotes: "Recovered note",
    };
    const migrated = PresentationDraftSchema.parse(
      migratePresentationV1({
        title: "Recovered presentation",
        schemaVersion: 1,
        blocks: [legacySlide],
      }),
    );
    const migratedSlide = migrated.blocks[0];
    if (migratedSlide?.kind !== "content") throw new Error("Expected the recovered slide");
    expect(migratedSlide.textElements.every((element) => element.frame === undefined)).toBe(true);
    const frame = { x: 8, y: 20, width: 84, height: 22 };
    migratedSlide.textElements[0]!.frame = frame;
    const retained = PresentationDraftSchema.parse(migratePresentationV1(migrated));
    expect(retained).toEqual(migrated);
  });

  it("bounds text elements and requires unique IDs and positions", () => {
    const block = contentBlock("Title", "Body");
    const duplicateId = structuredClone(block);
    duplicateId.textElements[1]!.id = duplicateId.textElements[0]!.id;
    expect(ContentSlideDraftSchema.safeParse(duplicateId).success).toBe(false);

    const duplicatePosition = structuredClone(block);
    duplicatePosition.textElements[1]!.region = "top_center";
    expect(ContentSlideDraftSchema.safeParse(duplicatePosition).success).toBe(false);

    const invalidRegion = structuredClone(block);
    invalidRegion.textElements[0]!.region = "outside" as never;
    expect(ContentSlideDraftSchema.safeParse(invalidRegion).success).toBe(false);

    const tooMany = structuredClone(block);
    tooMany.textElements = [
      ...tooMany.textElements,
      ...Array.from({ length: 7 }, (_, index) => ({
        id: `${block.id}:extra-${index}`,
        role: "body" as const,
        text: "",
        region: "bottom_center" as const,
        order: index,
      })),
    ];
    expect(ContentSlideDraftSchema.safeParse(tooMany).success).toBe(false);
  });

  it("stores incomplete structured authoring states", () => {
    expect(
      PresentationDraftSchema.safeParse({
        title: "",
        description: "",
        schemaVersion: 2,
        blocks: [contentBlock()],
      }).success,
    ).toBe(true);
  });

  it("requires complete content and an interactive block to publish", () => {
    const contentOnly = PresentationContentSchema.safeParse({
      title: "Content only",
      description: "",
      experiencePreset: { id: "focus", version: 1 },
      schemaVersion: 2,
      blocks: [contentBlock("Context", "Read this before the activity.")],
    });
    expect(contentOnly.success).toBe(false);

    const mixed = PresentationContentSchema.safeParse({
      title: "Mixed deck",
      description: "",
      experiencePreset: { id: "focus", version: 1 },
      schemaVersion: 2,
      blocks: [questionBlock()],
    });
    expect(mixed.success).toBe(true);
  });

  it("rejects duplicate question and choice IDs", () => {
    const first = questionBlock();
    const second = questionBlock();
    second.question.id = first.question.id;
    second.question.choices[0]!.id = first.question.choices[0]!.id;
    const parsed = PresentationContentSchema.safeParse({
      title: "Broken IDs",
      description: "",
      experiencePreset: { id: "focus", version: 1 },
      schemaVersion: 2,
      blocks: [first, second],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "Every presentation question needs a unique ID",
        "Every answer choice needs a unique ID",
      ]),
    );
  });

  it("keeps recovery topology sequential, owned, and publishable", () => {
    const first = questionBlock();
    const second = questionBlock();
    const recheck = questionBlock();
    recheck.question.delivery = "recheck";
    first.question.linkedRecheckQuestionId = recheck.question.id;
    second.question.linkedRecheckQuestionId = recheck.question.id;
    const shared = {
      title: "Shared recovery",
      description: "",
      experiencePreset: { id: "focus" as const, version: 1 as const },
      schemaVersion: 2 as const,
      blocks: [first, second, recheck],
    };
    const sharedResult = PresentationContentSchema.safeParse(shared);
    expect(sharedResult.success).toBe(false);
    expect(sharedResult.error?.issues.map(({ message }) => message)).toContain(
      "A recheck cannot be shared by multiple diagnostic questions",
    );

    const misordered = structuredClone(shared);
    misordered.blocks = [misordered.blocks[2]!, misordered.blocks[0]!];
    const orderResult = PresentationContentSchema.safeParse(misordered);
    expect(orderResult.success).toBe(false);
    expect(orderResult.error?.issues.map(({ message }) => message)).toContain(
      "Place the linked recheck after its diagnostic question",
    );

    const orphanMain = questionBlock();
    const orphanRecheck = questionBlock();
    orphanRecheck.question.delivery = "recheck";
    const orphan = { ...shared, blocks: [orphanMain, orphanRecheck] };
    expect(PresentationDraftSchema.safeParse(orphan).success).toBe(true);
    const orphanResult = PresentationContentSchema.safeParse(orphan);
    expect(orphanResult.success).toBe(false);
    expect(orphanResult.error?.issues.map(({ message }) => message)).toContain(
      "Every recheck must be linked from one earlier diagnostic question",
    );
  });
});

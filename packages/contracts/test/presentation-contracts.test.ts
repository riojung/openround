import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ContentSlideDraftSchema,
  PresentationContentSchema,
  PresentationDraftSchema,
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

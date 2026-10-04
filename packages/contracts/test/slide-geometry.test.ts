import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ContentSlideFrameSchema,
  PresentationDraftSchema,
  clampContentSlideFrame,
  contentSlideMediaFrame,
  fitContentSlideFrameAroundMedia,
  migratePresentationV1,
  regionContentSlideFrames,
  regionForContentSlideFrame,
  resolveContentSlideFrames,
  starterContentSlideFrames,
  type ContentSlideFrame,
  type ContentSlideLayout,
  type ContentSlideRegion,
  type ContentSlideTextElement,
} from "../src/index.js";

function elements(
  titleRegion: ContentSlideRegion = "middle_center",
  bodyRegion: ContentSlideRegion = "middle_center",
): ContentSlideTextElement[] {
  return [
    { id: "title", role: "title", text: "Title", region: titleRegion, order: 0 },
    {
      id: "body",
      role: "body",
      text: "Body",
      region: bodyRegion,
      order: titleRegion === bodyRegion ? 1 : 0,
    },
  ];
}

function overlaps(left: ContentSlideFrame, right: ContentSlideFrame) {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

describe("slide geometry", () => {
  it.each([
    [
      { x: 8, y: 20, width: 84, height: 22 },
      { x: 8, y: 20, width: 84, height: 22 },
    ],
    [
      { x: 2, y: 80, width: 40, height: 16 },
      { x: 2, y: 80, width: 40, height: 16 },
    ],
    [
      { x: 48, y: 80, width: 12, height: 12 },
      { x: 48, y: 80, width: 12, height: 12 },
    ],
    [
      { x: 60, y: 69, width: 30, height: 6 },
      { x: 60, y: 69, width: 30, height: 6 },
    ],
    [
      { x: 8, y: 48, width: 84, height: 40 },
      { x: 8, y: 48, width: 84, height: 24 },
    ],
    [
      { x: 60, y: 66, width: 30, height: 12 },
      { x: 60, y: 66, width: 30, height: 6 },
    ],
    [
      { x: 40, y: 80, width: 44, height: 12 },
      { x: 40, y: 80, width: 16, height: 12 },
    ],
    [
      { x: 44, y: 80, width: 40, height: 12 },
      { x: 44, y: 80, width: 12, height: 12 },
    ],
    [
      { x: 60, y: 90, width: 30, height: 6 },
      { x: 60, y: 66, width: 30, height: 6 },
    ],
    [
      { x: 72, y: 74, width: 20, height: 18 },
      { x: 72, y: 54, width: 20, height: 18 },
    ],
    [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 100, height: 72 },
    ],
    [
      { x: Number.NaN, y: Number.POSITIVE_INFINITY, width: -1, height: Number.NaN },
      { x: 0, y: 0, width: 12, height: 6 },
    ],
  ])(
    "keeps text frame %j outside the image bay with bounded minimum dimensions",
    (frame, expected) => {
      const before = structuredClone(frame);
      const fitted = fitContentSlideFrameAroundMedia(frame);
      expect(fitted).toEqual(expected);
      expect(ContentSlideFrameSchema.safeParse(fitted).success).toBe(true);
      expect(overlaps(fitted, contentSlideMediaFrame)).toBe(false);
      expect(fitContentSlideFrameAroundMedia(fitted)).toEqual(fitted);
      expect(frame).toEqual(before);
    },
  );

  it.each([
    ["title", "middle_center", "bottom_center"],
    ["title_body", "middle_center", "middle_center"],
    ["quote", "middle_center", "bottom_center"],
    ["section", "middle_center", "bottom_center"],
    ["callout", "top_center", "middle_center"],
    ["media", "top_center", "middle_center"],
  ] as const)(
    "reserves the image bay for two through eight default %s text elements",
    (layout, titleRegion, bodyRegion) => {
      for (let bodyCount = 1; bodyCount <= 7; bodyCount += 1) {
        const base = elements(titleRegion, bodyRegion);
        const input = [
          base[0]!,
          ...Array.from({ length: bodyCount }, (_, index) => ({
            ...base[1]!,
            id: `body-${index}`,
            order: index + (titleRegion === bodyRegion ? 1 : 0),
          })),
        ];
        const before = structuredClone(input);
        const starter = starterContentSlideFrames(layout, input, true);
        expect(resolveContentSlideFrames({ layout, textElements: input, hasMedia: true })).toEqual(
          starter,
        );
        expect(
          resolveContentSlideFrames({ layout, textElements: input, mediaId: "attached-image" }),
        ).toEqual(starter);
        const frames = Object.values(starter);
        expect(frames).toHaveLength(bodyCount + 1);
        for (const [index, frame] of frames.entries()) {
          expect(ContentSlideFrameSchema.safeParse(frame).success).toBe(true);
          expect(overlaps(frame, contentSlideMediaFrame)).toBe(false);
          for (const other of frames.slice(index + 1)) expect(overlaps(frame, other)).toBe(false);
        }
        expect(input).toEqual(before);
      }
    },
  );

  it.each(["title", "title_body", "quote", "section", "callout", "media"] as const)(
    "fits explicit and custom regional %s frames only when an image is present",
    (layout) => {
      const input = elements("bottom_right", "bottom_left");
      input[0]!.frame = { x: 72, y: 74, width: 20, height: 18 };
      const before = structuredClone(input);
      const unreserved = resolveContentSlideFrames({ layout, textElements: input, mediaId: null });
      expect(unreserved.title).toEqual(input[0]!.frame);
      const reserved = resolveContentSlideFrames({ layout, textElements: input, hasMedia: true });
      expect(reserved.title).toEqual({ x: 72, y: 54, width: 20, height: 18 });
      expect(reserved.body).toEqual(unreserved.body);
      for (const frame of Object.values(reserved)) {
        expect(ContentSlideFrameSchema.safeParse(frame).success).toBe(true);
        expect(overlaps(frame, contentSlideMediaFrame)).toBe(false);
      }
      const regional = regionContentSlideFrames(input);
      expect(overlaps(regional.title!, contentSlideMediaFrame)).toBe(true);
      const starter = starterContentSlideFrames(layout, input, true);
      expect(overlaps(starter.title!, contentSlideMediaFrame)).toBe(false);
      expect(ContentSlideFrameSchema.safeParse(starter.title).success).toBe(true);
      expect(input).toEqual(before);
    },
  );

  it("preserves legacy media-slide defaults while reserving images in other legacy layouts", () => {
    for (const layout of ["media", "title_body"] as const) {
      const mediaId = randomUUID();
      const draft = PresentationDraftSchema.parse(
        migratePresentationV1({
          title: "Legacy image slide",
          schemaVersion: 1,
          blocks: [
            {
              id: randomUUID(),
              kind: "content",
              layout,
              title: "Legacy title",
              body: "Legacy body",
              mediaId,
              mediaAlt: "Attached image",
              speakerNotes: "",
            },
          ],
        }),
      );
      const slide = draft.blocks[0];
      if (slide?.kind !== "content") throw new Error("Expected the legacy content slide");
      expect(slide.textElements.every((element) => !element.frame)).toBe(true);
      const frames = resolveContentSlideFrames(slide);
      expect(frames[slide.textElements[0]!.id]).toEqual({ x: 8, y: 20, width: 84, height: 22 });
      expect(frames[slide.textElements[1]!.id]).toEqual({ x: 8, y: 48, width: 84, height: 22 });
      expect(Object.values(frames).every((frame) => !overlaps(frame, contentSlideMediaFrame))).toBe(
        true,
      );
    }
  });

  it.each([
    ["title", "middle_center", "bottom_center"],
    ["title_body", "middle_center", "middle_center"],
    ["quote", "middle_center", "bottom_center"],
    ["section", "middle_center", "bottom_center"],
    ["callout", "top_center", "middle_center"],
    ["media", "top_center", "middle_center"],
  ] as const)("uses wide starter frames for the %s layout", (layout, titleRegion, bodyRegion) => {
    const frames = starterContentSlideFrames(layout, elements(titleRegion, bodyRegion));
    expect(frames.title).toEqual({ x: 8, y: 20, width: 84, height: 22 });
    expect(frames.body).toEqual({ x: 8, y: 48, width: 84, height: layout === "media" ? 22 : 40 });
    expect(overlaps(frames.title!, frames.body!)).toBe(false);
  });

  it("preserves customized regions and their reading order without changing the input", () => {
    const ordered = elements("top_left", "top_left");
    const input = ordered.toReversed();
    const before = structuredClone(input);
    const frames = resolveContentSlideFrames({ layout: "title_body", textElements: input });
    expect(frames.title).toEqual({ x: 2, y: 2, width: 28, height: 15 });
    expect(frames.body).toEqual({ x: 2, y: 17, width: 28, height: 15 });
    expect(input).toEqual(before);
    expect(overlaps(frames.title!, frames.body!)).toBe(false);
  });

  it("places center-region shortcuts in the center instead of restoring wide layout defaults", () => {
    const input = elements();
    const before = structuredClone(input);
    const frames = regionContentSlideFrames(input);
    expect(frames.title?.width).toBe(28);
    expect(frames.body?.width).toBe(28);
    expect(regionForContentSlideFrame(frames.title!)).toBe("middle_center");
    expect(regionForContentSlideFrame(frames.body!)).toBe("middle_center");
    expect(overlaps(frames.title!, frames.body!)).toBe(false);
    expect(input).toEqual(before);
  });

  it.each(["bottom_right", "bottom_center"] as const)(
    "keeps two through eight %s text elements stacked clear of media",
    (region) => {
      for (let count = 2; count <= 8; count += 1) {
        const input: ContentSlideTextElement[] = Array.from({ length: count }, (_, order) => ({
          id: `element-${order}`,
          role: order === 0 ? "title" : "body",
          text: `${order}`,
          region,
          order,
        }));
        const before = structuredClone(input);
        const frames = regionContentSlideFrames(input, true);
        expect(Object.keys(frames).sort()).toEqual(input.map((element) => element.id).sort());
        expect(regionContentSlideFrames(input.toReversed(), true)).toEqual(frames);
        for (const [index, element] of input.entries()) {
          const frame = frames[element.id]!;
          expect(ContentSlideFrameSchema.safeParse(frame).success).toBe(true);
          expect(overlaps(frame, contentSlideMediaFrame)).toBe(false);
          expect(regionForContentSlideFrame(frame)).toBe(
            region === "bottom_right"
              ? index < 5
                ? "middle_right"
                : "bottom_center"
              : index < 5
                ? "bottom_center"
                : "middle_center",
          );
          if (regionForContentSlideFrame(frame) === "bottom_center") {
            expect(frame.x + frame.width).toBe(56);
          }
          for (const other of input.slice(index + 1)) {
            expect(overlaps(frame, frames[other.id]!)).toBe(false);
          }
        }
        for (const layout of [
          "title",
          "title_body",
          "quote",
          "section",
          "callout",
          "media",
        ] as const) {
          expect(starterContentSlideFrames(layout, input, true)).toEqual(frames);
          expect(
            resolveContentSlideFrames({ layout, textElements: input, mediaId: "attached-image" }),
          ).toEqual(frames);
        }
        expect(input).toEqual(before);
      }
    },
  );

  it("relocates blocked media-region chunks past occupied neighboring regions", () => {
    const occupiedRegions: ContentSlideRegion[] = [
      "top_right",
      "middle_center",
      "middle_right",
      "bottom_left",
      "bottom_center",
    ];
    const input: ContentSlideTextElement[] = [
      ...occupiedRegions.map((region, index) => ({
        id: `occupied-${index}`,
        role: "body" as const,
        text: `${index}`,
        region,
        order: 0,
      })),
      ...Array.from({ length: 3 }, (_, order) => ({
        id: `relocated-${order}`,
        role: "body" as const,
        text: `${order}`,
        region: "bottom_right" as const,
        order,
      })),
    ];
    const frames = regionContentSlideFrames(input, true);
    for (const [index, region] of occupiedRegions.entries()) {
      expect(regionForContentSlideFrame(frames[`occupied-${index}`]!)).toBe(region);
    }
    for (let order = 0; order < 3; order += 1) {
      expect(frames[`relocated-${order}`]).toEqual({
        x: 100 / 3 + 2,
        y: 2 + order * 10,
        width: 28,
        height: 10,
      });
    }
    const rectangles = Object.values(frames);
    for (const [index, frame] of rectangles.entries()) {
      expect(ContentSlideFrameSchema.safeParse(frame).success).toBe(true);
      expect(overlaps(frame, contentSlideMediaFrame)).toBe(false);
      for (const other of rectangles.slice(index + 1)) expect(overlaps(frame, other)).toBe(false);
    }
  });

  it("keeps media-aware regional sibling stacks when another element has an explicit frame", () => {
    const input: ContentSlideTextElement[] = [
      {
        id: "explicit",
        role: "title",
        text: "Explicit title",
        region: "top_left",
        order: 0,
        frame: { x: 2, y: 2, width: 28, height: 15 },
      },
      ...Array.from({ length: 2 }, (_, order) => ({
        id: `body-${order}`,
        role: "body" as const,
        text: `${order}`,
        region: "bottom_right" as const,
        order,
      })),
    ];
    const frames = resolveContentSlideFrames({
      layout: "title_body",
      textElements: input,
      hasMedia: true,
    });
    const regional = regionContentSlideFrames(input, true);
    expect(frames.explicit).toEqual(input[0]!.frame);
    expect(frames["body-0"]).toEqual(regional["body-0"]);
    expect(frames["body-1"]).toEqual(regional["body-1"]);
    expect(overlaps(frames["body-0"]!, frames["body-1"]!)).toBe(false);
    expect(overlaps(frames["body-0"]!, contentSlideMediaFrame)).toBe(false);
    expect(overlaps(frames["body-1"]!, contentSlideMediaFrame)).toBe(false);
  });

  it("keeps explicit rectangles intact while unframed siblings retain regional fallback", () => {
    const input = elements("middle_center", "bottom_left");
    const explicit = { x: 72, y: 74, width: 20, height: 18 };
    input[0]!.frame = explicit;
    const frames = resolveContentSlideFrames({ layout: "title_body", textElements: input });
    expect(frames.title).toEqual(explicit);
    expect(frames.title).not.toBe(explicit);
    expect(frames.body?.width).toBe(28);
    expect(regionForContentSlideFrame(frames.body!)).toBe("bottom_left");
  });

  it("overflows dense legacy regions into adjacent unoccupied cells without overlap", () => {
    const input: ContentSlideTextElement[] = Array.from({ length: 8 }, (_, order) => ({
      id: `element-${order}`,
      role: order === 0 ? "title" : "body",
      text: `${order}`,
      region: "top_right",
      order,
    }));
    const before = structuredClone(input);
    const frames = resolveContentSlideFrames({ layout: "title_body", textElements: input });
    expect(Object.keys(frames)).toHaveLength(8);
    for (const [index, element] of input.entries()) {
      const frame = frames[element.id]!;
      expect(ContentSlideFrameSchema.safeParse(frame).success).toBe(true);
      expect(regionForContentSlideFrame(frame)).toBe(index < 5 ? "top_right" : "top_center");
      for (const other of input.slice(index + 1)) {
        expect(overlaps(frame, frames[other.id]!)).toBe(false);
      }
    }
    expect(resolveContentSlideFrames({ layout: "title_body", textElements: input })).toEqual(
      frames,
    );
    expect(input).toEqual(before);
  });

  it("reserves other occupied regions before assigning overflow", () => {
    const input: ContentSlideTextElement[] = Array.from({ length: 8 }, (_, order) => ({
      id: `element-${order}`,
      role: order === 0 ? "title" : "body",
      text: `${order}`,
      region: order === 6 ? "top_center" : order === 7 ? "middle_left" : "middle_center",
      order: order < 6 ? order : 0,
    }));
    const frames = resolveContentSlideFrames({ layout: "callout", textElements: input });
    expect(regionForContentSlideFrame(frames["element-5"]!)).toBe("middle_right");
    expect(regionForContentSlideFrame(frames["element-6"]!)).toBe("top_center");
    expect(regionForContentSlideFrame(frames["element-7"]!)).toBe("middle_left");
  });

  it("clamps unsafe values and canvas edges while preserving valid sizes", () => {
    expect(clampContentSlideFrame({ x: 200, y: -10, width: 25, height: 10 })).toEqual({
      x: 75,
      y: 0,
      width: 25,
      height: 10,
    });
    const safe = clampContentSlideFrame({
      x: Number.NaN,
      y: Number.POSITIVE_INFINITY,
      width: Number.NEGATIVE_INFINITY,
      height: 200,
    });
    expect(safe).toEqual({ x: 0, y: 0, width: 12, height: 100 });
    expect(ContentSlideFrameSchema.safeParse(safe).success).toBe(true);
    const valid = { x: 8, y: 20, width: 84, height: 22 };
    expect(clampContentSlideFrame(valid)).toEqual(valid);
    expect(valid).toEqual({ x: 8, y: 20, width: 84, height: 22 });
  });

  it.each([
    ["top_left", 0, 0],
    ["top_center", 40, 0],
    ["top_right", 80, 0],
    ["middle_left", 0, 40],
    ["middle_center", 40, 40],
    ["middle_right", 80, 40],
    ["bottom_left", 0, 80],
    ["bottom_center", 40, 80],
    ["bottom_right", 80, 80],
  ] as const)("classifies %s by rectangle center", (region, x, y) => {
    expect(regionForContentSlideFrame({ x, y, width: 12, height: 6 })).toBe(region);
  });

  it("supports title-only starters and gives three default text boxes the full slide width", () => {
    const title = elements()[0]!;
    expect(starterContentSlideFrames("title", [title]).title).toEqual({
      x: 8,
      y: 20,
      width: 84,
      height: 22,
    });
    const input = [...elements(), { ...elements()[1]!, id: "extra", order: 2 }];
    const frames = starterContentSlideFrames("title_body" satisfies ContentSlideLayout, input);
    expect(Object.values(frames).every((frame) => frame.width === 84)).toBe(true);
    expect(frames.title).toEqual({ x: 8, y: 12, width: 84, height: 22 });
    expect(frames.body).toEqual({ x: 8, y: 42, width: 84, height: 23 });
    expect(frames.extra).toEqual({ x: 8, y: 67, width: 84, height: 23 });
    expect(resolveContentSlideFrames({ layout: "title_body", textElements: input })).toEqual(
      frames,
    );
  });

  it.each([
    ["title", "middle_center", "bottom_center"],
    ["title_body", "middle_center", "middle_center"],
    ["quote", "middle_center", "bottom_center"],
    ["section", "middle_center", "bottom_center"],
    ["callout", "top_center", "middle_center"],
    ["media", "top_center", "middle_center"],
  ] as const)(
    "fits two through seven default bodies in the %s layout",
    (layout, titleRegion, bodyRegion) => {
      for (let bodyCount = 2; bodyCount <= 7; bodyCount += 1) {
        const base = elements(titleRegion, bodyRegion);
        const input = [
          base[0]!,
          ...Array.from({ length: bodyCount }, (_, index) => ({
            ...base[1]!,
            id: `body-${index}`,
            order: index + (titleRegion === bodyRegion ? 1 : 0),
          })),
        ];
        const before = structuredClone(input);
        const frames = Object.values(starterContentSlideFrames(layout, input));
        expect(frames).toHaveLength(bodyCount + 1);
        for (const [index, frame] of frames.entries()) {
          expect(ContentSlideFrameSchema.safeParse(frame).success).toBe(true);
          for (const other of frames.slice(index + 1)) {
            expect(overlaps(frame, other)).toBe(false);
          }
        }
        if (layout === "media") {
          expect(frames.slice(1).every((frame) => frame.y + frame.height <= 64)).toBe(true);
        }
        expect(input).toEqual(before);
      }
    },
  );
});

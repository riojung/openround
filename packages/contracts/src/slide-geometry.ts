import type {
  ContentSlideFrame,
  ContentSlideLayout,
  ContentSlideRegion,
  ContentSlideTextElement,
} from "./index.js";

const regions: readonly ContentSlideRegion[] = [
  "top_left",
  "top_center",
  "top_right",
  "middle_left",
  "middle_center",
  "middle_right",
  "bottom_left",
  "bottom_center",
  "bottom_right",
];

type SlideGeometryBlock = {
  layout: ContentSlideLayout;
  textElements: readonly ContentSlideTextElement[];
  mediaId?: string | null;
  hasMedia?: boolean;
};

export const contentSlideMediaFrame: Readonly<ContentSlideFrame> = Object.freeze({
  x: 60,
  y: 75,
  width: 36,
  height: 22,
});

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

/** Preserve the requested size, then keep the rectangle inside the percentage canvas. */
export function clampContentSlideFrame(frame: ContentSlideFrame): ContentSlideFrame {
  const width = Math.max(12, Math.min(100, finiteOr(frame.width, 12)));
  const height = Math.max(6, Math.min(100, finiteOr(frame.height, 6)));
  return {
    x: Math.max(0, Math.min(100 - width, finiteOr(frame.x, 0))),
    y: Math.max(0, Math.min(100 - height, finiteOr(frame.y, 0))),
    width,
    height,
  };
}

/** Keep text clear of the image bay while retaining its horizontal position when possible. */
export function fitContentSlideFrameAroundMedia(frame: ContentSlideFrame): ContentSlideFrame {
  const bounded = clampContentSlideFrame(frame);
  const intersects =
    bounded.x < contentSlideMediaFrame.x + contentSlideMediaFrame.width &&
    bounded.x + bounded.width > contentSlideMediaFrame.x &&
    bounded.y < contentSlideMediaFrame.y + contentSlideMediaFrame.height &&
    bounded.y + bounded.height > contentSlideMediaFrame.y;
  if (!intersects) return bounded;

  const heightAboveMedia = 72 - bounded.y;
  if (heightAboveMedia >= 6) {
    return { ...bounded, height: Math.min(bounded.height, heightAboveMedia) };
  }
  const widthBesideMedia = 56 - bounded.x;
  if (widthBesideMedia >= 12) {
    return { ...bounded, width: Math.min(bounded.width, widthBesideMedia) };
  }
  const height = Math.min(bounded.height, 72);
  return { ...bounded, y: Math.min(bounded.y, 72 - height), height };
}

/** Compatibility regions follow the rectangle's center, with boundaries in row-major order. */
export function regionForContentSlideFrame(frame: ContentSlideFrame): ContentSlideRegion {
  const bounded = clampContentSlideFrame(frame);
  const column = Math.min(2, Math.floor(((bounded.x + bounded.width / 2) * 3) / 100));
  const row = Math.min(2, Math.floor(((bounded.y + bounded.height / 2) * 3) / 100));
  return regions[row * 3 + column]!;
}

function defaultRegions(layout: ContentSlideLayout) {
  return {
    title: layout === "media" || layout === "callout" ? "top_center" : "middle_center",
    body:
      layout === "title" || layout === "quote" || layout === "section"
        ? "bottom_center"
        : "middle_center",
  } as const;
}

function distanceBetweenRegions(left: number, right: number) {
  return (
    Math.abs(Math.floor(left / 3) - Math.floor(right / 3)) + Math.abs((left % 3) - (right % 3))
  );
}

/** Region shortcuts use regional slots even when metadata matches a wide starter layout. */
export function regionContentSlideFrames(
  elements: readonly ContentSlideTextElement[],
  hasMedia = false,
): Record<string, ContentSlideFrame> {
  const blocked = new Set(hasMedia ? [8] : []);
  const groups = regions.map((region) =>
    elements
      .filter((element) => element.region === region)
      .sort((left, right) => left.order - right.order),
  );
  const occupied = new Set(
    groups.flatMap((group, regionIndex) =>
      group.length && !blocked.has(regionIndex) ? [regionIndex] : [],
    ),
  );
  const entries: Array<[string, ContentSlideFrame]> = [];

  for (const [sourceRegion, group] of groups.entries()) {
    for (let offset = 0; offset < group.length; offset += 5) {
      const chunk = group.slice(offset, offset + 5);
      const targetRegion =
        offset === 0 && !blocked.has(sourceRegion)
          ? sourceRegion
          : regions
              .map((_, index) => index)
              .filter((index) => !occupied.has(index) && !blocked.has(index))
              .sort(
                (left, right) =>
                  distanceBetweenRegions(sourceRegion, left) -
                    distanceBetweenRegions(sourceRegion, right) || left - right,
              )[0]!;
      occupied.add(targetRegion);
      const height = 30 / chunk.length;
      const x = ((targetRegion % 3) * 100) / 3 + 2;
      for (const [position, element] of chunk.entries()) {
        entries.push([
          element.id,
          {
            x,
            y: (Math.floor(targetRegion / 3) * 100) / 3 + 2 + position * height,
            width: hasMedia && targetRegion === 7 ? Math.min(28, 56 - x) : 28,
            height,
          },
        ]);
      }
    }
  }
  return Object.fromEntries(entries);
}

/** New layout defaults; customized legacy regions retain their ordered regional placement. */
export function starterContentSlideFrames(
  layout: ContentSlideLayout,
  elements: readonly ContentSlideTextElement[],
  hasMedia = false,
): Record<string, ContentSlideFrame> {
  const mediaTextBand = hasMedia || layout === "media";
  const defaults = defaultRegions(layout);
  const standard =
    elements.filter((element) => element.role === "title").length === 1 &&
    elements.every((element) => element.region === defaults[element.role]);
  if (!standard) {
    return regionContentSlideFrames(elements, hasMedia);
  }
  if (elements.length <= 2) {
    return Object.fromEntries(
      elements.map((element) => [
        element.id,
        element.role === "title"
          ? { x: 8, y: 20, width: 84, height: 22 }
          : { x: 8, y: 48, width: 84, height: mediaTextBand ? 22 : 40 },
      ]),
    );
  }

  const title = elements.find((element) => element.role === "title")!;
  const bodies = elements
    .filter((element) => element.role === "body")
    .sort((left, right) => left.order - right.order);
  const columns = mediaTextBand ? Math.ceil(bodies.length / 3) : bodies.length > 4 ? 2 : 1;
  const rows = Math.ceil(bodies.length / columns);
  const width = (84 - 4 * (columns - 1)) / columns;
  const height = ((mediaTextBand ? 22 : 48) - 2 * (rows - 1)) / rows;
  return Object.fromEntries([
    [title.id, { x: 8, y: 12, width: 84, height: 22 }],
    ...bodies.map((element, index) => [
      element.id,
      {
        x: 8 + (index % columns) * (width + 4),
        y: 42 + Math.floor(index / columns) * (height + 2),
        width,
        height,
      },
    ]),
  ]);
}

/** Preserve explicit text geometry and regional fallbacks while keeping an attached image clear. */
export function resolveContentSlideFrames(
  block: SlideGeometryBlock,
): Record<string, ContentSlideFrame> {
  const hasMedia = Boolean(block.hasMedia || block.mediaId);
  const fallback = block.textElements.some((element) => element.frame)
    ? regionContentSlideFrames(block.textElements, hasMedia)
    : starterContentSlideFrames(block.layout, block.textElements, hasMedia);
  return Object.fromEntries(
    block.textElements.map((element) => {
      const frame = { ...(element.frame ?? fallback[element.id]!) };
      return [
        element.id,
        hasMedia && element.frame ? fitContentSlideFrameAroundMedia(frame) : frame,
      ];
    }),
  );
}

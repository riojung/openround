import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createContentBlock } from "../../lib/presentation-builder";
import { ContentSlideView } from "./content-slide-view";

function slideFixture() {
  const block = createContentBlock();
  block.textElements = [
    { ...block.textElements[0]!, text: "Audience takeaway", region: "bottom_left", order: 0 },
    { ...block.textElements[1]!, text: "Start with the evidence", region: "top_right", order: 0 },
    {
      id: "second-body",
      role: "body",
      text: "Then explain the decision",
      region: "middle_left",
      order: 0,
    },
  ];
  return block;
}

describe("ContentSlideView", () => {
  it.each(["editor", "preview", "live"] as const)(
    "renders %s text in the shared top-to-bottom, left-to-right region order",
    (variant) => {
      const markup = renderToStaticMarkup(
        <ContentSlideView block={slideFixture()} variant={variant} />,
      );
      const first = markup.indexOf("Start with the evidence");
      const second = markup.indexOf("Then explain the decision");
      const third = markup.indexOf("Audience takeaway");

      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeLessThan(second);
      expect(second).toBeLessThan(third);
      expect(markup.match(/data-region=/g)).toHaveLength(9);
    },
  );

  it("exposes keyboard movement handles only while editing", () => {
    const editor = renderToStaticMarkup(
      <ContentSlideView block={slideFixture()} variant="editor" />,
    );
    const live = renderToStaticMarkup(<ContentSlideView block={slideFixture()} variant="live" />);

    expect(editor).toContain("Move Slide title. Use arrow keys to change position.");
    expect(live).not.toContain("Move Slide title.");
  });

  it.each(["editor", "preview", "live"] as const)(
    "gives every named region and text group a valid group role in %s mode",
    (variant) => {
      const markup = renderToStaticMarkup(
        <ContentSlideView block={slideFixture()} variant={variant} />,
      );
      const labelledDivs = markup.match(/<div\b[^>]*aria-label="[^"]*"[^>]*>/g) ?? [];

      expect(labelledDivs).toHaveLength(12);
      expect(labelledDivs.every((tag) => tag.includes('role="group"'))).toBe(true);
      expect(markup).toContain('aria-label="Top left region"');
      expect(markup).toContain('aria-label="Slide title, Bottom left"');
    },
  );
});

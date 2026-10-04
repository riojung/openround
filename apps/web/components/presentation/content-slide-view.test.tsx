import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createContentBlock } from "../../lib/presentation-builder";
import { ContentSlideView } from "./content-slide-view";

function slideFixture() {
  const block = createContentBlock();
  block.textElements = [
    {
      ...block.textElements[0]!,
      text: "Audience takeaway",
      region: "bottom_left",
      order: 0,
      frame: { x: 2, y: 70, width: 28, height: 20 },
    },
    {
      ...block.textElements[1]!,
      text: "Start with the evidence",
      region: "top_right",
      order: 0,
      frame: { x: 68, y: 5, width: 28, height: 20 },
    },
    {
      id: "second-body",
      role: "body",
      text: "Then explain the decision",
      region: "middle_left",
      order: 0,
      frame: { x: 2, y: 40, width: 28, height: 20 },
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

    expect(editor).toContain("Move Slide title. Drag to position or use arrow keys to nudge.");
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

  it("uses the same resolved percentage frames in editor, preview, and live output", () => {
    const block = slideFixture();
    const arrangements = (["editor", "preview", "live"] as const).map((variant) => {
      const markup = renderToStaticMarkup(<ContentSlideView block={block} variant={variant} />);
      return markup.match(/data-frame="[^"]*"/g);
    });

    expect(arrangements[0]).toEqual(arrangements[1]);
    expect(arrangements[1]).toEqual(arrangements[2]);
    expect(arrangements[0]).toContain(
      'data-frame="{&quot;x&quot;:2,&quot;y&quot;:70,&quot;width&quot;:28,&quot;height&quot;:20}"',
    );
  });

  it("shows the editor grid by default and supports hiding it", () => {
    const block = slideFixture();
    const editor = renderToStaticMarkup(<ContentSlideView block={block} variant="editor" />);
    const hiddenEditor = renderToStaticMarkup(
      <ContentSlideView block={block} showGuides={false} variant="editor" />,
    );
    const preview = renderToStaticMarkup(<ContentSlideView block={block} variant="preview" />);

    expect(editor).toContain('aria-hidden="true"');
    expect(editor).toContain('viewBox="0 0 100 100"');
    expect(hiddenEditor).not.toContain('viewBox="0 0 100 100"');
    expect(preview).not.toContain('viewBox="0 0 100 100"');
  });

  it("exposes a keyboard-operable resize handle for the selected editor element", () => {
    const block = slideFixture();
    const markup = renderToStaticMarkup(
      <ContentSlideView
        block={block}
        onChangeFrame={() => {}}
        selectedElementId={block.textElements[0]!.id}
        variant="editor"
      />,
    );

    expect(markup).toContain(
      'aria-label="Resize Slide title. Use arrow keys to change width and height."',
    );
  });
});

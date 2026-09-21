import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeFirstRunActions } from "./home-first-run-actions";

describe("Home first-run actions", () => {
  it("links an editor to creation and the permanent quick-start guide", () => {
    const markup = renderToStaticMarkup(
      <HomeFirstRunActions canEdit createHref="/create" guideAvailable />,
    );

    expect(markup).toContain('href="/create"');
    expect(markup).toContain('href="/help#quick-start"');
    expect(markup).toContain("Watch the 1-minute quick start");
  });

  it("keeps guidance available without showing a creation action to a viewer", () => {
    const markup = renderToStaticMarkup(
      <HomeFirstRunActions canEdit={false} createHref="/create" guideAvailable />,
    );

    expect(markup).not.toContain("Create your first artifact");
    expect(markup).toContain('href="/help#quick-start"');
  });

  it("does not link to a video guide when its covered features are unavailable", () => {
    const editorMarkup = renderToStaticMarkup(
      <HomeFirstRunActions canEdit createHref="/dashboard" guideAvailable={false} />,
    );
    const viewerMarkup = renderToStaticMarkup(
      <HomeFirstRunActions canEdit={false} createHref="/dashboard" guideAvailable={false} />,
    );

    expect(editorMarkup).toContain('href="/dashboard"');
    expect(editorMarkup).not.toContain("/help#quick-start");
    expect(viewerMarkup).toBe("");
  });
});

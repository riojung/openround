import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../../test-utils/english-locale";
import { RoundLibraryViewToggle } from "./round-library-view-toggle";

vi.mock("next/navigation", () => ({
  usePathname: () => "/library",
}));

describe("RoundLibraryViewToggle", () => {
  it("exposes a labelled, pressed-state view choice", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(<RoundLibraryViewToggle onChange={() => undefined} value="list" />),
    );

    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-label="Round library view"');
    expect(markup).toContain('aria-label="Grid view" aria-pressed="false"');
    expect(markup).toContain('aria-label="List view" aria-pressed="true"');
  });
});

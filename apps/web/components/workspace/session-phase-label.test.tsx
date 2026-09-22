import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../../test-utils/english-locale";
import { SessionPhaseLabel } from "./session-phase-label";

vi.mock("next/navigation", () => ({
  usePathname: () => "/sessions",
}));

describe("SessionPhaseLabel", () => {
  it("uses catalog copy for known phases", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(<SessionPhaseLabel phase="question_open" />),
    );

    expect(markup).toContain(">Question open</span>");
  });

  it("keeps forward-compatible phase values inside an explicit English boundary", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(<SessionPhaseLabel phase="future_phase" />),
    );

    expect(markup).toContain('lang="en-CA">future phase</span>');
  });
});

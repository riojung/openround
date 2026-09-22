import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../test-utils/english-locale";
import { ResponseDistributionView } from "./response-distribution";

vi.mock("next/navigation", () => ({
  usePathname: () => "/host/test-session",
}));

describe("ResponseDistributionView", () => {
  it("labels multi-select percentages by respondents", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <ResponseDistributionView
          distribution={{
            kind: "choice",
            respondents: 5,
            totalSelections: 4,
            percentBasis: "respondents",
            buckets: [{ value: "choice-1", label: "Option A", count: 4, percent: 80 }],
          }}
        />,
      ),
    );
    expect(markup).toContain("percent of respondents");
    expect(markup).toContain('<span lang="">Option A</span>');
  });

  it("keeps numeric evidence aggregate-only", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <ResponseDistributionView
          distribution={{ kind: "numeric", respondents: 5, correct: 3, incorrect: 2 }}
        />,
      ),
    );
    expect(markup).toContain("3 correct");
    expect(markup).toContain("2 incorrect");
    expect(markup).toContain("60% correct");
  });
});

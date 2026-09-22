import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../../test-utils/english-locale";

vi.mock("next/navigation", () => ({
  usePathname: () => "/presentation/presentation-1",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { PresentationBuilder } from "./presentation-builder";

describe("Presentation Builder UI", () => {
  it("announces its initial loading state while the draft and local recovery are resolved", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(<PresentationBuilder presentationId="presentation-1" />),
    );

    expect(markup).toContain("<main");
    expect(markup).toContain("Opening presentation builder…");
    expect(markup).toContain('aria-hidden="true"');
  });
});

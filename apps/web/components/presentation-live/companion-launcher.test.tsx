import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../../test-utils/english-locale";
import { PresentationCompanionLauncher } from "./companion-launcher";
import { CompanionOverlay } from "./companion-overlay";

vi.mock("next/navigation", () => ({ usePathname: () => "/presentation-session/session/host" }));

describe("Presentation companion surfaces", () => {
  it("exposes launch only to editors in an enabled workspace", () => {
    const markup = (enabled: boolean, canEdit: boolean) =>
      renderToStaticMarkup(
        withEnglishLocale(
          <PresentationCompanionLauncher sessionId="session" enabled={enabled} canEdit={canEdit} />,
        ),
      );
    expect(markup(true, true)).toContain("Launch companion");
    expect(markup(false, true)).toBe("");
    expect(markup(true, false)).toBe("");
  });

  it("labels the native modal and provides a close action whose meaning is explicit", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <CompanionOverlay title="Join this Presentation" onClose={vi.fn()}>
          <p>Join code 1234567</p>
        </CompanionOverlay>,
      ),
    );
    expect(markup).toContain('aria-label="Join this Presentation"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("Return to deck");
    expect(markup).toContain("Close this overlay to return to the companion controls.");
    expect(markup).not.toContain("desktop");
  });
});

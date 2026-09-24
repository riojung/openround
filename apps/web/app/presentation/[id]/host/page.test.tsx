import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../../../../test-utils/english-locale";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "presentation-1" }),
  usePathname: () => "/presentation/presentation-1/host",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { PresentationSessionCreationControls } from "./page";

function renderCreationControls(liveCreationAvailable: boolean) {
  return renderToStaticMarkup(
    withEnglishLocale(
      <PresentationSessionCreationControls
        busy={false}
        currentVersionId="presentation-version-1"
        error=""
        liveCreationAvailable={liveCreationAvailable}
        onStart={vi.fn()}
      />,
    ),
  );
}

describe("Presentation host live-session creation controls", () => {
  it("disables Start and explains the pause when realtime creation is unavailable", () => {
    const markup = renderCreationControls(false);

    expect(markup).toContain(
      "Starting new live Presentation sessions is paused for this workspace.",
    );
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Start live session<\/button>/);
  });

  it("allows Start when realtime creation is available and content is published", () => {
    const markup = renderCreationControls(true);

    expect(markup).not.toContain(
      "Starting new live Presentation sessions is paused for this workspace.",
    );
    expect(markup).toMatch(/<button(?![^>]*disabled)[^>]*>Start live session<\/button>/);
  });
});

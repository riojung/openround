import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../../test-utils/english-locale";

vi.mock("next/navigation", () => ({
  usePathname: () => "/presentation/presentation-1",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const workspace = vi.hoisted(() => ({
  creator: { workspaceId: "workspace-1" } as { workspaceId: string } | null,
  error: "",
  canEdit: true,
  productFeatures: {},
  refreshAccount: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../workspace/workspace-provider", () => ({ useWorkspace: () => workspace }));

import { PresentationBuilder } from "./presentation-builder";

describe("Presentation Builder UI", () => {
  beforeEach(() => {
    workspace.creator = { workspaceId: "workspace-1" };
    workspace.error = "";
  });
  it("announces its initial loading state while the draft and local recovery are resolved", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(<PresentationBuilder presentationId="presentation-1" />),
    );

    expect(markup).toContain("<main");
    expect(markup).toContain("Opening presentation builder…");
    expect(markup).toContain('aria-hidden="true"');
  });

  it("shows a workspace error and retry instead of an endless opening state", () => {
    workspace.creator = null;
    workspace.error = "The workspace request failed.";
    const markup = renderToStaticMarkup(
      withEnglishLocale(<PresentationBuilder presentationId="presentation-1" />),
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain(workspace.error);
    expect(markup).toContain("Retry workspace");
    expect(markup).not.toContain("Opening presentation builder");
  });
});

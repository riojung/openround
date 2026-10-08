import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({ enabled: true, canEdit: true }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock("../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({
    canEdit: fixtures.canEdit,
    creator: { workspaceId: "workspace" },
    productFeatures: { recoveryPacks: fixtures.enabled },
  }),
}));

vi.mock("../../components/workspace/workspace-shell", () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

import RecoveryPacksPage from "./page";

describe("Recovery Pack library capability notice", () => {
  it.each([
    [true, true],
    [true, false],
    [false, true],
  ])("mounts trusted-source creation only when enabled=%s and editable=%s", (enabled, canEdit) => {
    fixtures.enabled = enabled!;
    fixtures.canEdit = canEdit!;
    const markup = renderToStaticMarkup(<RecoveryPacksPage />);
    expect(markup.includes("Draft a Recovery Pack from a trusted source")).toBe(enabled && canEdit);
    expect(markup).toContain("Your Packs");
  });
  it.each([true, false])(
    "keeps insertion, review, and live playback availability accurate with authoring enabled=%s",
    (enabled) => {
      fixtures.enabled = enabled;
      fixtures.canEdit = true;
      const markup = renderToStaticMarkup(<RecoveryPacksPage />);

      expect(markup).toContain(
        "With Pack authoring enabled, insert published Packs into Round or Presentation drafts",
      );
      expect(markup).toContain(
        "review updates against the accepted baseline, local checkpoints, and latest published Pack",
      );
      expect(markup).toContain(
        "References stay frozen until you accept an update; existing published content and sessions are unchanged",
      );
      expect(markup).toContain(
        "Live explanation or worked-example playback is available in eligible new Round or Presentation sessions when enabled for the workspace",
      );
      expect(markup).toContain(
        "The facilitator explicitly selects a card after revealing the Pack diagnostic",
      );
      expect(markup).toContain(
        "Standalone delayed-probe practice is available from a published Pack with a delayed probe",
      );
      expect(markup).toContain(
        "when Pack authoring and practice assignments are enabled and the workspace has Pro follow-ups",
      );
      expect(markup).toContain(
        "Full-sequence practice uses the frozen diagnostic, intervention cards, and linked recheck",
      );
      expect(markup).toContain("without requiring a delayed probe");
      expect(markup).toContain("Delayed recovery trails and Companion insertion are not available");
      expect(markup).not.toContain("not available yet");
      if (!enabled) expect(markup).toContain("Pack authoring is not enabled for this workspace");
    },
  );
});

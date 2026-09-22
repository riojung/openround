import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../../test-utils/english-locale";

const fixtures = vi.hoisted(() => ({
  workspace: {
    canEdit: true,
    productFeatures: {
      roundExperiences: true,
      audiencePulse: true,
      roomChat: true,
      uxBeta: true,
      recoveryRehearsal: true,
      practiceAssignments: true,
      workspaceShell: true,
      builderV2: true,
      presentations: true,
      groups: true,
      discover: true,
    },
  },
}));

vi.mock("../../components/workspace/workspace-shell", () => ({
  WorkspacePage: ({
    children,
    requireBeta,
    title,
  }: {
    children: ReactNode;
    requireBeta?: boolean;
    title: string;
  }) => (
    <main>
      <h1>{title}</h1>
      <span data-require-beta={String(requireBeta)} />
      {children}
    </main>
  ),
}));

vi.mock("../../components/workspace/workspace-provider", () => ({
  useWorkspace: () => fixtures.workspace,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/help",
}));

import HelpPage from "./page";

describe("Help centre video guides", () => {
  beforeEach(() => {
    fixtures.workspace.canEdit = true;
    for (const feature of [
      "uxBeta",
      "practiceAssignments",
      "workspaceShell",
      "builderV2",
      "presentations",
      "groups",
      "discover",
    ] as const) {
      fixtures.workspace.productFeatures[feature] = true;
    }
  });

  it("renders both captioned guides, transcripts, and direct next steps", () => {
    const markup = renderToStaticMarkup(withEnglishLocale(<HelpPage />));

    expect(markup).toContain('data-require-beta="false"');
    expect(markup).toContain('id="quick-start"');
    expect(markup).toContain('id="round-builder-guide"');
    expect(markup).toContain('src="/guides/openround-quick-start.mp4"');
    expect(markup).toContain('src="/guides/openround-builder-guide.mp4"');
    expect(markup).toContain('src="/guides/openround-quick-start.vtt"');
    expect(markup).toContain('src="/guides/openround-builder-guide.vtt"');
    expect(markup.match(/kind="captions"/g)).toHaveLength(2);
    expect(markup.match(/controls=""/g)).toHaveLength(2);
    expect(markup.match(/preload="none"/g)).toHaveLength(2);
    expect(markup.match(/Read transcript for/g)).toHaveLength(2);
    expect(markup).toContain("Quick start: create your first Round");
    expect(markup).toContain("Workspace and builder guide");
    expect(markup).toContain("Every route creates a reviewable draft.");
    expect(markup).toContain("The Builder has three working areas.");
    expect(markup).toContain('href="/create?start=starters"');
    expect(markup).toContain('href="/create?start=blank"');
  });

  it("shows accurate classic guidance without beta-only media or links", () => {
    fixtures.workspace.productFeatures.uxBeta = false;
    fixtures.workspace.productFeatures.practiceAssignments = false;
    fixtures.workspace.productFeatures.workspaceShell = false;
    fixtures.workspace.productFeatures.builderV2 = false;
    fixtures.workspace.productFeatures.presentations = false;
    fixtures.workspace.productFeatures.groups = false;
    fixtures.workspace.productFeatures.discover = false;

    const markup = renderToStaticMarkup(withEnglishLocale(<HelpPage />));

    expect(markup).toContain("Use the classic Round workflow");
    expect(markup).toContain("Open the dashboard, name a checkpoint set");
    expect(markup).toContain('href="/dashboard"');
    expect(markup).not.toContain("openround-quick-start.mp4");
    expect(markup).not.toContain('href="/create?start=starters"');
    expect(markup).not.toContain("Presentations have their own grounded starting methods");
    expect(markup).not.toContain("Groups lets facilitator teams");
  });

  it("hides combined videos when an independently rolled-out capability is unavailable", () => {
    fixtures.workspace.productFeatures.presentations = false;

    const markup = renderToStaticMarkup(withEnglishLocale(<HelpPage />));

    expect(markup).toContain("Use the enabled Round Builder");
    expect(markup).toContain('href="/create?start=starters"');
    expect(markup).not.toContain("openround-quick-start.mp4");
    expect(markup).not.toContain('href="/create?start=blank"');
  });

  it("sends read-only members to Library instead of a creation route", () => {
    fixtures.workspace.canEdit = false;

    const markup = renderToStaticMarkup(withEnglishLocale(<HelpPage />));

    expect(markup.match(/href="\/library"/g)?.length).toBeGreaterThan(1);
    expect(markup).toContain("Open Library");
    expect(markup).not.toContain("Try a starter Round");
    expect(markup).not.toContain("Start a blank Round");
  });
});

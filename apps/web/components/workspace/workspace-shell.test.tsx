import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  pathname: "/library",
  push: vi.fn(),
  replace: vi.fn(),
  workspace: {
    creator: {
      userId: "user-1",
      workspaceId: "workspace-1",
      email: "owner@example.com",
      segment: "workplace" as const,
      role: "owner" as const,
      plan: "pro" as const,
    },
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
    loading: false,
    error: "",
    canEdit: true,
    signOut: vi.fn(),
    startUpgrade: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => fixtures.pathname,
  useRouter: () => ({ push: fixtures.push, replace: fixtures.replace }),
}));

vi.mock("./workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => fixtures.workspace,
}));

import { WorkspaceFeatureGate, WorkspaceShell } from "./workspace-shell";

describe("professional workspace shell", () => {
  beforeEach(() => {
    fixtures.pathname = "/library";
    fixtures.workspace.canEdit = true;
    fixtures.workspace.productFeatures.uxBeta = true;
    fixtures.workspace.productFeatures.workspaceShell = true;
    fixtures.workspace.productFeatures.builderV2 = true;
    fixtures.workspace.productFeatures.presentations = true;
    fixtures.workspace.productFeatures.groups = true;
    fixtures.workspace.productFeatures.discover = true;
    fixtures.push.mockClear();
    fixtures.replace.mockClear();
  });

  it("exposes the complete task navigation and marks Library current", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceShell description="Workspace test" title="Library">
        <p>Workspace content</p>
      </WorkspaceShell>,
    );

    for (const [href, label] of [
      ["/home", "Home"],
      ["/library", "Library"],
      ["/sessions", "Sessions"],
      ["/assignments", "Assignments"],
      ["/results", "Results"],
      ["/discover", "Discover"],
      ["/groups", "Groups"],
      ["/account", "Workspace"],
    ]) {
      expect(markup).toContain(`href="${href}"`);
      expect(markup).toContain(label);
    }
    expect(markup).toMatch(/aria-current="page"[^>]*href="\/library"/);
    expect(markup).toContain("Workspace content");
  });

  it("keeps search, activity, help, account, and both Create destinations global", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceShell title="Home">
        <p>Home</p>
      </WorkspaceShell>,
    );

    expect(markup).toContain('role="search"');
    expect(markup).toContain('placeholder="Search your library"');
    expect(markup).toContain('href="/activity"');
    expect(markup).toContain('href="/help"');
    expect(markup).toContain('aria-label="Open account and workspace settings"');
    expect(markup).toContain("Create new");
    expect(markup).toContain('href="/create"');
    expect(markup).toContain('href="/create/presentation"');
    expect(markup).toContain("Questions, diagnosis, rechecks, and practice");
  });

  it("does not expose creation controls to a read-only member", () => {
    fixtures.workspace.canEdit = false;
    const markup = renderToStaticMarkup(
      <WorkspaceShell title="Library">
        <p>Read only</p>
      </WorkspaceShell>,
    );

    expect(markup).not.toContain("Create new");
    expect(markup).not.toContain('href="/create/presentation"');
    expect(markup).toContain("Read only");
  });

  it("removes independently disabled destinations and preserves the legacy Round fallback", () => {
    fixtures.workspace.productFeatures.builderV2 = false;
    fixtures.workspace.productFeatures.presentations = false;
    fixtures.workspace.productFeatures.groups = false;
    fixtures.workspace.productFeatures.discover = false;

    const markup = renderToStaticMarkup(
      <WorkspaceShell title="Library">
        <p>Feature-gated workspace</p>
      </WorkspaceShell>,
    );

    expect(markup).toContain('href="/dashboard"');
    expect(markup).not.toContain('href="/create/presentation"');
    expect(markup).not.toContain('href="/groups"');
    expect(markup).not.toContain('href="/discover"');
  });

  it("keeps explicitly non-beta surfaces available when the workspace shell rollout is off", () => {
    fixtures.workspace.productFeatures.uxBeta = false;
    fixtures.workspace.productFeatures.workspaceShell = false;

    const markup = renderToStaticMarkup(
      <WorkspaceShell requireBeta={false} title="Legacy Round workflow">
        <p>Legacy, account, practice, and assignment content</p>
      </WorkspaceShell>,
    );

    expect(markup).toContain("Legacy, account, practice, and assignment content");
    expect(markup).not.toContain("Loading your workspace");
  });

  it("continues to gate beta surfaces when the workspace shell rollout is off", () => {
    fixtures.workspace.productFeatures.workspaceShell = false;

    const markup = renderToStaticMarkup(
      <WorkspaceShell title="Library">
        <p>Beta workspace content</p>
      </WorkspaceShell>,
    );

    expect(markup).toContain("Loading your workspace");
    expect(markup).not.toContain("Beta workspace content");
  });

  it("fails closed on direct feature routes", () => {
    fixtures.workspace.productFeatures.presentations = false;
    const disabled = renderToStaticMarkup(
      <WorkspaceFeatureGate feature="presentations">
        <p>Presentation builder</p>
      </WorkspaceFeatureGate>,
    );
    expect(disabled).toContain("Loading your workspace");
    expect(disabled).not.toContain("Presentation builder");

    fixtures.workspace.productFeatures.presentations = true;
    const enabled = renderToStaticMarkup(
      <WorkspaceFeatureGate feature="presentations">
        <p>Presentation builder</p>
      </WorkspaceFeatureGate>,
    );
    expect(enabled).toContain("Presentation builder");
  });
});

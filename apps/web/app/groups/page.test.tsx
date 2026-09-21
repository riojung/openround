import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  canEdit: true,
  creator: {
    userId: "user-1",
    workspaceId: "workspace-1",
    email: "owner@example.com",
    segment: "workplace" as const,
    role: "owner" as const,
    plan: "pro" as const,
  },
}));

vi.mock("../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({ canEdit: fixtures.canEdit, creator: fixtures.creator }),
}));

vi.mock("../../components/workspace/workspace-shell", () => ({
  WorkspaceShell: ({
    actions,
    children,
    description,
    eyebrow,
    title,
  }: {
    actions?: ReactNode;
    children: ReactNode;
    description: string;
    eyebrow: string;
    title: string;
  }) => (
    <main>
      <span>{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
      {actions}
      {children}
    </main>
  ),
}));

import GroupsPage from "./page";

describe("Groups workspace", () => {
  beforeEach(() => {
    fixtures.canEdit = true;
  });

  it("presents a professional collaboration workspace with creation and selection", () => {
    const markup = renderToStaticMarkup(<GroupsPage />);

    expect(markup).toContain("Groups");
    expect(markup).toContain("Create group");
    expect(markup).toContain('placeholder="Search groups"');
    expect(markup).toContain('aria-label="Workspace groups"');
    expect(markup).toContain("Loading groups");
  });

  it("keeps read-only members inside the group workspace without offering creation", () => {
    fixtures.canEdit = false;
    const markup = renderToStaticMarkup(<GroupsPage />);

    expect(markup).toContain("Facilitator collaboration");
    expect(markup).toContain('placeholder="Search groups"');
    expect(markup).not.toContain("Create group");
  });
});

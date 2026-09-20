import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  query: "",
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: fixtures.push }),
  useSearchParams: () => new URLSearchParams(fixtures.query),
}));

vi.mock("../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({ canEdit: true, entitlements: { csvExport: true } }),
}));

vi.mock("../../components/workspace/workspace-shell", () => ({
  WorkspaceShell: ({ children, title }: { children: ReactNode; title: string }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));

vi.mock("../../components/authoring-assistant", () => ({
  AuthoringAssistant: () => <div>Source authoring workflow</div>,
}));

vi.mock("../../components/checkpoint-set-import", () => ({
  CheckpointSetImport: () => <div>Structured import workflow</div>,
}));

vi.mock("../../components/workspace/starter-gallery", () => ({
  StarterGallery: () => <div>Starter gallery</div>,
}));

import CreatePage from "./page";

describe("Round creation launcher", () => {
  beforeEach(() => {
    fixtures.query = "";
    fixtures.push.mockClear();
  });

  it("offers four distinct, deep-linkable starting methods", () => {
    const markup = renderToStaticMarkup(<CreatePage />);

    expect(markup).toContain("How do you want to start?");
    expect(markup).toContain('href="/create?start=starters"');
    expect(markup).toContain('href="/create?start=source"');
    expect(markup).toContain('href="/create?start=import"');
    expect(markup).toContain('href="/create?start=blank"');
    expect(markup).toContain("Built for review, not instant publishing.");
    expect(markup).not.toContain("Source authoring workflow");
    expect(markup).not.toContain("Structured import workflow");
  });

  it("renders only the selected creation workflow", () => {
    fixtures.query = "start=blank";
    const markup = renderToStaticMarkup(<CreatePage />);

    expect(markup).toContain("Start a blank Round");
    expect(markup).toContain("First response type");
    expect(markup).toContain("Create Round and write question");
    expect(markup).not.toContain("Source authoring workflow");
    expect(markup).not.toContain("Structured import workflow");
    expect(markup).not.toContain("Starter gallery");
  });
});

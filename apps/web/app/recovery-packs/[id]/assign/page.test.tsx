import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type * as RecoveryPackPracticeModule from "../../../../lib/recovery-pack-practice";

const fixtures = vi.hoisted(() => ({ fetch: vi.fn(), random: vi.fn() }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "10000000-0000-4000-8000-000000000001" }),
  useSearchParams: () => new URLSearchParams("version=10000000-0000-4000-8000-000000000002"),
}));
vi.mock("../../../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({
    canEdit: true,
    productFeatures: { recoveryPacks: true, practiceAssignments: true },
    entitlements: {
      followups: true,
      reportRetentionDays: 30,
      maxPracticePersonalLinks: 2,
      maxParticipants: 100,
    },
  }),
}));
vi.mock("../../../../components/workspace/workspace-shell", () => ({
  WorkspaceShell: ({ children, title }: { children: ReactNode; title: string }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock("../../../../lib/api", () => ({
  apiFetch: fixtures.fetch,
  humanError: (error: Error) => error.message,
}));
vi.mock("../../../../lib/recovery-pack-practice", async (importOriginal) => ({
  ...(await importOriginal<typeof RecoveryPackPracticeModule>()),
  packPracticeAccessSeed: fixtures.random,
}));

import AssignPackPracticePage from "./page";

describe("Pack practice creation startup", () => {
  it("starts as read-only loading without minting a seed, creating practice, or rendering private credentials", () => {
    const first = renderToStaticMarkup(<AssignPackPracticePage />);
    const second = renderToStaticMarkup(<AssignPackPracticePage />);
    expect(first).toBe(second);
    expect(first).toContain("Loading the published delayed probe");
    expect(first).toContain("only the Pack’s delayed probe");
    expect(first).not.toContain("Create delayed-probe practice");
    expect(first).not.toContain("accessSeed");
    expect(first).not.toContain("#token=");
    expect(fixtures.fetch).not.toHaveBeenCalled();
    expect(fixtures.random).not.toHaveBeenCalled();
  });
});

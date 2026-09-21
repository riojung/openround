import { describe, expect, it } from "vitest";
import { filterLibraryItems, libraryBulkActionIds, roundBulkActionIds } from "./library-controls";

const items = [
  {
    id: "round-1",
    workspaceId: "workspace-a",
    title: "Incident response",
    description: "A live readiness check",
    status: "published" as const,
    searchTerms: ["safety", "onboarding"],
    folderId: "folder-a",
    favorite: true,
  },
  {
    id: "round-2",
    workspaceId: "workspace-a",
    title: "Recovery check",
    description: "Follow-up practice",
    status: "draft" as const,
    folderId: null,
    favorite: false,
  },
  {
    id: "round-3",
    workspaceId: "workspace-b",
    title: "Archived handbook",
    description: "Historical material",
    status: "archived" as const,
  },
];

describe("Library controls", () => {
  it("searches titles, descriptions, and supplied metadata without showing archives by default", () => {
    expect(
      filterLibraryItems(items, {
        query: "SAFETY",
        status: "active",
        ownership: "all",
        workspaceId: "workspace-a",
      }).map((item) => item.id),
    ).toEqual(["round-1"]);

    expect(
      filterLibraryItems(items, {
        query: "",
        status: "active",
        ownership: "all",
        workspaceId: "workspace-a",
      }).map((item) => item.id),
    ).toEqual(["round-1", "round-2"]);
  });

  it("combines status and workspace ownership filters", () => {
    expect(
      filterLibraryItems(items, {
        query: "",
        status: "archived",
        ownership: "workspace",
        workspaceId: "workspace-a",
      }),
    ).toEqual([]);

    expect(
      filterLibraryItems(items, {
        query: "",
        status: "archived",
        ownership: "workspace",
        workspaceId: "workspace-b",
      }).map((item) => item.id),
    ).toEqual(["round-3"]);
  });

  it("derives safe bulk targets from the selected Round statuses", () => {
    expect(roundBulkActionIds(items, new Set(["round-1", "round-3", "missing"]))).toEqual({
      duplicate: ["round-1", "round-3"],
      archive: ["round-1"],
      restore: ["round-3"],
    });
  });

  it("filters shared artifact metadata by folder and personal favorite state", () => {
    expect(
      filterLibraryItems(items, {
        query: "",
        status: "all",
        ownership: "all",
        workspaceId: "workspace-a",
        folderId: "folder-a",
      }).map((item) => item.id),
    ).toEqual(["round-1"]);
    expect(
      filterLibraryItems(items, {
        query: "",
        status: "all",
        ownership: "all",
        workspaceId: "workspace-a",
        folderId: "unfiled",
      }).map((item) => item.id),
    ).toEqual(["round-2", "round-3"]);
    expect(
      filterLibraryItems(items, {
        query: "",
        status: "all",
        ownership: "all",
        workspaceId: "workspace-a",
        favoritesOnly: true,
      }).map((item) => item.id),
    ).toEqual(["round-1"]);
    expect(libraryBulkActionIds(items, new Set(["round-1"]))).toEqual(
      roundBulkActionIds(items, new Set(["round-1"])),
    );
  });
});

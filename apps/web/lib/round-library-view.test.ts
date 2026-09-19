import { describe, expect, it } from "vitest";
import {
  readRoundLibraryView,
  roundLibraryViewStorageKey,
  writeRoundLibraryView,
} from "./round-library-view";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("Round library view preference", () => {
  it("versions and scopes the key to the workspace", () => {
    expect(roundLibraryViewStorageKey("workspace-a")).toBe(
      "openround:round-library-view:v1:workspace-a",
    );
    expect(roundLibraryViewStorageKey("workspace-b")).not.toBe(
      roundLibraryViewStorageKey("workspace-a"),
    );
  });

  it("round-trips an allowlisted view without crossing workspaces", () => {
    const storage = memoryStorage();
    writeRoundLibraryView(storage, "workspace-a", "list");

    expect(readRoundLibraryView(storage, "workspace-a")).toBe("list");
    expect(readRoundLibraryView(storage, "workspace-b")).toBe("grid");
  });

  it("falls back to grid for stale or unavailable storage", () => {
    const stale = memoryStorage({
      [roundLibraryViewStorageKey("workspace-a")]: "table",
    });
    const unavailable = {
      getItem() {
        throw new Error("blocked");
      },
    };

    expect(readRoundLibraryView(stale, "workspace-a")).toBe("grid");
    expect(readRoundLibraryView(unavailable, "workspace-a")).toBe("grid");
  });
});

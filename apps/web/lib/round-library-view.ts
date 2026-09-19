export type RoundLibraryView = "grid" | "list";

export const DEFAULT_ROUND_LIBRARY_VIEW: RoundLibraryView = "grid";

export function roundLibraryViewStorageKey(workspaceId: string) {
  return `openround:round-library-view:v1:${workspaceId}`;
}

export function readRoundLibraryView(
  storage: Pick<Storage, "getItem">,
  workspaceId: string,
): RoundLibraryView {
  try {
    const saved = storage.getItem(roundLibraryViewStorageKey(workspaceId));
    return saved === "list" || saved === "grid" ? saved : DEFAULT_ROUND_LIBRARY_VIEW;
  } catch {
    return DEFAULT_ROUND_LIBRARY_VIEW;
  }
}

export function writeRoundLibraryView(
  storage: Pick<Storage, "setItem">,
  workspaceId: string,
  view: RoundLibraryView,
) {
  try {
    storage.setItem(roundLibraryViewStorageKey(workspaceId), view);
  } catch {
    // A blocked storage API must not prevent the library view from changing in memory.
  }
}

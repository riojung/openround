export interface LiveSnapshotFence {
  requestId: number;
  revision: number;
}

/** Server revision wins; request order breaks ties between equal revisions. */
export function shouldApplyLiveSnapshot(
  current: LiveSnapshotFence,
  incoming: LiveSnapshotFence,
): boolean {
  if (incoming.revision !== current.revision) return incoming.revision > current.revision;
  return incoming.requestId >= current.requestId;
}

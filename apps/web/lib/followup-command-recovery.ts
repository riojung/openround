import type { FollowupSnapshot } from "@openround/contracts";

export type FollowupCommandAction = "answer" | "advance";
export interface FollowupCommandRecoveryState {
  busy: boolean;
  pendingAction: FollowupCommandAction | null;
}

export function mayApplyFollowupSnapshot(
  current: FollowupSnapshot | null,
  incoming: FollowupSnapshot,
) {
  return (
    !current ||
    (incoming.followupId === current.followupId &&
      incoming.attemptId === current.attemptId &&
      incoming.version >= current.version)
  );
}

/** Keep one serialized intent in memory; no bearer token or new storage entry is involved. */
export function createFollowupCommandRecovery({
  execute,
  onState,
}: {
  execute: (action: FollowupCommandAction, body: string) => Promise<FollowupSnapshot>;
  onState: (state: FollowupCommandRecoveryState) => void;
}) {
  let pending: { action: FollowupCommandAction; body: string } | null = null;
  let generation = 0;
  let state: FollowupCommandRecoveryState = { busy: false, pendingAction: null };
  const publish = (next: FollowupCommandRecoveryState) => {
    state = next;
    onState(next);
  };
  async function attempt() {
    if (!pending || state.busy) return;
    const captured = pending;
    const capturedGeneration = generation;
    publish({ busy: true, pendingAction: captured.action });
    try {
      const snapshot = await execute(captured.action, captured.body);
      if (capturedGeneration !== generation) return;
      pending = null;
      publish({ busy: false, pendingAction: null });
      return snapshot;
    } catch (error) {
      if (capturedGeneration !== generation) return;
      const { status } = (error ?? {}) as { status?: number };
      // Definitive validation/version/lifecycle denials settle this request. Transport,
      // authentication, gate pauses, and throttling retain the original ambiguous intent.
      if (status === 400 || status === 409 || status === 410 || status === 422) pending = null;
      publish({ busy: false, pendingAction: pending?.action ?? null });
      throw error;
    }
  }
  return {
    state: () => state,
    run(action: FollowupCommandAction, payload: () => object) {
      if (state.busy || pending) return Promise.resolve(undefined);
      pending = { action, body: JSON.stringify(payload()) };
      return attempt();
    },
    retry: attempt,
    reset() {
      generation += 1;
      pending = null;
      publish({ busy: false, pendingAction: null });
    },
  };
}

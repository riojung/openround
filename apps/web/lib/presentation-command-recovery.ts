import type { PresentationCommand } from "@openround/contracts";
import { isPresentationHostPassRejection } from "./presentation-host-pass";

export interface PresentationCommandRecoveryState {
  busy: boolean;
  pendingCommand: PresentationCommand | null;
}

function acknowledgementMayBeLost(error: unknown) {
  const { code, status } = (error ?? {}) as { code?: string; status?: number };
  if (typeof status === "number") return status >= 500;
  return (
    !code ||
    code === "INTERNAL_ERROR" ||
    code === "PRESENTATION_COMMAND_UNCONFIRMED" ||
    code === "PRESENTATION_RECONNECT_REQUIRED"
  );
}

function retryTemporarilyDenied(error: unknown) {
  const { code, status } = (error ?? {}) as { code?: string; status?: number };
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    code === "RATE_LIMITED" ||
    code === "RECONNECTING" ||
    code === "DEPENDENCY_UNAVAILABLE" ||
    code === "FEATURE_UNAVAILABLE" ||
    code === "UNAVAILABLE" ||
    isPresentationHostPassRejection(error)
  );
}

/** Keep the exact request until its acknowledgement resolves the action, even after a phase update. */
export function createPresentationCommandRecovery<Snapshot>({
  execute,
  onState,
}: {
  execute: (command: PresentationCommand) => Promise<Snapshot>;
  onState: (state: PresentationCommandRecoveryState) => void;
}) {
  let state: PresentationCommandRecoveryState = { busy: false, pendingCommand: null };
  const publish = (next: PresentationCommandRecoveryState) => {
    state = next;
    onState(next);
  };
  const attempt = async (command: PresentationCommand, retrying = false) => {
    // This synchronous fence also covers two clicks before React renders the disabled control.
    if (state.busy) return;
    publish({ busy: true, pendingCommand: command });
    try {
      const snapshot = await execute(command);
      publish({ busy: false, pendingCommand: null });
      return snapshot;
    } catch (error) {
      publish({
        busy: false,
        // A retry rejected before receipt lookup does not settle the original ambiguous attempt.
        pendingCommand:
          acknowledgementMayBeLost(error) || (retrying && retryTemporarilyDenied(error))
            ? command
            : null,
      });
      throw error;
    }
  };
  return {
    state: () => state,
    run(command: PresentationCommand) {
      if (state.busy || state.pendingCommand) return Promise.resolve(undefined);
      // Freeze a copy so changing picker selection or the received revision cannot alter a retry.
      const frozen = Object.freeze({
        ...command,
        ...(command.action === "start_recovery_card"
          ? { recoveryPackCard: Object.freeze({ ...command.recoveryPackCard }) }
          : {}),
      }) as PresentationCommand;
      return attempt(frozen);
    },
    retry() {
      if (!state.pendingCommand || state.busy) return Promise.resolve(undefined);
      return attempt(state.pendingCommand, true);
    },
    rebindControlToken(controlToken: string) {
      if (state.busy) return false;
      if (state.pendingCommand) {
        publish({
          ...state,
          pendingCommand: Object.freeze({ ...state.pendingCommand, controlToken }),
        });
      }
      return true;
    },
  };
}

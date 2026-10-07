import type { PresentationCommand } from "@openround/contracts";
import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./api";
import { createPresentationCommandRecovery } from "./presentation-command-recovery";

function cardCommand(): PresentationCommand {
  return {
    sessionId: "session",
    controlToken: "host-token",
    commandId: "original-command",
    expectedRevision: 8,
    action: "start_recovery_card",
    recoveryPackCard: { insertionId: "insertion", cardId: "selected-card" },
    interventionType: "example",
  };
}

describe("Presentation host command recovery", () => {
  it("retains the immutable original card request when the room has moved after acknowledgement loss", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Connection lost after the action was applied"))
      .mockResolvedValueOnce({ phase: "question_open", revision: 11 });
    const recovery = createPresentationCommandRecovery({ execute, onState: () => undefined });
    const original = cardCommand();
    await expect(recovery.run(original)).rejects.toThrow("Connection lost");
    const pending = recovery.state().pendingCommand;
    expect(pending).toEqual(original);
    expect(Object.isFrozen(pending)).toBe(true);
    expect(
      pending?.action === "start_recovery_card" && Object.isFrozen(pending.recoveryPackCard),
    ).toBe(true);
    original.expectedRevision = 11;
    if (original.action === "start_recovery_card")
      original.recoveryPackCard.cardId = "different-card";
    await expect(recovery.retry()).resolves.toEqual({ phase: "question_open", revision: 11 });
    expect(execute.mock.calls[1]?.[0]).toBe(execute.mock.calls[0]?.[0]);
    expect(execute.mock.calls[1]?.[0]).toMatchObject({
      commandId: "original-command",
      expectedRevision: 8,
      recoveryPackCard: { cardId: "selected-card" },
    });
    expect(recovery.state()).toEqual({ busy: false, pendingCommand: null });
  });

  it("serializes rapid clicks and keeps an unresolved receipt until it is retried", async () => {
    let rejectAttempt!: (error: Error) => void;
    const execute = vi.fn(
      () =>
        new Promise((_, reject) => {
          rejectAttempt = reject;
        }),
    );
    const recovery = createPresentationCommandRecovery({ execute, onState: () => undefined });
    const attempt = recovery.run(cardCommand());
    await recovery.run({ ...cardCommand(), commandId: "second-command" });
    await recovery.retry();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(recovery.state().busy).toBe(true);
    rejectAttempt(new Error("No acknowledgement"));
    await expect(attempt).rejects.toThrow("No acknowledgement");
    await recovery.run({ ...cardCommand(), commandId: "third-command" });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(recovery.state().pendingCommand?.commandId).toBe("original-command");
  });

  it("retains advance receipts too and clears authoritative rejected actions", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new ApiClientError("Unavailable", "UNAVAILABLE", 503))
      .mockRejectedValueOnce(new ApiClientError("Stale revision", "STALE_REVISION", 409));
    const recovery = createPresentationCommandRecovery({ execute, onState: () => undefined });
    const command: PresentationCommand = {
      sessionId: "session",
      controlToken: "host-token",
      commandId: "advance-command",
      expectedRevision: 3,
      action: "advance",
    };
    await expect(recovery.run(command)).rejects.toThrow("Unavailable");
    expect(recovery.state().pendingCommand).toEqual(command);
    await expect(recovery.retry()).rejects.toThrow("Stale revision");
    expect(recovery.state()).toEqual({ busy: false, pendingCommand: null });
  });

  it.each([
    ["HTTP admission limit", new ApiClientError("Try later", "RATE_LIMITED", 429)],
    ["socket admission limit", Object.assign(new Error("Try later"), { code: "RATE_LIMITED" })],
    [
      "reconnecting",
      Object.assign(new Error("Reconnect first"), { code: "PRESENTATION_RECONNECT_REQUIRED" }),
    ],
    [
      "dependency unavailable",
      Object.assign(new Error("Try later"), { code: "DEPENDENCY_UNAVAILABLE" }),
    ],
    [
      "feature temporarily unavailable",
      Object.assign(new Error("Try later"), { code: "FEATURE_UNAVAILABLE" }),
    ],
  ])("keeps an unresolved original command through a %s retry denial", async (_name, denial) => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error("Original acknowledgement lost"))
      .mockRejectedValueOnce(denial)
      .mockResolvedValueOnce({ phase: "question_open", revision: 11 });
    const recovery = createPresentationCommandRecovery({ execute, onState: () => undefined });
    await expect(recovery.run(cardCommand())).rejects.toThrow("Original acknowledgement lost");
    const original = recovery.state().pendingCommand;
    await expect(recovery.retry()).rejects.toThrow();
    expect(recovery.state().pendingCommand).toBe(original);
    await expect(recovery.retry()).resolves.toEqual({ phase: "question_open", revision: 11 });
    expect(execute.mock.calls.every(([command]) => command === original)).toBe(true);
    expect(recovery.state().pendingCommand).toBeNull();
  });

  it("clears a first-attempt admission denial because no earlier action is unresolved", async () => {
    const execute = vi.fn().mockRejectedValue(new ApiClientError("Try later", "RATE_LIMITED", 429));
    const recovery = createPresentationCommandRecovery({ execute, onState: () => undefined });
    await expect(recovery.run(cardCommand())).rejects.toThrow("Try later");
    expect(recovery.state()).toEqual({ busy: false, pendingCommand: null });
  });

  it.each(["card", "advance"])(
    "preserves an ambiguous %s receipt through pass rejection and explicit replacement",
    async (kind) => {
      const execute = vi
        .fn()
        .mockRejectedValueOnce(new Error("Acknowledgement lost"))
        .mockRejectedValueOnce(new ApiClientError("Host pass revoked", "UNAUTHORIZED", 401))
        .mockResolvedValueOnce({ phase: "finished", revision: 12 });
      const recovery = createPresentationCommandRecovery({ execute, onState: () => undefined });
      const command: PresentationCommand =
        kind === "card"
          ? cardCommand()
          : {
              sessionId: "session",
              controlToken: "host-token",
              commandId: "original-command",
              expectedRevision: 8,
              action: "advance",
            };
      await expect(recovery.run(command)).rejects.toThrow("Acknowledgement lost");
      const pending = recovery.state().pendingCommand!;
      await expect(recovery.retry()).rejects.toThrow("Host pass revoked");
      expect(recovery.state().pendingCommand).toBe(pending);
      expect(recovery.rebindControlToken("replacement-pass")).toBe(true);
      const rebound = recovery.state().pendingCommand!;
      const { controlToken: oldToken, ...originalIdentity } = pending;
      const { controlToken: newToken, ...reboundIdentity } = rebound;
      expect(oldToken).toBe("host-token");
      expect(newToken).toBe("replacement-pass");
      expect(reboundIdentity).toEqual(originalIdentity);
      expect(Object.isFrozen(rebound)).toBe(true);
      await expect(recovery.retry()).resolves.toEqual({ phase: "finished", revision: 12 });
      expect(execute.mock.calls[2]?.[0]).toEqual({ ...command, controlToken: "replacement-pass" });
      expect(recovery.state().pendingCommand).toBeNull();
    },
  );

  it("clears a freshly rejected scoped action but cannot rebind a command while in flight", async () => {
    let reject!: (error: Error) => void;
    const execute = vi.fn(
      () =>
        new Promise((_, rejectAttempt) => {
          reject = rejectAttempt;
        }),
    );
    const recovery = createPresentationCommandRecovery({ execute, onState: () => undefined });
    const pending = recovery.run(cardCommand());
    expect(recovery.rebindControlToken("replacement-pass")).toBe(false);
    expect(recovery.state().pendingCommand?.controlToken).toBe("host-token");
    reject(new ApiClientError("Host pass revoked", "UNAUTHORIZED", 401));
    await expect(pending).rejects.toThrow("Host pass revoked");
    expect(recovery.state().pendingCommand).toBeNull();
  });
});

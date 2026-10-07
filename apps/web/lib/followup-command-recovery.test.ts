import type { FollowupSnapshot } from "@openround/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createFollowupCommandRecovery,
  mayApplyFollowupSnapshot,
} from "./followup-command-recovery";

function snapshot(version = 4, patch: Partial<FollowupSnapshot> = {}): FollowupSnapshot {
  return {
    followupId: "followup",
    attemptId: "attempt",
    version,
    phase: "intervention",
    practiceMode: "full_sequence",
    ...patch,
  } as FollowupSnapshot;
}

describe("private followup command recovery", () => {
  it("keeps exact answer identity/version/response through ACK loss and transient denials", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("ACK lost"))
      .mockRejectedValueOnce({ status: 503 })
      .mockRejectedValueOnce({ status: 401 })
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValueOnce(snapshot(5));
    const onState = vi.fn();
    const manager = createFollowupCommandRecovery({ execute, onState });
    const choices = ["original"];
    const payload = {
      idempotencyKey: "same-receipt",
      questionId: "diagnostic",
      expectedVersion: 4,
      response: { kind: "choice", choiceIds: choices },
      confidence: 2,
    };
    const factory = vi.fn(() => payload);
    await expect(manager.run("answer", factory)).rejects.toThrow("ACK lost");
    choices.push("new-selection");
    payload.expectedVersion = 9;
    await manager.run("answer", factory);
    expect(factory).toHaveBeenCalledTimes(1);
    for (const status of [503, 401, 429])
      await expect(manager.retry()).rejects.toMatchObject({ status });
    expect(manager.state()).toEqual({ busy: false, pendingAction: "answer" });
    expect(JSON.stringify(onState.mock.calls)).not.toContain("choiceIds");
    expect(await manager.retry()).toEqual(snapshot(5));
    expect(
      execute.mock.calls.every(
        ([action, body]) => action === "answer" && body === execute.mock.calls[0]![1],
      ),
    ).toBe(true);
    expect(JSON.parse(execute.mock.calls[0]![1] as string)).toMatchObject({
      expectedVersion: 4,
      response: { choiceIds: ["original"] },
      confidence: 2,
    });
    expect(manager.state().pendingAction).toBeNull();
  });

  it("replays an advance with its original version/key after authoritative phase change", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("ACK lost"))
      .mockResolvedValueOnce(snapshot(9, { phase: "question_open" }));
    const manager = createFollowupCommandRecovery({ execute, onState: () => undefined });
    const source = { expectedVersion: 4, idempotencyKey: "same-advance" };
    await expect(manager.run("advance", () => source)).rejects.toThrow();
    source.expectedVersion = 8;
    source.idempotencyKey = "different";
    expect(await manager.retry()).toEqual(snapshot(9, { phase: "question_open" }));
    expect(execute.mock.calls[1]).toEqual(execute.mock.calls[0]);
  });

  it("prevents duplicate clicks and discards stale completion after access replacement", async () => {
    let resolve!: (value: FollowupSnapshot) => void;
    const execute = vi.fn(
      () =>
        new Promise<FollowupSnapshot>((done) => {
          resolve = done;
        }),
    );
    const onState = vi.fn();
    const manager = createFollowupCommandRecovery({ execute, onState });
    const factory = vi.fn(() => ({ expectedVersion: 4, idempotencyKey: "key" }));
    const request = manager.run("advance", factory);
    await manager.run("advance", factory);
    await manager.retry();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(1);
    manager.reset();
    const published = onState.mock.calls.length;
    resolve(snapshot(5));
    expect(await request).toBeUndefined();
    expect(onState).toHaveBeenCalledTimes(published);
    expect(manager.state()).toEqual({ busy: false, pendingAction: null });
  });

  it("settles definitive conflicts without constructing another intent", async () => {
    const execute = vi.fn().mockRejectedValue({ status: 409 });
    const manager = createFollowupCommandRecovery({ execute, onState: () => undefined });
    await expect(
      manager.run("advance", () => ({ expectedVersion: 4, idempotencyKey: "key" })),
    ).rejects.toMatchObject({ status: 409 });
    expect(manager.state().pendingAction).toBeNull();
    expect(await manager.retry()).toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("adopts only monotonic snapshots for the same attempt, never a late older frame", () => {
    expect(mayApplyFollowupSnapshot(null, snapshot())).toBe(true);
    expect(mayApplyFollowupSnapshot(snapshot(5), snapshot(4))).toBe(false);
    expect(mayApplyFollowupSnapshot(snapshot(5), snapshot(5))).toBe(true);
    expect(mayApplyFollowupSnapshot(snapshot(5), snapshot(6))).toBe(true);
    expect(mayApplyFollowupSnapshot(snapshot(5), snapshot(6, { attemptId: "other" }))).toBe(false);
    expect(mayApplyFollowupSnapshot(snapshot(5), snapshot(6, { followupId: "other" }))).toBe(false);
  });
});

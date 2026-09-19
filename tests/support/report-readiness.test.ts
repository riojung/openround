import { describe, expect, it, vi } from "vitest";
import { waitForReadyReport } from "./report-readiness.js";

describe("waitForReadyReport", () => {
  it("waits through pending placeholders and returns only the ready report", async () => {
    const statuses: Array<"pending" | "ready"> = ["pending", "pending", "ready"];
    const load = vi.fn(async () => ({ status: statuses.shift() ?? "ready", answerCount: 12 }));

    await expect(
      waitForReadyReport(load, { timeoutMs: 1_000, pollIntervalMs: 0 }),
    ).resolves.toEqual({ status: "ready", answerCount: 12 });
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("fails immediately when report generation has failed", async () => {
    await expect(
      waitForReadyReport(async () => ({ status: "failed" as const }), {
        timeoutMs: 1_000,
        pollIntervalMs: 0,
      }),
    ).rejects.toThrow("Report generation failed");
  });

  it("aborts a stalled report request at the overall deadline", async () => {
    vi.useFakeTimers();
    try {
      const waiting = waitForReadyReport(
        (signal) =>
          new Promise<{ status: "ready" }>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          }),
        { timeoutMs: 500, pollIntervalMs: 50 },
      );
      const rejection = expect(waiting).rejects.toThrow(
        "Timed out after 500 ms waiting for a ready report",
      );

      await vi.advanceTimersByTimeAsync(500);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});

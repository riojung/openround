export interface ReportWithStatus {
  status: "pending" | "ready" | "failed";
}

export interface ReportReadinessOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

function timeoutError(timeoutMs: number, lastStatus: ReportWithStatus["status"] | null) {
  return new Error(
    `Timed out after ${timeoutMs} ms waiting for a ready report (last status: ${lastStatus ?? "unknown"})`,
  );
}

/**
 * Polls the report endpoint until the asynchronous report worker has replaced the
 * pending placeholder. Each request is bounded by the overall deadline too, so a
 * stalled fetch cannot leave a smoke or capacity gate running indefinitely.
 */
export async function waitForReadyReport<T extends ReportWithStatus>(
  load: (signal: AbortSignal) => Promise<T>,
  options: ReportReadinessOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Report readiness timeout must be greater than zero");
  }
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) {
    throw new Error("Report readiness poll interval must not be negative");
  }

  const deadline = Date.now() + timeoutMs;
  let lastStatus: ReportWithStatus["status"] | null = null;
  while (Date.now() < deadline) {
    const controller = new AbortController();
    const remainingMs = Math.max(1, deadline - Date.now());
    const requestTimer = setTimeout(() => controller.abort(), remainingMs);
    let report: T;
    try {
      report = await load(controller.signal);
    } catch (error) {
      if (controller.signal.aborted) throw timeoutError(timeoutMs, lastStatus);
      throw error;
    } finally {
      clearTimeout(requestTimer);
    }

    lastStatus = report.status;
    if (report.status === "ready") return report;
    if (report.status === "failed") throw new Error("Report generation failed");

    const delayMs = Math.min(pollIntervalMs, Math.max(0, deadline - Date.now()));
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw timeoutError(timeoutMs, lastStatus);
}

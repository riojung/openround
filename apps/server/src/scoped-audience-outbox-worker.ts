import type { ScopedAudienceEvent } from "@openround/contracts";
import type { AudienceScopeRepository } from "@openround/db";

/** At-least-once delivery with lease fencing; clients deduplicate the immutable eventId. */
export class ScopedAudienceOutboxWorker {
  constructor(
    private readonly repository: AudienceScopeRepository,
    private readonly publish: (event: ScopedAudienceEvent) => Promise<void>,
    private readonly leaseMs = 30_000,
  ) {}

  async runOnce(now = new Date()) {
    const record = await this.repository.claimOutbox(now, new Date(now.getTime() + this.leaseMs));
    if (!record) return "idle" as const;
    try {
      await this.publish(record.event);
      return (await this.repository.completeOutbox(
        record.workspaceId,
        record.event.eventId,
        record.leaseToken!,
        new Date(),
      ))
        ? ("completed" as const)
        : ("deferred" as const);
    } catch {
      // Do not log the event: later audience payloads may contain private submissions.
      return "retry" as const;
    }
  }

  async runUntilIdle(maximum = 100) {
    const results: Array<"completed" | "deferred" | "retry"> = [];
    for (let index = 0; index < maximum; index += 1) {
      const result = await this.runOnce();
      if (result === "idle") break;
      results.push(result);
      if (result !== "completed") break;
    }
    return results;
  }
}

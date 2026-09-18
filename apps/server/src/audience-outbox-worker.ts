import type { Repository } from "@openround/db";
import type { InteractionService } from "./interaction-service.js";
import type { MetricsService } from "./metrics.js";

export class AudienceOutboxWorker {
  constructor(
    private readonly repository: Repository,
    private readonly interactions: InteractionService,
    private readonly metrics?: MetricsService,
    private readonly leaseMs = 30_000,
  ) {}

  async runOnce(now = new Date()) {
    const event = await this.repository.claimAudienceOutbox(
      now,
      new Date(now.getTime() - this.leaseMs),
    );
    if (!event) return "idle" as const;
    try {
      const delivered = await this.interactions.publishOutboxEvent(event);
      return delivered ? ("completed" as const) : ("deferred" as const);
    } catch {
      // The claim becomes eligible again after the short lease. Delivery is at least once.
      return "retry" as const;
    }
  }

  async runUntilIdle(maximum = 100) {
    const results: Array<"completed" | "deferred" | "retry"> = [];
    for (let index = 0; index < maximum; index += 1) {
      const result = await this.runOnce();
      if (result === "idle") break;
      results.push(result);
      if (result === "retry" || result === "deferred") break;
    }
    const now = Date.now();
    const status = await this.repository.getAudienceOutboxStatus();
    this.metrics?.setAudienceOutboxStatus(
      status.pending,
      status.oldestCreatedAt ? (now - status.oldestCreatedAt.getTime()) / 1_000 : 0,
      status.chatEnabledSessions,
    );
    return results;
  }
}

import type { Repository } from "@openround/db";
import type { StorageService } from "./storage.js";
import type { MetricsService } from "./metrics.js";

export interface RetentionResult {
  expiredLiveSessions: number;
  purgedSessions: number;
  purgedAuditEvents: number;
  purgedProductEvents: number;
  purgedMedia: number;
  failedMedia: number;
}

export class RetentionService {
  constructor(
    private readonly repository: Repository,
    private readonly storage: Pick<StorageService, "configured" | "deleteAsset">,
    private readonly quarantineRetentionHours: number,
    private readonly metrics?: MetricsService,
    private readonly onSessionsPurged?: (sessionIds: string[]) => Promise<void>,
    private readonly auditRetentionDays = 365,
  ) {}

  async run(now = new Date()): Promise<RetentionResult> {
    const expiredLiveSessionIds = await this.repository.expireLiveSessions(now);
    const purgedSessionIds = await this.repository.purgeExpired(now);
    const invalidatedSessionIds = [...new Set([...expiredLiveSessionIds, ...purgedSessionIds])];
    if (invalidatedSessionIds.length > 0) {
      await this.onSessionsPurged?.(invalidatedSessionIds);
    }
    const expiredLiveSessions = expiredLiveSessionIds.length;
    const purgedSessions = purgedSessionIds.length;
    const auditCutoff = new Date(now.getTime() - this.auditRetentionDays * 24 * 60 * 60 * 1_000);
    const purgedAuditEvents = await this.repository.purgeAuditEvents(auditCutoff);
    const purgedProductEvents = await this.repository.purgeProductEvents(now);
    const cutoff = new Date(now.getTime() - this.quarantineRetentionHours * 60 * 60 * 1_000);
    const staleMedia = await this.repository.listStaleMedia(cutoff, 100);
    if (!this.storage.configured) {
      const result = {
        expiredLiveSessions,
        purgedSessions,
        purgedAuditEvents,
        purgedProductEvents,
        purgedMedia: 0,
        failedMedia: staleMedia.length,
      };
      this.metrics?.recordRetention(result);
      return result;
    }

    let purgedMedia = 0;
    let failedMedia = 0;
    for (const asset of staleMedia) {
      try {
        await this.storage.deleteAsset(asset);
        if (await this.repository.deleteMediaAsset(asset.workspaceId, asset.id)) purgedMedia += 1;
      } catch {
        failedMedia += 1;
      }
    }
    const result = {
      expiredLiveSessions,
      purgedSessions,
      purgedAuditEvents,
      purgedProductEvents,
      purgedMedia,
      failedMedia,
    };
    this.metrics?.recordRetention(result);
    return result;
  }
}

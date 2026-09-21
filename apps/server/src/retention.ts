import type { Repository } from "@openround/db";
import type { StorageService } from "./storage.js";
import type { MetricsService } from "./metrics.js";

export interface RetentionResult {
  expiredLiveSessions: number;
  purgedSessions: number;
  purgedPracticeAssignments: number;
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
    private readonly unattachedMediaGraceDays = 7,
  ) {}

  async run(now = new Date()): Promise<RetentionResult> {
    const expiredLiveSessionIds = await this.repository.expireLiveSessions(now);
    const purgedSessionIds = await this.repository.purgeExpired(now);
    const purgedPracticeAssignments = await this.repository.purgeExpiredPracticeAssignments(now);
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
    const unattachedCutoff = new Date(
      now.getTime() - this.unattachedMediaGraceDays * 24 * 60 * 60 * 1_000,
    );
    const [staleQuarantineMedia, unattachedMedia] = await Promise.all([
      this.repository.listStaleMedia(cutoff, 100),
      this.repository.listUnattachedMedia(unattachedCutoff, 100),
    ]);
    const staleMedia = [
      ...new Map(
        [...staleQuarantineMedia, ...unattachedMedia].map((asset) => [asset.id, asset]),
      ).values(),
    ]
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .slice(0, 100);
    if (!this.storage.configured) {
      const result = {
        expiredLiveSessions,
        purgedSessions,
        purgedPracticeAssignments,
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
      // Delete the metadata first. Its reference-aware delete is the atomic claim:
      // once accepted, a concurrent draft cannot create a durable reference to the asset.
      if (!(await this.repository.deleteMediaAsset(asset.workspaceId, asset.id))) continue;
      try {
        await this.storage.deleteAsset(asset);
        purgedMedia += 1;
      } catch {
        // Keep the cleanup retryable without exposing a metadata record after the
        // object has been removed successfully.
        await this.repository.createMediaAsset(asset).catch(() => undefined);
        failedMedia += 1;
      }
    }
    const result = {
      expiredLiveSessions,
      purgedSessions,
      purgedPracticeAssignments,
      purgedAuditEvents,
      purgedProductEvents,
      purgedMedia,
      failedMedia,
    };
    this.metrics?.recordRetention(result);
    return result;
  }
}

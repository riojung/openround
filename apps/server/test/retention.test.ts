import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MEDIA_DELETION_TOMBSTONE_HOLD_MS,
  MemoryRepository,
  type MediaAssetCreateInput,
  type MediaAssetRecord,
} from "@openround/db";
import { createGameState } from "@openround/game-engine";
import { RetentionService } from "../src/retention.js";
import { generateReport } from "../src/reporting.js";

function media(
  workspaceId: string,
  scanStatus: MediaAssetRecord["scanStatus"],
  createdAt: Date,
): MediaAssetCreateInput {
  const id = randomUUID();
  return {
    id,
    workspaceId,
    objectKey: `${scanStatus === "clean" ? "media" : "quarantine"}/${workspaceId}/${id}.png`,
    mimeType: "image/png",
    sizeBytes: 128,
    scanStatus,
    altText: "A chart",
    createdAt,
    deletionStartedAt: null,
  };
}

describe("retention service", () => {
  it("removes expired quarantine metadata only after deleting its object", async () => {
    const repository = new MemoryRepository();
    const workspaceId = randomUUID();
    const now = new Date("2026-09-14T12:00:00.000Z");
    const stalePending = media(workspaceId, "pending", new Date(now.getTime() - 25 * 3_600_000));
    const staleRejected = media(workspaceId, "rejected", new Date(now.getTime() - 48 * 3_600_000));
    const recentPending = media(workspaceId, "pending", new Date(now.getTime() - 2 * 3_600_000));
    const clean = media(workspaceId, "clean", new Date(now.getTime() - 72 * 3_600_000));
    for (const asset of [stalePending, staleRejected, recentPending, clean]) {
      await repository.createMediaAsset(asset);
    }
    const deleted: string[] = [];
    const retention = new RetentionService(
      repository,
      {
        configured: true,
        deleteAsset: async (asset) => {
          deleted.push(asset.id);
        },
      },
      24,
    );

    await expect(retention.run(now)).resolves.toEqual({
      expiredLiveSessions: 0,
      purgedSessions: 0,
      purgedPracticeAssignments: 0,
      purgedAuditEvents: 0,
      purgedProductEvents: 0,
      purgedMedia: 0,
      failedMedia: 0,
    });
    expect(deleted).toEqual([staleRejected.id, stalePending.id]);
    expect(await repository.getMediaAsset(workspaceId, staleRejected.id)).toMatchObject({
      scanStatus: "deleting",
      deletionStartedAt: now,
    });

    await expect(
      retention.run(new Date(now.getTime() + MEDIA_DELETION_TOMBSTONE_HOLD_MS)),
    ).resolves.toEqual(expect.objectContaining({ purgedMedia: 2, failedMedia: 0 }));
    expect(deleted).toEqual([staleRejected.id, stalePending.id, staleRejected.id, stalePending.id]);
    expect((await repository.listMediaAssets(workspaceId)).map(({ id }) => id)).toEqual([
      clean.id,
      recentPending.id,
    ]);
  });

  it("removes clean unattached uploads after seven days but preserves referenced assets", async () => {
    const repository = new MemoryRepository();
    const workspaceId = randomUUID();
    const now = new Date("2026-09-20T12:00:00.000Z");
    const orphan = media(workspaceId, "clean", new Date(now.getTime() - 8 * 86_400_000));
    const referenced = media(workspaceId, "clean", new Date(now.getTime() - 30 * 86_400_000));
    await repository.createMediaAsset(orphan);
    await repository.createMediaAsset(referenced);
    await repository.replaceMediaReferences(
      workspaceId,
      "quiz_draft",
      randomUUID(),
      [referenced.id],
      now,
    );
    const deleted: string[] = [];
    const retention = new RetentionService(
      repository,
      {
        configured: true,
        deleteAsset: async (asset) => {
          deleted.push(asset.id);
        },
      },
      24,
    );

    expect(await retention.run(now)).toEqual(
      expect.objectContaining({ purgedMedia: 0, failedMedia: 0 }),
    );
    expect(deleted).toEqual([orphan.id]);
    expect(await repository.getMediaAsset(workspaceId, orphan.id)).toMatchObject({
      scanStatus: "deleting",
      deletionStartedAt: now,
    });
    expect(await retention.run(new Date(now.getTime() + MEDIA_DELETION_TOMBSTONE_HOLD_MS))).toEqual(
      expect.objectContaining({ purgedMedia: 1, failedMedia: 0 }),
    );
    expect(deleted).toEqual([orphan.id, orphan.id]);
    expect(await repository.getMediaAsset(workspaceId, orphan.id)).toBeNull();
    expect(await repository.getMediaAsset(workspaceId, referenced.id)).not.toBeNull();
  });

  it("retains metadata when object deletion fails or storage is unavailable", async () => {
    const repository = new MemoryRepository();
    const asset = media(randomUUID(), "pending", new Date("2026-09-01T00:00:00.000Z"));
    await repository.createMediaAsset(asset);
    const failing = new RetentionService(
      repository,
      {
        configured: true,
        deleteAsset: async () => {
          throw new Error("storage unavailable");
        },
      },
      24,
    );
    expect((await failing.run(new Date("2026-09-14T00:00:00.000Z"))).failedMedia).toBe(1);
    expect(await repository.getMediaAsset(asset.workspaceId, asset.id)).toMatchObject({
      scanStatus: "deleting",
    });

    const disabled = new RetentionService(
      repository,
      { configured: false, deleteAsset: async () => undefined },
      24,
    );
    expect((await disabled.run(new Date("2026-09-14T00:00:00.000Z"))).failedMedia).toBe(1);
    expect(await repository.getMediaAsset(asset.workspaceId, asset.id)).not.toBeNull();

    const retried: string[] = [];
    const succeeding = new RetentionService(
      repository,
      {
        configured: true,
        deleteAsset: async (candidate) => {
          retried.push(candidate.id);
        },
      },
      24,
    );
    expect((await succeeding.run(new Date("2026-09-14T00:00:00.000Z"))).purgedMedia).toBe(0);
    expect(retried).toEqual([asset.id]);
    expect(await repository.getMediaAsset(asset.workspaceId, asset.id)).not.toBeNull();
    expect(
      (
        await succeeding.run(
          new Date(
            new Date("2026-09-14T00:00:00.000Z").getTime() + MEDIA_DELETION_TOMBSTONE_HOLD_MS,
          ),
        )
      ).purgedMedia,
    ).toBe(1);
    expect(retried).toEqual([asset.id, asset.id]);
    expect(await repository.getMediaAsset(asset.workspaceId, asset.id)).toBeNull();
  });

  it("retries the durable workspace-prefix sweep after upload URLs expire", async () => {
    const repository = new MemoryRepository();
    const workspaceId = randomUUID();
    const deletionStartedAt = new Date("2026-09-27T12:00:00.000Z");
    await repository.createMediaAsset(media(workspaceId, "pending", deletionStartedAt));
    await repository.claimWorkspaceMediaDeletion(workspaceId, deletionStartedAt);
    const swept: string[] = [];
    const retention = new RetentionService(
      repository,
      {
        configured: true,
        deleteAsset: async () => undefined,
        deleteWorkspaceMediaObjects: async (candidateWorkspaceId) => {
          swept.push(candidateWorkspaceId);
          return 1;
        },
      },
      24,
    );

    await expect(
      retention.run(new Date(deletionStartedAt.getTime() + MEDIA_DELETION_TOMBSTONE_HOLD_MS - 1)),
    ).resolves.toEqual(expect.objectContaining({ purgedMedia: 0, failedMedia: 0 }));
    expect(swept).toEqual([]);

    await expect(
      retention.run(new Date(deletionStartedAt.getTime() + MEDIA_DELETION_TOMBSTONE_HOLD_MS)),
    ).resolves.toEqual(expect.objectContaining({ purgedMedia: 1, failedMedia: 0 }));
    expect(swept).toEqual([workspaceId]);
    await expect(
      repository.listDueWorkspaceMediaDeletionJobs(
        new Date(deletionStartedAt.getTime() + MEDIA_DELETION_TOMBSTONE_HOLD_MS),
      ),
    ).resolves.toEqual([]);
  });

  it("does not enqueue an impossible object sweep for a media-free workspace", async () => {
    const repository = new MemoryRepository();
    const deletionStartedAt = new Date("2026-09-27T12:00:00.000Z");
    await expect(
      repository.claimWorkspaceMediaDeletion(randomUUID(), deletionStartedAt),
    ).resolves.toEqual([]);
    const retention = new RetentionService(
      repository,
      { configured: false, deleteAsset: async () => undefined },
      24,
    );

    await expect(
      retention.run(new Date(deletionStartedAt.getTime() + MEDIA_DELETION_TOMBSTONE_HOLD_MS)),
    ).resolves.toEqual(expect.objectContaining({ purgedMedia: 0, failedMedia: 0 }));
  });

  it("sweeps a clean winner once immediately and once at the six-day boundary", async () => {
    const repository = new MemoryRepository();
    const now = new Date("2026-09-27T12:00:00.000Z");
    const workspaceId = randomUUID();
    const asset = media(workspaceId, "pending", now);
    await repository.createMediaAsset(asset);
    const finalizationToken = randomUUID();
    await repository.claimMediaAssetFinalization(workspaceId, asset.id, finalizationToken, now);
    const winnerKey = `media/${workspaceId}/${asset.id}/${finalizationToken}.png`;
    await repository.updateMediaAsset(workspaceId, asset.id, {
      scanStatus: "clean",
      objectKey: winnerKey,
      finalizationToken,
      finalizedAt: now,
    });
    await repository.replaceMediaReferences(
      workspaceId,
      "quiz_draft",
      randomUUID(),
      [asset.id],
      now,
    );
    const cleaned: string[] = [];
    const retention = new RetentionService(
      repository,
      {
        configured: true,
        deleteAsset: async () => undefined,
        cleanupFinalization: async (candidate) => {
          cleaned.push(candidate.objectKey);
        },
      },
      24,
    );

    expect(await retention.run(now)).toEqual(expect.objectContaining({ failedMedia: 0 }));
    expect(await retention.run(new Date(now.getTime() + 60 * 60_000))).toEqual(
      expect.objectContaining({ failedMedia: 0 }),
    );
    expect(cleaned).toEqual([winnerKey]);
    const finalSweepAt = new Date(now.getTime() + 6 * 24 * 60 * 60_000);
    await retention.run(new Date(finalSweepAt.getTime() - 1));
    expect(cleaned).toEqual([winnerKey]);
    await retention.run(finalSweepAt);
    await retention.run(new Date(finalSweepAt.getTime() + 60 * 60_000));
    expect(cleaned).toEqual([winnerKey, winnerKey]);
    expect(await repository.getMediaAsset(workspaceId, asset.id)).toMatchObject({
      scanStatus: "clean",
      objectKey: winnerKey,
    });
  });

  it("bounds each cleanup batch and eventually sweeps every winner", async () => {
    const repository = new MemoryRepository();
    const now = new Date("2026-09-27T12:00:00.000Z");
    const workspaceId = randomUUID();
    const expectedKeys: string[] = [];
    for (let index = 0; index < 101; index += 1) {
      const asset = media(workspaceId, "pending", now);
      const token = randomUUID();
      await repository.createMediaAsset(asset);
      await repository.claimMediaAssetFinalization(workspaceId, asset.id, token, now);
      const winnerKey = `media/${workspaceId}/${asset.id}/${token}.png`;
      await repository.updateMediaAsset(workspaceId, asset.id, {
        scanStatus: "clean",
        objectKey: winnerKey,
        finalizationToken: token,
        finalizedAt: now,
      });
      expectedKeys.push(winnerKey);
    }
    const cleaned: string[] = [];
    const retention = new RetentionService(
      repository,
      {
        configured: true,
        deleteAsset: async () => undefined,
        cleanupFinalization: async (candidate) => {
          cleaned.push(candidate.objectKey);
        },
      },
      24,
    );

    await retention.run(now);
    expect(cleaned).toHaveLength(100);
    await retention.run(now);
    expect(cleaned.sort()).toEqual(expectedKeys.sort());
  });

  it("retries failed winner cleanup without advancing to the final sweep", async () => {
    const repository = new MemoryRepository();
    const now = new Date("2026-09-27T12:00:00.000Z");
    const workspaceId = randomUUID();
    const asset = media(workspaceId, "pending", now);
    await repository.createMediaAsset(asset);
    const finalizationToken = randomUUID();
    await repository.claimMediaAssetFinalization(workspaceId, asset.id, finalizationToken, now);
    await repository.updateMediaAsset(workspaceId, asset.id, {
      scanStatus: "clean",
      objectKey: `media/${workspaceId}/${asset.id}/${finalizationToken}.png`,
      finalizationToken,
      finalizedAt: now,
    });
    await repository.replaceMediaReferences(
      workspaceId,
      "quiz_draft",
      randomUUID(),
      [asset.id],
      now,
    );
    let attempts = 0;
    const retention = new RetentionService(
      repository,
      {
        configured: true,
        deleteAsset: async () => undefined,
        cleanupFinalization: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error("temporary object-store failure");
        },
      },
      24,
    );

    expect(await retention.run(now)).toEqual(expect.objectContaining({ failedMedia: 1 }));
    await retention.run(now);
    expect(attempts).toBe(1);
    expect(await retention.run(new Date(now.getTime() + 60 * 60_000))).toEqual(
      expect.objectContaining({ failedMedia: 0 }),
    );
    expect(attempts).toBe(2);
    await retention.run(new Date(now.getTime() + 2 * 60 * 60_000));
    expect(attempts).toBe(2);
  });

  it("expires live access before purging the retained report tree", async () => {
    const repository = new MemoryRepository();
    const workspaceId = randomUUID();
    const sessionId = randomUUID();
    const now = new Date();
    const retentionExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
    const state = createGameState({
      sessionId,
      code: "1234567",
      quiz: { title: "Retention", description: "", questions: [] },
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "friendly_only",
      },
    });
    await repository.createSession({
      id: sessionId,
      workspaceId,
      quizVersionId: randomUUID(),
      hostId: randomUUID(),
      hostTokenHash: randomUUID(),
      state,
      expiresAt: new Date(now.getTime() - 1),
      retentionExpiresAt,
      createdAt: new Date(now.getTime() - 24 * 60 * 60_000),
      updatedAt: now,
    });
    const report = generateReport(state, retentionExpiresAt);
    await repository.saveReport(workspaceId, report);
    const invalidated: string[][] = [];
    const retention = new RetentionService(
      repository,
      { configured: true, deleteAsset: async () => undefined },
      24,
      undefined,
      async (ids) => {
        invalidated.push(ids);
      },
    );

    await expect(retention.run(now)).resolves.toEqual({
      expiredLiveSessions: 1,
      purgedSessions: 0,
      purgedPracticeAssignments: 0,
      purgedAuditEvents: 0,
      purgedProductEvents: 0,
      purgedMedia: 0,
      failedMedia: 0,
    });
    expect(await repository.getSessionById(sessionId)).not.toBeNull();
    expect(await repository.getSessionByCode("1234567")).toBeNull();
    expect(await repository.getReport(workspaceId, report.id)).not.toBeNull();

    await expect(retention.run(new Date(retentionExpiresAt.getTime() + 1))).resolves.toEqual({
      expiredLiveSessions: 0,
      purgedSessions: 1,
      purgedPracticeAssignments: 0,
      purgedAuditEvents: 0,
      purgedProductEvents: 0,
      purgedMedia: 0,
      failedMedia: 0,
    });
    expect(await repository.getSessionById(sessionId)).toBeNull();
    expect(repository.reports.size).toBe(0);
    expect(invalidated).toEqual([[sessionId], [sessionId]]);
  });

  it("purges audit events at the configured retention boundary", async () => {
    const repository = new MemoryRepository();
    const workspaceId = randomUUID();
    const now = new Date("2026-09-14T12:00:00.000Z");
    await repository.recordAudit({
      workspaceId,
      actorId: randomUUID(),
      action: "checkpoint.updated",
      targetType: "quiz",
      targetId: randomUUID(),
      requestId: randomUUID(),
    });
    repository.audits[0]!.createdAt = new Date(now.getTime() - 366 * 24 * 60 * 60_000);
    await repository.recordAudit({
      workspaceId,
      actorId: randomUUID(),
      action: "checkpoint.published",
      targetType: "quiz",
      targetId: randomUUID(),
      requestId: randomUUID(),
    });
    repository.audits[1]!.createdAt = now;
    const retention = new RetentionService(
      repository,
      { configured: true, deleteAsset: async () => undefined },
      24,
      undefined,
      undefined,
      365,
    );

    const result = await retention.run(now);

    expect(result.purgedAuditEvents).toBe(1);
    expect(repository.audits).toHaveLength(1);
    expect(repository.audits[0]!.action).toBe("checkpoint.published");
  });

  it("reports standalone practice purged outside the session tree", async () => {
    const repository = new MemoryRepository();
    const now = new Date("2026-09-19T12:00:00.000Z");
    let purgeBoundary: Date | undefined;
    repository.purgeExpiredPracticeAssignments = async (boundary) => {
      purgeBoundary = boundary;
      return 2;
    };
    const retention = new RetentionService(
      repository,
      { configured: true, deleteAsset: async () => undefined },
      24,
    );

    const result = await retention.run(now);

    expect(purgeBoundary).toEqual(now);
    expect(result.purgedPracticeAssignments).toBe(2);
    expect(result.purgedSessions).toBe(0);
  });

  it("purges privacy-safe product events at their 30-day expiry", async () => {
    const repository = new MemoryRepository();
    const now = new Date("2026-09-18T12:00:00.000Z");
    const expiredWorkspaceId = randomUUID();
    const retainedWorkspaceId = randomUUID();
    await repository.recordProductEvents([
      {
        id: randomUUID(),
        workspaceId: expiredWorkspaceId,
        name: "rehearsal_completed",
        occurredAt: new Date(now.getTime() - 30 * 24 * 60 * 60_000).toISOString(),
        dimensions: {
          scenario: "split_room",
          segment: "education",
          betaVersion: "p0-2026",
          durationBucket: "1_to_5m",
        },
        expiresAt: now,
        createdAt: new Date(now.getTime() - 30 * 24 * 60 * 60_000),
      },
    ]);
    await repository.recordProductEvents([
      {
        id: randomUUID(),
        workspaceId: retainedWorkspaceId,
        name: "host_setup_completed",
        occurredAt: now.toISOString(),
        dimensions: { betaVersion: "p0-2026" },
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
        createdAt: now,
      },
    ]);
    const retention = new RetentionService(
      repository,
      { configured: true, deleteAsset: async () => undefined },
      24,
    );

    const result = await retention.run(now);

    expect(result.purgedProductEvents).toBe(1);
    expect(repository.productEvents).toEqual([
      expect.objectContaining({ workspaceId: retainedWorkspaceId, name: "host_setup_completed" }),
    ]);
  });
});

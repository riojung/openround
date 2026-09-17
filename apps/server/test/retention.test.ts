import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryRepository, type MediaAssetRecord } from "@openround/db";
import { createGameState } from "@openround/game-engine";
import { RetentionService } from "../src/retention.js";
import { generateReport } from "../src/reporting.js";

function media(
  workspaceId: string,
  scanStatus: MediaAssetRecord["scanStatus"],
  createdAt: Date,
): MediaAssetRecord {
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
      purgedAuditEvents: 0,
      purgedMedia: 2,
      failedMedia: 0,
    });
    expect(deleted).toEqual([staleRejected.id, stalePending.id]);
    expect((await repository.listMediaAssets(workspaceId)).map(({ id }) => id)).toEqual([
      clean.id,
      recentPending.id,
    ]);
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
    expect(await repository.getMediaAsset(asset.workspaceId, asset.id)).not.toBeNull();

    const disabled = new RetentionService(
      repository,
      { configured: false, deleteAsset: async () => undefined },
      24,
    );
    expect((await disabled.run(new Date("2026-09-14T00:00:00.000Z"))).failedMedia).toBe(1);
    expect(await repository.getMediaAsset(asset.workspaceId, asset.id)).not.toBeNull();
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
      purgedAuditEvents: 0,
      purgedMedia: 0,
      failedMedia: 0,
    });
    expect(await repository.getSessionById(sessionId)).not.toBeNull();
    expect(await repository.getSessionByCode("1234567")).toBeNull();
    expect(await repository.getReport(workspaceId, report.id)).not.toBeNull();

    await expect(retention.run(new Date(retentionExpiresAt.getTime() + 1))).resolves.toEqual({
      expiredLiveSessions: 0,
      purgedSessions: 1,
      purgedAuditEvents: 0,
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
});

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryRepository } from "@openround/db";
import { createGameState } from "@openround/game-engine";
import { ReportWorker } from "../src/report-worker.js";
import { createPendingReport } from "../src/reporting.js";

describe("report worker", () => {
  it("claims a pending job and replaces it with a versioned durable report", async () => {
    const repository = new MemoryRepository();
    const workspaceId = randomUUID();
    const sessionId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
    const state = createGameState({
      sessionId,
      code: "1234567",
      quiz: { title: "Worker", description: "", questions: [] },
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    });
    await repository.createSession({
      id: sessionId,
      workspaceId,
      quizVersionId: randomUUID(),
      hostId: randomUUID(),
      hostTokenHash: randomUUID(),
      state: { ...state, phase: "finished" },
      expiresAt,
      retentionExpiresAt: expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    const pending = createPendingReport(state, expiresAt);
    await repository.saveReport(workspaceId, pending);

    const worker = new ReportWorker(repository, 60_000);
    await expect(worker.runOnce(now)).resolves.toBe("completed");
    await expect(worker.runOnce(now)).resolves.toBe("idle");
    await expect(repository.getReport(workspaceId, pending.id)).resolves.toMatchObject({
      id: pending.id,
      sessionId,
      schemaVersion: 3,
      status: "ready",
      generatedAt: now.toISOString(),
    });
  });
});

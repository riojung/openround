import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PresentationReportV1Schema, type PresentationContent } from "@openround/contracts";
import { MemoryRepository, createPresentationSessionRepository } from "@openround/db";
import { MetricsService } from "../src/metrics.js";
import { PresentationReportWorker } from "../src/presentation-report-worker.js";
import { generatePresentationReport } from "../src/presentation-reporting.js";
import { ProductEventDispatcher } from "../src/product-events.js";

describe("Presentation report worker", () => {
  it("reconciles a finished session into one durable versioned report", async () => {
    const workspaceId = randomUUID();
    const sessionId = randomUUID();
    const participantId = randomUUID();
    const blockId = randomUUID();
    const questionId = randomUUID();
    const correctChoiceId = randomUUID();
    const now = new Date("2026-09-24T12:00:00.000Z");
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
    const content: PresentationContent = {
      title: "Durable evidence",
      description: "",
      experiencePreset: { id: "focus", version: 1 },
      schemaVersion: 1,
      blocks: [
        {
          id: blockId,
          kind: "question",
          question: {
            id: questionId,
            type: "single_select",
            prompt: "Which answer was durably acknowledged?",
            choices: [
              { id: correctChoiceId, label: "The stored answer", isCorrect: true },
              { id: randomUUID(), label: "A client-only answer", isCorrect: false },
            ],
            purpose: "diagnostic",
            confidence: "off",
            delivery: "main",
            conceptKeys: [],
            linkedRecheckQuestionId: null,
            timeLimitSeconds: 20,
            basePoints: 1_000,
            explanation: "Only acknowledged responses enter the report.",
            mediaId: null,
            mediaAlt: null,
          },
        },
      ],
    };
    const repository = new MemoryRepository({ initialWorkspaceId: workspaceId });
    const sessions = createPresentationSessionRepository(repository);
    await sessions.createSession({
      id: sessionId,
      workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: content.title,
      content,
      code: "8123456",
      status: "active",
      phase: "question_open",
      currentBlockIndex: 0,
      revision: 0,
      createdBy: randomUUID(),
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      liveExpiresAt: new Date(now.getTime() + 86_400_000),
      retentionExpiresAt: expiresAt,
    });
    await sessions.addParticipant({
      id: participantId,
      workspaceId,
      sessionId,
      nickname: "River",
      tokenHash: "a".repeat(64),
      joinedAt: now,
      lastSeenAt: now,
    });
    await expect(
      sessions.acceptResponse(
        {
          id: randomUUID(),
          workspaceId,
          sessionId,
          participantId,
          blockId,
          questionId,
          response: { choiceIds: [correctChoiceId] },
          correct: true,
          score: 975,
          responseMs: 1_000,
          submittedAt: new Date(now.getTime() + 1_000),
          idempotencyKey: randomUUID(),
          requestHash: "b".repeat(64),
        },
        0,
      ),
    ).resolves.toMatchObject({ status: "accepted" });
    await sessions.transitionSession({
      workspaceId,
      sessionId,
      expectedRevision: 0,
      phase: "finished",
      currentBlockIndex: 0,
      status: "finished",
      occurredAt: new Date(now.getTime() + 2_000),
      retentionExpiresAt: expiresAt,
      event: {
        type: "presentation.finished",
        blockIndex: null,
        blockId: null,
      },
    });
    await expect(sessions.getReport(workspaceId, sessionId)).resolves.toMatchObject({
      id: sessionId,
      status: "pending",
      payload: null,
      expiresAt,
    });

    const metrics = new MetricsService();
    const productEvents = new ProductEventDispatcher(repository, metrics);
    const worker = new PresentationReportWorker(sessions, 60_000, metrics, {
      dispatcher: productEvents,
      workspaceEnabled: () => true,
    });
    const generatedAt = new Date(now.getTime() + 3_000);
    await expect(worker.runOnce(generatedAt)).resolves.toBe("completed");
    await productEvents.drain();
    await expect(worker.runOnce(generatedAt)).resolves.toBe("idle");

    const stored = await sessions.getReport(workspaceId, sessionId);
    expect(stored).toMatchObject({
      id: sessionId,
      status: "ready",
      schemaVersion: 1,
      generatedAt,
    });
    expect(PresentationReportV1Schema.parse(stored?.payload)).toMatchObject({
      sessionId,
      participantCount: 1,
      responseCount: 1,
      leaderboard: [{ id: participantId, nickname: "River", score: 975, rank: 1 }],
      evidence: [{ blockId, respondents: 1, correct: 1, accuracyPercent: 100 }],
    });
    expect(repository.productEvents).toEqual([
      expect.objectContaining({
        workspaceId,
        name: "report_reconciled",
        occurredAt: generatedAt.toISOString(),
        dimensions: {
          artifactType: "presentation",
          betaVersion: "p0-2026",
          segment: "workplace",
        },
      }),
    ]);

    const [finishedSession, participants, responses, timeline] = await Promise.all([
      sessions.getSessionById(sessionId),
      sessions.listParticipants(sessionId),
      sessions.listResponses(sessionId),
      sessions.listTimeline(sessionId),
    ]);
    expect(
      generatePresentationReport({
        session: { ...finishedSession!, finishedAt: null },
        participants,
        responses,
        timeline,
      }).finishedAt,
    ).toBe(finishedSession!.updatedAt.toISOString());
  });
});

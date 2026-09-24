import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PresentationReportEnvelopeSchema, PresentationReportV1Schema } from "../src/index";

function reportFixture() {
  const sessionId = randomUUID();
  return {
    schemaVersion: 1 as const,
    sessionId,
    artifactType: "presentation" as const,
    presentationId: randomUUID(),
    presentationVersionId: randomUUID(),
    title: "Recovery review",
    status: "finished" as const,
    trustMode: "learning" as const,
    participantCount: 2,
    responseCount: 2,
    leaderboard: [
      { id: randomUUID(), nickname: "River", score: 1_000, rank: 1 },
      { id: randomUUID(), nickname: "Sage", score: 0, rank: 2 },
    ],
    evidence: [
      {
        blockId: randomUUID(),
        blockIndex: 0,
        kind: "content" as const,
        title: "Evidence first",
        assessmentStatus: "not_assessed" as const,
      },
      {
        blockId: randomUUID(),
        blockIndex: 1,
        kind: "question" as const,
        questionId: randomUUID(),
        prompt: "Which signal should guide the next action?",
        questionType: "single_select" as const,
        questionTypeLabel: "Single choice",
        delivery: "main" as const,
        respondents: 2,
        correct: 1,
        accuracyPercent: 50,
        totalScore: 1_000,
        averageResponseMs: 2_500,
      },
    ],
    recovery: [],
    timeline: [
      {
        sequence: 1,
        type: "content.presented" as const,
        blockIndex: 0,
        blockId: randomUUID(),
        occurredAt: "2026-09-24T10:00:00.000Z",
      },
      {
        sequence: 2,
        type: "presentation.finished" as const,
        blockIndex: null,
        blockId: null,
        occurredAt: "2026-09-24T10:05:00.000Z",
      },
    ],
    evidenceNote:
      "Content slides are recorded in the facilitation timeline but are not evidence of learning.",
    createdAt: "2026-09-24T09:55:00.000Z",
    finishedAt: "2026-09-24T10:05:00.000Z",
  };
}

describe("Presentation report contracts", () => {
  it("accepts a strict, versioned aggregate report", () => {
    expect(PresentationReportV1Schema.parse(reportFixture())).toMatchObject({
      schemaVersion: 1,
      artifactType: "presentation",
      status: "finished",
      trustMode: "learning",
    });
  });

  it("keeps queue state separate from the finished session status", () => {
    expect(
      PresentationReportEnvelopeSchema.parse({
        reportStatus: "pending",
        report: null,
      }),
    ).toEqual({ reportStatus: "pending", report: null });
    expect(
      PresentationReportEnvelopeSchema.parse({
        reportStatus: "pending",
        report: reportFixture(),
      }),
    ).toMatchObject({ reportStatus: "pending", report: { schemaVersion: 1 } });
    expect(
      PresentationReportEnvelopeSchema.safeParse({
        reportStatus: "ready",
        report: null,
      }).success,
    ).toBe(false);
    expect(
      PresentationReportEnvelopeSchema.safeParse({
        reportStatus: "failed",
        report: reportFixture(),
      }).success,
    ).toBe(false);
  });
});

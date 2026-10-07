import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CreatePracticeAssignmentSchema,
  CreateRecoveryPackPracticeAssignmentSchema,
  FollowupContextSchema,
  FollowupSchema,
  FollowupSummarySchema,
  RecoveryPackPracticeSourceSchema,
} from "../src/index.js";

const source = {
  artifactType: "recovery_pack" as const,
  packId: randomUUID(),
  packVersionId: randomUUID(),
  packVersion: 1,
  contentHash: "a".repeat(64),
  packTitle: "Fractions",
  publishedAt: "2026-10-07T10:00:00.000Z",
  sourceItemId: randomUUID(),
  role: "delayed_probe" as const,
};
const assignment = {
  id: randomUUID(),
  purpose: "assignment" as const,
  sourceQuizVersionId: null,
  sourceSessionId: null,
  sourceReportId: null,
  recoveryPackSource: source,
  title: "Practice fractions",
  conceptKeys: [],
  checkpointCount: 1,
  timeMode: "flex" as const,
  opensAt: "2026-10-08T10:00:00.000Z",
  closesAt: "2026-10-09T10:00:00.000Z",
  expiresAt: "2026-10-10T10:00:00.000Z",
  closedAt: null,
  createdAt: "2026-10-07T10:00:00.000Z",
};

describe("Recovery Pack delayed-probe practice contracts", () => {
  it("validates replayable creation input without changing the legacy Round input", () => {
    const input = {
      sourcePackVersionId: source.packVersionId,
      mutationId: randomUUID(),
      accessSeed: "a".repeat(43),
      closesAt: assignment.closesAt,
    };
    expect(CreateRecoveryPackPracticeAssignmentSchema.parse(input)).toMatchObject({
      timeMode: "flex",
      personalLabels: [],
    });
    for (const accessSeed of ["a".repeat(42), "a".repeat(44), "+".repeat(43), " ".repeat(43)]) {
      expect(
        CreateRecoveryPackPracticeAssignmentSchema.safeParse({ ...input, accessSeed }).success,
      ).toBe(false);
    }
    expect(
      CreateRecoveryPackPracticeAssignmentSchema.safeParse({
        ...input,
        personalLabels: ["Ada", " ada "],
      }).success,
    ).toBe(false);
    expect(
      CreateRecoveryPackPracticeAssignmentSchema.safeParse({ ...input, opensAt: input.closesAt })
        .success,
    ).toBe(false);
    expect(
      CreateRecoveryPackPracticeAssignmentSchema.safeParse({ ...input, quizId: randomUUID() })
        .success,
    ).toBe(false);
    expect(
      CreatePracticeAssignmentSchema.parse({
        sourceQuizVersionId: randomUUID(),
        closesAt: assignment.closesAt,
      }),
    ).toMatchObject({ timeMode: "flex", personalLabels: [] });
  });

  it("keeps frozen source metadata strict and free of authored bodies and credentials", () => {
    expect(RecoveryPackPracticeSourceSchema.parse(source)).toEqual(source);
    for (const change of [
      { role: "recheck" },
      { packVersion: 0 },
      { packVersion: Number.MAX_SAFE_INTEGER + 1 },
      { contentHash: 123 },
      { contentHash: "A".repeat(64) },
      { packTitle: "" },
      { publishedAt: "yesterday" },
      { accessSeed: "a".repeat(43) },
      { body: "PRIVATE card" },
      { sourceItemId: randomUUID().replaceAll("-", "") },
    ])
      expect(RecoveryPackPracticeSourceSchema.safeParse({ ...source, ...change }).success).toBe(
        false,
      );
  });

  it("allows null Round source only for Pack assignments and preserves legacy defaults", () => {
    expect(FollowupSchema.parse(assignment)).toMatchObject({
      sourceQuizVersionId: null,
      recoveryPackSource: source,
    });
    const legacy = { ...assignment, recoveryPackSource: undefined };
    expect(
      FollowupSchema.parse({ ...legacy, sourceQuizVersionId: randomUUID() }).recoveryPackSource,
    ).toBeNull();
    expect(FollowupSchema.safeParse(legacy).success).toBe(false);
    expect(
      FollowupSchema.safeParse({ ...assignment, sourceQuizVersionId: randomUUID() }).success,
    ).toBe(false);
    const recovery = {
      ...legacy,
      purpose: "recovery",
      sourceQuizVersionId: randomUUID(),
      sourceSessionId: randomUUID(),
      sourceReportId: randomUUID(),
      conceptKeys: ["fractions"],
    };
    expect(FollowupSchema.parse(recovery).recoveryPackSource).toBeNull();
    expect(FollowupSchema.safeParse({ ...recovery, recoveryPackSource: source }).success).toBe(
      false,
    );
  });

  it("keeps Pack summaries source-independent and discriminates frozen creator context", () => {
    const summary = {
      ...assignment,
      quizId: null,
      status: "open",
      attemptCount: 0,
      completedAttemptCount: 0,
    };
    expect(FollowupSummarySchema.parse(summary).quizId).toBeNull();
    expect(FollowupSummarySchema.safeParse({ ...summary, quizId: randomUUID() }).success).toBe(
      false,
    );
    expect(FollowupSummarySchema.safeParse({ ...summary, recoveryPackSource: null }).success).toBe(
      false,
    );
    expect(
      FollowupContextSchema.parse({
        quizId: randomUUID(),
        quizTitle: "Legacy",
        version: 1,
        publishedAt: source.publishedAt,
      }).sourceType,
    ).toBe("round");
    expect(
      FollowupContextSchema.parse({
        sourceType: "recovery_pack",
        packId: source.packId,
        packTitle: source.packTitle,
        version: source.packVersion,
        publishedAt: source.publishedAt,
      }).sourceType,
    ).toBe("recovery_pack");
    expect(
      FollowupContextSchema.safeParse({
        sourceType: "recovery_pack",
        quizId: randomUUID(),
        quizTitle: "Wrong source",
        version: 1,
        publishedAt: source.publishedAt,
      }).success,
    ).toBe(false);
  });
});

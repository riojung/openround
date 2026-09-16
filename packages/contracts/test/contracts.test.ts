import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BrandThemeSchema,
  EntitlementsSchema,
  HostCommandSchema,
  OperationalFeaturesUpdateSchema,
  QuestionSchema,
  SessionSnapshotSchema,
  SyncRequestSchema,
} from "../src/index.js";

describe("public contracts", () => {
  it("represents finite Free limits and unlimited paid quiz publishing", () => {
    expect(
      EntitlementsSchema.parse({
        plan: "free",
        maxParticipants: 20,
        maxPublishedQuizzes: 5,
        reportRetentionDays: 30,
        csvExport: false,
        brandTheme: false,
      }),
    ).toMatchObject({ maxPublishedQuizzes: 5, csvExport: false });
    expect(
      EntitlementsSchema.parse({
        plan: "pro",
        maxParticipants: 100,
        maxPublishedQuizzes: null,
        reportRetentionDays: 365,
        csvExport: true,
        brandTheme: true,
      }).maxPublishedQuizzes,
    ).toBeNull();
  });

  it("requires brand colours to remain readable with white live-view text", () => {
    expect(
      BrandThemeSchema.parse({
        organizationName: "Northern Learning",
        primaryColor: "#0b2239",
        accentColor: "#087375",
      }),
    ).toEqual({
      organizationName: "Northern Learning",
      primaryColor: "#0B2239",
      accentColor: "#087375",
    });
    expect(
      BrandThemeSchema.safeParse({
        organizationName: "Unreadable",
        primaryColor: "#FFFFFF",
        accentColor: "#FFFF00",
      }).success,
    ).toBe(false);
  });

  it("rejects questions with more than one correct choice", () => {
    const result = QuestionSchema.safeParse({
      id: randomUUID(),
      type: "single_select",
      prompt: "Which answers are marked correct?",
      choices: [
        { id: randomUUID(), label: "A", isCorrect: true },
        { id: randomUUID(), label: "B", isCorrect: true },
      ],
      timeLimitSeconds: 20,
      basePoints: 1_000,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
    });

    expect(result.success).toBe(false);
  });

  it("keeps the public snapshot free of answer keys while a question is open", () => {
    const snapshot = SessionSnapshotSchema.parse({
      sessionId: randomUUID(),
      code: "1234567",
      version: 2,
      seq: 2,
      phase: "question_open",
      roundId: randomUUID(),
      questionIndex: 0,
      questionCount: 1,
      question: {
        id: randomUUID(),
        prompt: "A question",
        choices: [{ id: randomUUID(), label: "An answer" }],
        timeLimitSeconds: 20,
        basePoints: 1_000,
        mediaId: null,
        mediaAlt: null,
      },
      deadline: new Date().toISOString(),
      participants: [],
      answerCount: 0,
      lobbyLocked: false,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
      brandTheme: null,
      pausedRemainingMs: null,
    });

    expect(JSON.stringify(snapshot)).not.toContain("isCorrect");
    expect(JSON.stringify(snapshot)).not.toContain("correctChoiceId");
  });

  it("requires an explicit participant for kick commands", () => {
    const result = HostCommandSchema.safeParse({
      sessionId: randomUUID(),
      hostToken: "a-secure-host-token-with-enough-length",
      commandId: randomUUID(),
      expectedVersion: 3,
      action: "kick",
    });

    expect(result.success).toBe(false);
  });

  it("requires role-appropriate synchronization credentials", () => {
    expect(
      SyncRequestSchema.safeParse({
        sessionId: randomUUID(),
        role: "participant",
        hostToken: "a-secure-host-token-with-enough-length",
        lastSeq: 0,
      }).success,
    ).toBe(false);
    expect(
      SyncRequestSchema.safeParse({
        sessionId: randomUUID(),
        role: "presenter",
        participantToken: "a-secure-participant-token-long-enough",
        lastSeq: 0,
      }).success,
    ).toBe(false);
  });

  it("requires a nonempty operational feature update", () => {
    expect(OperationalFeaturesUpdateSchema.safeParse({}).success).toBe(false);
    expect(OperationalFeaturesUpdateSchema.parse({ sessionCreation: false })).toStrictEqual({
      sessionCreation: false,
    });
  });
});

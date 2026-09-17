import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AnswerSubmitSchema,
  BrandThemeSchema,
  canonicalizeResponse,
  EntitlementsSchema,
  HostCommandSchema,
  normalizeDecimalString,
  OperationalFeaturesUpdateSchema,
  QuizContentSchema,
  QuizDraftSchema,
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
        followups: false,
        authoringJobsPerMonth: 3,
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
        followups: true,
        authoringJobsPerMonth: 100,
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

  it("saves incomplete drafts but requires complete publishable content", () => {
    const draft = {
      title: "Draft in progress",
      description: "",
      questions: [
        {
          id: randomUUID(),
          type: "single_select" as const,
          prompt: "",
          choices: [
            { id: randomUUID(), label: "", isCorrect: true },
            { id: randomUUID(), label: "", isCorrect: false },
          ],
          timeLimitSeconds: 20,
          basePoints: 1_000,
          explanation: "",
          mediaId: null,
          mediaAlt: null,
        },
      ],
    };

    expect(QuizDraftSchema.safeParse(draft).success).toBe(true);
    const publishable = QuizContentSchema.safeParse(draft);
    expect(publishable.success).toBe(false);
    if (!publishable.success) {
      expect(publishable.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["questions", 0, "prompt"],
            message: "Enter the checkpoint prompt",
          }),
          expect.objectContaining({
            path: ["questions", 0, "choices", 0, "label"],
            message: "Enter an answer",
          }),
        ]),
      );
    }
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

  it("accepts legacy and canonical answer requests, but never both at once", () => {
    const base = {
      sessionId: randomUUID(),
      roundId: randomUUID(),
      participantToken: "a-secure-participant-token-long-enough",
      idempotencyKey: randomUUID(),
    };
    const choiceId = randomUUID();

    expect(AnswerSubmitSchema.safeParse({ ...base, choiceId }).success).toBe(true);
    expect(
      AnswerSubmitSchema.safeParse({
        ...base,
        response: { kind: "choice", choiceIds: [choiceId] },
        confidence: 3,
      }).success,
    ).toBe(true);
    expect(
      AnswerSubmitSchema.safeParse({
        ...base,
        choiceId,
        response: { kind: "choice", choiceIds: [choiceId] },
      }).success,
    ).toBe(false);
    expect(AnswerSubmitSchema.safeParse(base).success).toBe(false);
  });

  it("canonicalizes decimals and choice sets without floating-point coercion", () => {
    expect(normalizeDecimalString("+00042.5000")).toBe("42.5");
    expect(normalizeDecimalString("-.5000")).toBe("-0.5");
    expect(() => normalizeDecimalString("1e3")).toThrow(/without exponent notation/);

    const first = randomUUID();
    const second = randomUUID();
    expect(canonicalizeResponse({ kind: "choice", choiceIds: [second, first] })).toStrictEqual({
      kind: "choice",
      choiceIds: [first, second].sort(),
    });
  });

  it("enforces unscored opinion rules for rating and poll checkpoints", () => {
    const common = {
      id: randomUUID(),
      prompt: "How useful was this checkpoint?",
      purpose: "opinion" as const,
      confidence: "off" as const,
      delivery: "main" as const,
      conceptKeys: [],
      linkedRecheckQuestionId: null,
      timeLimitSeconds: 20,
      basePoints: 0,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
    };
    expect(
      QuestionSchema.safeParse({
        ...common,
        type: "rating",
        min: 1,
        max: 5,
        minLabel: "Not useful",
        maxLabel: "Very useful",
      }).success,
    ).toBe(true);
    expect(
      QuestionSchema.safeParse({
        ...common,
        type: "poll",
        basePoints: 1_000,
        choices: [
          { id: randomUUID(), label: "Yes", isCorrect: false },
          { id: randomUUID(), label: "No", isCorrect: false },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires linked checkpoints to exist and be marked as rechecks", () => {
    const linkedId = randomUUID();
    const common = {
      prompt: "Choose one",
      type: "single_select" as const,
      purpose: "diagnostic" as const,
      confidence: "off" as const,
      conceptKeys: [],
      timeLimitSeconds: 20,
      basePoints: 1_000,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
      choices: [
        { id: randomUUID(), label: "A", isCorrect: true },
        { id: randomUUID(), label: "B", isCorrect: false },
      ],
    };
    const content = {
      title: "Recovery set",
      description: "",
      questions: [
        {
          ...common,
          id: randomUUID(),
          delivery: "main" as const,
          linkedRecheckQuestionId: linkedId,
        },
        {
          ...common,
          id: linkedId,
          delivery: "recheck" as const,
          linkedRecheckQuestionId: null,
        },
      ],
    };
    expect(QuizContentSchema.safeParse(content).success).toBe(true);
    expect(
      QuizContentSchema.safeParse({ ...content, questions: [content.questions[0]] }).success,
    ).toBe(false);
  });
});

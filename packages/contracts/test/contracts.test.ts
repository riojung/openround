import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AnswerSubmitSchema,
  AVATAR_IDS,
  AvatarIdSchema,
  BrandThemeSchema,
  canonicalizeResponse,
  CreatePracticeAssignmentSchema,
  EntitlementsSchema,
  FollowupSchema,
  FollowupSummarySchema,
  HostCommandSchema,
  JoinRequestSchema,
  normalizeDecimalString,
  OperationalFeaturesUpdateSchema,
  ProductEventBatchSchema,
  ProductEventNameSchema,
  PublicFeaturesSchema,
  QuizContentSchema,
  QuizDraftSchema,
  QuestionSchema,
  ResponseDistributionSchema,
  RoundFilterOptionsResponseSchema,
  SessionSnapshotSchema,
  SyncRequestSchema,
} from "../src/index.js";

describe("public contracts", () => {
  it("keeps avatar selection allowlisted and backward compatible", () => {
    expect(AVATAR_IDS).toEqual([
      "comet",
      "fox",
      "owl",
      "otter",
      "panda",
      "robot",
      "rocket",
      "star",
    ]);
    expect(AvatarIdSchema.parse("otter")).toBe("otter");
    expect(
      JoinRequestSchema.parse({ code: "1234567", nickname: "Legacy learner" }),
    ).not.toHaveProperty("avatarId");
    expect(
      JoinRequestSchema.parse({ code: "1234567", nickname: "Learner", avatarId: "fox" }),
    ).toMatchObject({ avatarId: "fox" });
    expect(
      JoinRequestSchema.safeParse({
        code: "1234567",
        nickname: "Learner",
        avatarId: "dragon",
      }).success,
    ).toBe(false);
  });

  it("allows a development inbox hint without requiring it in hosted deployments", () => {
    const base = {
      publicWebUrl: "http://localhost:8080",
      mediaUploads: true,
      billing: "disabled" as const,
      communityMode: true,
      signups: true,
      sessionCreation: true,
      roundExperiences: true,
      audiencePulse: true,
      roomChat: true,
    };

    expect(PublicFeaturesSchema.parse(base).developmentEmailInboxUrl).toBeUndefined();
    expect(
      PublicFeaturesSchema.parse({
        ...base,
        developmentEmailInboxUrl: "http://localhost:8025",
      }).developmentEmailInboxUrl,
    ).toBe("http://localhost:8025");
    expect(
      PublicFeaturesSchema.safeParse({
        ...base,
        developmentEmailInboxUrl: "javascript:alert(1)",
      }).success,
    ).toBe(false);
    expect(
      PublicFeaturesSchema.safeParse({
        ...base,
        developmentEmailInboxUrl: "not a URL",
      }).success,
    ).toBe(false);
  });

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

  it("identifies the source Round in follow-up history summaries", () => {
    const quizId = randomUUID();
    expect(
      FollowupSummarySchema.parse({
        id: randomUUID(),
        purpose: "recovery",
        sourceSessionId: randomUUID(),
        sourceReportId: randomUUID(),
        sourceQuizVersionId: randomUUID(),
        quizId,
        title: "Practice follow-up",
        status: "open",
        conceptKeys: ["core-model"],
        checkpointCount: 1,
        attemptCount: 0,
        completedAttemptCount: 0,
        opensAt: "2026-09-18T12:00:00.000Z",
        closesAt: "2026-09-19T12:00:00.000Z",
        expiresAt: "2026-10-18T12:00:00.000Z",
        createdAt: "2026-09-18T12:00:00.000Z",
      }),
    ).toMatchObject({ quizId });
  });

  it("keeps recovery and standalone practice sources distinct", () => {
    const shared = {
      id: randomUUID(),
      sourceQuizVersionId: randomUUID(),
      title: "Independent practice",
      conceptKeys: [],
      checkpointCount: 2,
      timeMode: "flex" as const,
      opensAt: "2026-09-18T12:00:00.000Z",
      closesAt: "2026-09-25T12:00:00.000Z",
      expiresAt: "2026-10-18T12:00:00.000Z",
      closedAt: null,
      createdAt: "2026-09-18T12:00:00.000Z",
    };
    expect(
      FollowupSchema.parse({
        ...shared,
        purpose: "assignment",
        sourceSessionId: null,
        sourceReportId: null,
      }),
    ).toMatchObject({ purpose: "assignment", sourceReportId: null });
    expect(
      FollowupSchema.safeParse({
        ...shared,
        purpose: "assignment",
        sourceSessionId: randomUUID(),
        sourceReportId: null,
      }).success,
    ).toBe(false);
    expect(
      FollowupSchema.safeParse({
        ...shared,
        purpose: "recovery",
        sourceSessionId: null,
        sourceReportId: null,
      }).success,
    ).toBe(false);
    expect(
      FollowupSchema.safeParse({
        ...shared,
        purpose: "assignment",
        sourceSessionId: null,
        sourceReportId: null,
        conceptKeys: ["recovery-only"],
      }).success,
    ).toBe(false);
  });

  it("validates bounded, unique personal labels for practice assignments", () => {
    const closesAt = "2026-09-25T12:00:00.000Z";
    const sourceQuizVersionId = randomUUID();
    expect(
      CreatePracticeAssignmentSchema.parse({
        sourceQuizVersionId,
        closesAt,
        personalLabels: ["Ada", "Grace"],
      }),
    ).toMatchObject({
      sourceQuizVersionId,
      timeMode: "flex",
      personalLabels: ["Ada", "Grace"],
    });
    expect(
      CreatePracticeAssignmentSchema.safeParse({
        closesAt,
        personalLabels: [],
      }).success,
    ).toBe(false);
    expect(
      CreatePracticeAssignmentSchema.safeParse({
        sourceQuizVersionId,
        closesAt,
        personalLabels: ["Ada", " ada "],
      }).success,
    ).toBe(false);
  });

  it("keeps history Round filter options summary-only", () => {
    const option = RoundFilterOptionsResponseSchema.parse({
      quizzes: [
        {
          id: randomUUID(),
          title: "Summary-only Round",
          draft: { questions: [{ answer: "must not survive parsing" }] },
        },
      ],
    }).quizzes[0]!;

    expect(Object.keys(option).sort()).toEqual(["id", "title"]);
  });

  it("keeps beta telemetry dimensions bounded and distribution samples staff-safe", () => {
    expect(ProductEventNameSchema.options).toEqual([
      "creation_started",
      "creation_completed",
      "round_published",
      "setup_recipe_selected",
      "host_setup_completed",
      "participant_joined",
      "first_answer_submitted",
      "response_saved_acknowledged",
      "question_locked",
      "insight_shown",
      "intervention_started",
      "recheck_opened",
      "report_viewed",
      "followup_shared",
      "practice_assignment_created",
      "practice_assignment_shared",
      "rehearsal_started",
      "rehearsal_completed",
    ]);
    expect(
      ProductEventBatchSchema.safeParse({
        events: ProductEventNameSchema.options.map((name) => ({
          name,
          occurredAt: new Date().toISOString(),
          dimensions:
            name === "creation_started" || name === "creation_completed"
              ? { creationPath: "starter" }
              : name === "setup_recipe_selected"
                ? { recipe: "recovery" }
                : name === "rehearsal_started"
                  ? { scenario: "split_room" }
                  : name === "rehearsal_completed"
                    ? { scenario: "split_room", durationBucket: "1_to_5m" }
                    : {},
        })),
      }).success,
    ).toBe(true);
    for (const event of [
      { name: "creation_started", dimensions: {} },
      { name: "creation_completed", dimensions: {} },
      { name: "setup_recipe_selected", dimensions: {} },
      { name: "rehearsal_started", dimensions: {} },
      { name: "rehearsal_completed", dimensions: { scenario: "split_room" } },
      { name: "rehearsal_completed", dimensions: { durationBucket: "1_to_5m" } },
    ]) {
      expect(
        ProductEventBatchSchema.safeParse({
          events: [{ ...event, occurredAt: new Date().toISOString() }],
        }).success,
      ).toBe(false);
    }
    expect(
      ProductEventBatchSchema.safeParse({
        events: [
          {
            name: "creation_started",
            occurredAt: new Date().toISOString(),
            dimensions: { creationPath: "starter", objectId: randomUUID() },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      ProductEventBatchSchema.safeParse({
        events: [
          {
            name: "creation_started",
            occurredAt: new Date().toISOString(),
            dimensions: { creationPath: "starter" },
            actorId: randomUUID(),
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      ProductEventBatchSchema.safeParse({
        events: Array.from({ length: 21 }, () => ({
          name: "rehearsal_completed",
          occurredAt: new Date().toISOString(),
          dimensions: { scenario: "split_room", durationBucket: "1_to_5m" },
        })),
      }).success,
    ).toBe(false);

    expect(
      ResponseDistributionSchema.safeParse({
        kind: "choice",
        respondents: 4,
        totalSelections: 4,
        percentBasis: "responses",
        buckets: [],
      }).success,
    ).toBe(false);
    expect(
      ResponseDistributionSchema.parse({
        kind: "numeric",
        respondents: 5,
        correct: 3,
        incorrect: 2,
      }),
    ).toEqual({ kind: "numeric", respondents: 5, correct: 3, incorrect: 2 });
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

  it("preserves versioned experience metadata when content is published", () => {
    const content = QuizContentSchema.parse({
      title: "Technical checkpoint",
      description: "",
      category: "technical",
      experiencePreset: { id: "blueprint", version: 1 },
      questions: [
        {
          id: randomUUID(),
          type: "true_false",
          prompt: "The published version owns its experience preset.",
          choices: [
            { id: randomUUID(), label: "True", isCorrect: true },
            { id: randomUUID(), label: "False", isCorrect: false },
          ],
          timeLimitSeconds: 20,
          basePoints: 1_000,
          explanation: "Presentation metadata is immutable with the content version.",
          mediaId: null,
          mediaAlt: null,
        },
      ],
    });

    expect(content).toMatchObject({
      category: "technical",
      experiencePreset: { id: "blueprint", version: 1 },
    });
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
      experienceTheme: {
        preset: { id: "focus", version: 1 },
        name: "Focus",
        category: "general",
        motion: "calm",
        soundCue: "none",
        soundEnabled: false,
        tokens: {
          canvas: "#F7F4EC",
          surface: "#FFFFFF",
          surfaceStrong: "#DCEEEE",
          text: "#0B2239",
          mutedText: "#425B72",
          primary: "#075E63",
          accent: "#8A3D22",
          choiceColors: ["#075E63", "#7B3657", "#6D4B0C", "#345594", "#553D8A", "#23613F"],
          pattern: "dots",
          typography: "humanist",
          corners: "soft",
        },
      },
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

  it("rejects adversarial decimal input without regex backtracking", () => {
    const longInvalidDecimal = `${"1".repeat(100_000)}x`;
    expect(() => normalizeDecimalString(longInvalidDecimal)).toThrow(/without exponent notation/);
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

import { z } from "zod";

export const errorCodes = [
  "INVALID_CODE",
  "SESSION_FULL",
  "SESSION_LOCKED",
  "NICKNAME_REJECTED",
  "STALE_VERSION",
  "ANSWER_LATE",
  "ANSWER_INVALID",
  "ENTITLEMENT_LIMIT",
  "UNAUTHORIZED",
  "RATE_LIMITED",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "CONFLICT",
  "DEPENDENCY_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

export const ErrorCodeSchema = z.enum(errorCodes);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    requestId: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const PublicFeaturesSchema = z.object({
  publicWebUrl: z.string().url(),
  mediaUploads: z.boolean(),
  billing: z.enum(["disabled", "stripe"]),
  communityMode: z.boolean(),
  signups: z.boolean(),
  sessionCreation: z.boolean(),
});
export type PublicFeatures = z.infer<typeof PublicFeaturesSchema>;

export const OperationalFeatureFlagsSchema = z.object({
  signups: z.boolean(),
  sessionCreation: z.boolean(),
  mediaUploads: z.boolean(),
});
export type OperationalFeatureFlags = z.infer<typeof OperationalFeatureFlagsSchema>;

export const OperationalFeaturesUpdateSchema = OperationalFeatureFlagsSchema.partial().refine(
  (update) => Object.keys(update).length > 0,
  "Provide at least one operational feature",
);
export type OperationalFeaturesUpdate = z.infer<typeof OperationalFeaturesUpdateSchema>;

export const OperationalFeaturesViewSchema = z.object({
  configured: OperationalFeatureFlagsSchema,
  runtime: OperationalFeatureFlagsSchema.extend({ updatedAt: z.string().datetime().nullable() }),
  effective: OperationalFeatureFlagsSchema,
});
export type OperationalFeaturesView = z.infer<typeof OperationalFeaturesViewSchema>;

export const PlanSchema = z.enum(["free", "pro", "team"]);
export type Plan = z.infer<typeof PlanSchema>;

export const EntitlementsSchema = z.object({
  plan: PlanSchema,
  maxParticipants: z.number().int().positive(),
  maxPublishedQuizzes: z.number().int().positive().nullable(),
  reportRetentionDays: z.number().int().positive(),
  csvExport: z.boolean(),
  brandTheme: z.boolean(),
});
export type Entitlements = z.infer<typeof EntitlementsSchema>;

const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hexadecimal colour such as #0B2239")
  .transform((value) => value.toUpperCase());

function relativeLuminance(hexColor: string) {
  const channels = [1, 3, 5].map((offset) =>
    Number.parseInt(hexColor.slice(offset, offset + 2), 16),
  );
  const [red, green, blue] = channels.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

export function colorContrastRatio(first: string, second: string) {
  const light = Math.max(relativeLuminance(first), relativeLuminance(second));
  const dark = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (light + 0.05) / (dark + 0.05);
}

export const BrandThemeSchema = z
  .object({
    organizationName: z.string().trim().min(1).max(80),
    primaryColor: HexColorSchema,
    accentColor: HexColorSchema,
  })
  .superRefine((theme, ctx) => {
    for (const field of ["primaryColor", "accentColor"] as const) {
      if (colorContrastRatio(theme[field], "#FFFFFF") < 4.5) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "Choose a darker colour with at least 4.5:1 contrast against white",
        });
      }
    }
  });
export type BrandTheme = z.infer<typeof BrandThemeSchema>;

export const QuestionTypeSchema = z.enum(["single_select", "true_false"]);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;

export const ChoiceSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(180),
  isCorrect: z.boolean(),
});
export type Choice = z.infer<typeof ChoiceSchema>;

export const QuestionSchema = z
  .object({
    id: z.string().uuid(),
    type: QuestionTypeSchema,
    prompt: z.string().trim().min(1).max(500),
    choices: z.array(ChoiceSchema).min(2).max(6),
    timeLimitSeconds: z.number().int().min(5).max(300),
    basePoints: z.number().int().min(0).max(10_000).default(1_000),
    explanation: z.string().trim().max(1_000).default(""),
    mediaId: z.string().uuid().nullable().default(null),
    mediaAlt: z.string().trim().max(300).nullable().default(null),
  })
  .superRefine((question, ctx) => {
    const correct = question.choices.filter((choice) => choice.isCorrect);
    if (correct.length !== 1) {
      ctx.addIssue({
        code: "custom",
        message: "Exactly one answer choice must be correct",
        path: ["choices"],
      });
    }
    if (question.type === "true_false" && question.choices.length !== 2) {
      ctx.addIssue({
        code: "custom",
        message: "True or false questions require exactly two choices",
        path: ["choices"],
      });
    }
    if (question.mediaId && !question.mediaAlt) {
      ctx.addIssue({
        code: "custom",
        message: "Instructional images require alternative text",
        path: ["mediaAlt"],
      });
    }
  });
export type Question = z.infer<typeof QuestionSchema>;

export const QuizDraftSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1_000).default(""),
  questions: z.array(QuestionSchema).max(200),
});
export type QuizDraft = z.infer<typeof QuizDraftSchema>;

export const ScoringModeSchema = z.enum(["accuracy", "speed"]);
export type ScoringMode = z.infer<typeof ScoringModeSchema>;

export const ResultVisibilitySchema = z.enum(["private", "leaderboard"]);
export type ResultVisibility = z.infer<typeof ResultVisibilitySchema>;

export const SessionSettingsSchema = z.object({
  audienceLimit: z.number().int().min(1).max(250),
  scoringMode: ScoringModeSchema,
  resultVisibility: ResultVisibilitySchema,
  allowLateJoin: z.boolean(),
  nicknamePolicy: z.enum(["custom", "friendly_only"]),
});
export type SessionSettings = z.infer<typeof SessionSettingsSchema>;

export const SessionPhaseSchema = z.enum([
  "lobby",
  "question_open",
  "paused",
  "question_locked",
  "question_reveal",
  "leaderboard",
  "finished",
]);
export type SessionPhase = z.infer<typeof SessionPhaseSchema>;

export const ParticipantViewSchema = z.object({
  id: z.string().uuid(),
  nickname: z.string(),
  score: z.number().int(),
  connected: z.boolean(),
  rank: z.number().int().positive().nullable(),
});
export type ParticipantView = z.infer<typeof ParticipantViewSchema>;

export const PublicQuestionSchema = z.object({
  id: z.string().uuid(),
  prompt: z.string(),
  choices: z.array(ChoiceSchema.omit({ isCorrect: true })),
  timeLimitSeconds: z.number().int(),
  basePoints: z.number().int(),
  mediaId: z.string().uuid().nullable(),
  mediaAlt: z.string().nullable(),
});
export type PublicQuestion = z.infer<typeof PublicQuestionSchema>;

export const SessionSnapshotSchema = z.object({
  sessionId: z.string().uuid(),
  code: z.string().regex(/^\d{7}$/),
  version: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  phase: SessionPhaseSchema,
  roundId: z.string().uuid().nullable(),
  questionIndex: z.number().int().nonnegative().nullable(),
  questionCount: z.number().int().nonnegative(),
  question: PublicQuestionSchema.nullable(),
  deadline: z.string().datetime().nullable(),
  participants: z.array(ParticipantViewSchema),
  answerCount: z.number().int().nonnegative(),
  lobbyLocked: z.boolean(),
  settings: SessionSettingsSchema,
  brandTheme: BrandThemeSchema.nullable(),
  pausedRemainingMs: z.number().int().nonnegative().nullable(),
  myParticipantId: z.string().uuid().nullable().optional(),
  myAnswerChoiceId: z.string().uuid().nullable().optional(),
  correctChoiceId: z.string().uuid().nullable().optional(),
  explanation: z.string().nullable().optional(),
});
export type SessionSnapshot = z.infer<typeof SessionSnapshotSchema>;

export const EventEnvelopeSchema = z.object({
  eventId: z.string(),
  sessionId: z.string().uuid(),
  sessionVersion: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  type: z.string(),
  schemaVersion: z.literal(1),
  serverTime: z.string().datetime(),
  idempotencyKey: z.string().max(160).optional(),
  payload: z.unknown(),
});
export type EventEnvelope<T = unknown> = Omit<z.infer<typeof EventEnvelopeSchema>, "payload"> & {
  payload: T;
};

export const JoinRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{7}$/),
  nickname: z.string().trim().min(1).max(32).optional(),
  resumeToken: z.string().min(20).max(1_000).optional(),
});
export type JoinRequest = z.infer<typeof JoinRequestSchema>;

export const JoinResponseSchema = z.object({
  participantId: z.string().uuid(),
  participantToken: z.string(),
  snapshot: SessionSnapshotSchema,
});
export type JoinResponse = z.infer<typeof JoinResponseSchema>;

export const AnswerSubmitSchema = z.object({
  sessionId: z.string().uuid(),
  roundId: z.string().uuid(),
  choiceId: z.string().uuid(),
  participantToken: z.string().min(20),
  idempotencyKey: z.string().min(8).max(160),
});
export type AnswerSubmit = z.infer<typeof AnswerSubmitSchema>;

export const AnswerAckSchema = z.object({
  accepted: z.boolean(),
  answerId: z.string().uuid().optional(),
  acceptedAt: z.string().datetime().optional(),
  score: z.number().int().optional(),
  duplicate: z.boolean().default(false),
  code: ErrorCodeSchema.optional(),
});
export type AnswerAck = z.infer<typeof AnswerAckSchema>;

export const HostActionSchema = z.enum([
  "start",
  "pause",
  "resume",
  "lock",
  "reveal",
  "next",
  "show_leaderboard",
  "end",
  "lock_lobby",
  "unlock_lobby",
  "kick",
]);
export type HostAction = z.infer<typeof HostActionSchema>;

export const HostCommandSchema = z
  .object({
    sessionId: z.string().uuid(),
    hostToken: z.string().min(20),
    commandId: z.string().min(8).max(160),
    expectedVersion: z.number().int().nonnegative(),
    action: HostActionSchema,
    participantId: z.string().uuid().optional(),
  })
  .superRefine((command, context) => {
    if (command.action === "kick" && !command.participantId) {
      context.addIssue({
        code: "custom",
        message: "participantId is required when kicking a participant",
        path: ["participantId"],
      });
    }
  });
export type HostCommand = z.infer<typeof HostCommandSchema>;

export const SyncRequestSchema = z
  .object({
    sessionId: z.string().uuid(),
    role: z.enum(["host", "presenter", "participant"]),
    hostToken: z.string().min(20).max(1_000).optional(),
    participantToken: z.string().min(20).max(1_000).optional(),
    lastSeq: z.number().int().nonnegative().default(0),
  })
  .superRefine((request, context) => {
    if (request.role === "participant" && !request.participantToken) {
      context.addIssue({
        code: "custom",
        message: "participantToken is required for participant synchronization",
        path: ["participantToken"],
      });
    }
    if (request.role !== "participant" && !request.hostToken) {
      context.addIssue({
        code: "custom",
        message: "hostToken is required for host or presenter synchronization",
        path: ["hostToken"],
      });
    }
  });
export type SyncRequest = z.infer<typeof SyncRequestSchema>;

export const SyncResponseSchema = z.object({
  snapshot: SessionSnapshotSchema,
  replay: z.array(EventEnvelopeSchema),
  replayComplete: z.boolean(),
});
export type SyncResponse = z.infer<typeof SyncResponseSchema>;

export const MediaScanStatusSchema = z.enum(["pending", "clean", "rejected"]);
export type MediaScanStatus = z.infer<typeof MediaScanStatusSchema>;

export const MediaUploadRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024),
  altText: z.string().trim().min(1).max(300),
});
export type MediaUploadRequest = z.infer<typeof MediaUploadRequestSchema>;

export const MediaUploadTicketSchema = z.object({
  mediaId: z.string().uuid(),
  uploadUrl: z.string().url(),
  expiresInSeconds: z.number().int().positive(),
  scanStatus: z.literal("pending"),
});
export type MediaUploadTicket = z.infer<typeof MediaUploadTicketSchema>;

export const MediaAccessSchema = z.object({
  media: z.object({
    id: z.string().uuid(),
    scanStatus: MediaScanStatusSchema,
    altText: z.string().min(1).max(300),
  }),
  downloadUrl: z.string().url().optional(),
});
export type MediaAccess = z.infer<typeof MediaAccessSchema>;

export const CreateQuizSchema = QuizDraftSchema.pick({ title: true }).extend({
  description: z.string().trim().max(1_000).default(""),
});

export const UpdateQuizSchema = QuizDraftSchema;

export const CreateSessionSchema = z.object({
  quizId: z.string().uuid(),
  settings: SessionSettingsSchema,
});

export const CreateSessionResponseSchema = z.object({
  sessionId: z.string().uuid(),
  code: z.string().regex(/^\d{7}$/),
  hostToken: z.string(),
  snapshot: SessionSnapshotSchema,
});

export const MagicLinkRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  segment: z.enum(["education", "workplace"]).default("workplace"),
  acceptPolicies: z.literal(true),
});

export const ReportSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  status: z.enum(["pending", "ready", "failed"]),
  generatedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime(),
  metrics: z.object({
    participantCount: z.number().int().nonnegative(),
    completedCount: z.number().int().nonnegative(),
    answerCount: z.number().int().nonnegative(),
    accuracyPercent: z.number().min(0).max(100),
  }),
  questions: z.array(
    z.object({
      questionId: z.string().uuid(),
      prompt: z.string(),
      responses: z.number().int().nonnegative(),
      correct: z.number().int().nonnegative(),
      accuracyPercent: z.number().min(0).max(100),
      difficult: z.boolean(),
    }),
  ),
  participants: z.array(
    z.object({
      participantId: z.string().uuid(),
      nickname: z.string(),
      score: z.number().int(),
      correctCount: z.number().int().nonnegative(),
      answerCount: z.number().int().nonnegative(),
    }),
  ),
});
export type Report = z.infer<typeof ReportSchema>;

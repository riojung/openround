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
  "QNA_DISABLED",
  "MODERATION_REQUIRED",
  "QNA_RATE_LIMITED",
  "IMPORT_VALIDATION_FAILED",
  "EXPORT_VALIDATION_FAILED",
  "FOLLOWUP_NOT_OPEN",
  "FOLLOWUP_CLOSED",
  "FOLLOWUP_COMPLETED",
  "AUTHORING_DISABLED",
  "AUTHORING_LIMIT",
  "INSTITUTION_NOT_ENABLED",
  "INSTITUTION_AUTH_REQUIRED",
  "FEDERATED_AUTH_DISABLED",
  "FEDERATED_IDENTITY_NOT_LINKED",
  "FEDERATED_AUTH_REPLAYED",
  "LTI_DISABLED",
  "LTI_REGISTRATION_NOT_FOUND",
  "LTI_LAUNCH_INVALID",
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
  followups: z.boolean(),
  authoringJobsPerMonth: z.number().int().nonnegative().nullable(),
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

export const QuestionTypeSchema = z.enum([
  "single_select",
  "true_false",
  "multi_select",
  "numeric",
  "rating",
  "poll",
]);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;

export const QuestionPurposeSchema = z.enum(["diagnostic", "practice", "opinion"]);
export type QuestionPurpose = z.infer<typeof QuestionPurposeSchema>;

export const ConfidenceModeSchema = z.enum(["off", "optional", "required"]);
export type ConfidenceMode = z.infer<typeof ConfidenceModeSchema>;

export const QuestionDeliverySchema = z.enum(["main", "recheck"]);
export type QuestionDelivery = z.infer<typeof QuestionDeliverySchema>;

export const ConfidenceValueSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type ConfidenceValue = z.infer<typeof ConfidenceValueSchema>;

const ConceptKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i, "Use letters, numbers, dots, dashes, or underscores");

export const ChoiceDraftSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().max(180),
  isCorrect: z.boolean(),
  feedback: z.string().trim().max(500).optional(),
  misconceptionKey: ConceptKeySchema.nullable().optional(),
});
export type ChoiceDraft = z.infer<typeof ChoiceDraftSchema>;

export const ChoiceSchema = ChoiceDraftSchema.extend({
  label: z.string().trim().min(1, "Enter an answer").max(180),
});
export type Choice = z.infer<typeof ChoiceSchema>;

type ChoiceQuestionRuleInput = {
  type: QuestionType;
  choices: Array<{ isCorrect: boolean }>;
};

function applyChoiceRules(question: ChoiceQuestionRuleInput, ctx: z.RefinementCtx) {
  const correct = question.choices.filter((choice) => choice.isCorrect);
  const requiredCorrect = question.type === "multi_select" ? "one or more" : "exactly one";
  if (
    question.type !== "poll" &&
    (correct.length === 0 || (question.type !== "multi_select" && correct.length !== 1))
  ) {
    ctx.addIssue({
      code: "custom",
      message: `Select ${requiredCorrect} correct answer${requiredCorrect === "one or more" ? "s" : ""}`,
      path: ["choices"],
    });
  }
  if (question.type === "poll" && correct.length > 0) {
    ctx.addIssue({
      code: "custom",
      message: "Poll choices cannot be marked correct",
      path: ["choices"],
    });
  }
  if (question.type === "true_false" && question.choices.length !== 2) {
    ctx.addIssue({
      code: "custom",
      message: "Use exactly two choices for a true or false question",
      path: ["choices"],
    });
  }
}

type CommonQuestionRuleInput = {
  type: QuestionType;
  purpose?: QuestionPurpose;
  confidence?: ConfidenceMode;
  delivery?: QuestionDelivery;
  linkedRecheckQuestionId?: string | null;
  mediaId: string | null;
  mediaAlt: string | null;
  basePoints: number;
};

function applyCommonQuestionRules(question: CommonQuestionRuleInput, ctx: z.RefinementCtx) {
  if (question.mediaId && !question.mediaAlt?.trim()) {
    ctx.addIssue({
      code: "custom",
      message: "Describe the instructional image for participants who cannot see it",
      path: ["mediaAlt"],
    });
  }
  if (question.type === "poll" || question.type === "rating") {
    if ((question.purpose ?? "opinion") !== "opinion") {
      ctx.addIssue({
        code: "custom",
        message: "Poll and rating checkpoints must have an opinion purpose",
        path: ["purpose"],
      });
    }
    if ((question.confidence ?? "off") !== "off") {
      ctx.addIssue({
        code: "custom",
        message: "Poll and rating checkpoints cannot collect confidence",
        path: ["confidence"],
      });
    }
    if (question.basePoints !== 0) {
      ctx.addIssue({
        code: "custom",
        message: "Poll and rating checkpoints are unscored",
        path: ["basePoints"],
      });
    }
  }
  if ((question.delivery ?? "main") === "recheck" && question.linkedRecheckQuestionId) {
    ctx.addIssue({
      code: "custom",
      message: "A recheck cannot link to another recheck",
      path: ["linkedRecheckQuestionId"],
    });
  }
}

const CommonQuestionDraftSchema = z.object({
  id: z.string().uuid(),
  prompt: z.string().trim().max(500),
  purpose: QuestionPurposeSchema.optional(),
  confidence: ConfidenceModeSchema.optional(),
  delivery: QuestionDeliverySchema.optional(),
  conceptKeys: z.array(ConceptKeySchema).max(12).optional(),
  linkedRecheckQuestionId: z.string().uuid().nullable().optional(),
  timeLimitSeconds: z.number().int().min(5).max(300),
  basePoints: z.number().int().min(0).max(10_000),
  explanation: z.string().trim().max(1_000),
  mediaId: z.string().uuid().nullable(),
  mediaAlt: z.string().trim().max(300).nullable(),
  sourceCitations: z
    .array(
      z.object({
        sourceName: z.string().trim().min(1).max(200),
        sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
        locator: z.string().trim().min(1).max(120),
        excerpt: z.string().trim().min(1).max(500),
      }),
    )
    .max(5)
    .optional(),
});

const ChoiceQuestionDraftSchema = CommonQuestionDraftSchema.extend({
  type: z.enum(["single_select", "true_false", "multi_select", "poll"]),
  choices: z.array(ChoiceDraftSchema).min(2).max(6),
}).superRefine(applyChoiceRules);

const NumericQuestionDraftSchema = CommonQuestionDraftSchema.extend({
  type: z.literal("numeric"),
  correctValue: z.string().trim().max(64),
  tolerance: z.string().trim().max(64),
  unit: z.string().trim().max(32).nullable(),
});

const RatingQuestionDraftSchema = CommonQuestionDraftSchema.extend({
  type: z.literal("rating"),
  min: z.number().int().min(1).max(9),
  max: z.number().int().min(2).max(10),
  minLabel: z.string().trim().max(80),
  maxLabel: z.string().trim().max(80),
}).refine((question) => question.max > question.min, {
  message: "Rating maximum must be greater than its minimum",
  path: ["max"],
});

export const QuestionDraftSchema = z
  .union([ChoiceQuestionDraftSchema, NumericQuestionDraftSchema, RatingQuestionDraftSchema])
  .superRefine(applyCommonQuestionRules);
export type QuestionDraft = z.infer<typeof QuestionDraftSchema>;

const CommonQuestionSchema = CommonQuestionDraftSchema.extend({
  prompt: z.string().trim().min(1, "Enter the question text").max(500),
});

const ChoiceQuestionSchema = CommonQuestionSchema.extend({
  type: z.enum(["single_select", "true_false", "multi_select", "poll"]),
  choices: z.array(ChoiceSchema).min(2, "Add at least two answer choices").max(6),
}).superRefine(applyChoiceRules);

export function normalizeDecimalString(value: string): string {
  const trimmed = value.trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) {
    throw new Error("Enter a decimal number without exponent notation");
  }
  const negative = trimmed.startsWith("-");
  const unsigned = trimmed.replace(/^[+-]/, "");
  const [integerPart = "0", fractionPart = ""] = unsigned.split(".");
  const integer = integerPart.replace(/^0+(?=\d)/, "") || "0";
  const fraction = fractionPart.replace(/0+$/, "");
  const normalized = fraction ? `${integer}.${fraction}` : integer;
  return negative && normalized !== "0" ? `-${normalized}` : normalized;
}

const DecimalStringSchema = z
  .string()
  .trim()
  .min(1, "Enter a numeric answer")
  .max(64)
  .transform((value, context) => {
    try {
      return normalizeDecimalString(value);
    } catch (error) {
      context.addIssue({ code: "custom", message: (error as Error).message });
      return z.NEVER;
    }
  });

const NumericQuestionSchema = CommonQuestionSchema.extend({
  type: z.literal("numeric"),
  correctValue: DecimalStringSchema,
  tolerance: DecimalStringSchema.refine((value) => !value.startsWith("-"), {
    message: "Tolerance cannot be negative",
  }),
  unit: z.string().trim().max(32).nullable(),
});

const RatingQuestionSchema = CommonQuestionSchema.extend({
  type: z.literal("rating"),
  min: z.number().int().min(1).max(9),
  max: z.number().int().min(2).max(10),
  minLabel: z.string().trim().max(80),
  maxLabel: z.string().trim().max(80),
}).refine((question) => question.max > question.min, {
  message: "Rating maximum must be greater than its minimum",
  path: ["max"],
});

export const QuestionSchema = z
  .union([ChoiceQuestionSchema, NumericQuestionSchema, RatingQuestionSchema])
  .superRefine(applyCommonQuestionRules);
export type Question = z.infer<typeof QuestionSchema>;

export const QuizDraftSchema = z.object({
  title: z.string().trim().max(160),
  description: z.string().trim().max(1_000).default(""),
  questions: z.array(QuestionDraftSchema).max(200),
});
export type QuizDraft = z.infer<typeof QuizDraftSchema>;

export const QuizContentSchema = z
  .object({
    title: z.string().trim().min(1, "Enter a quiz title").max(160),
    description: z.string().trim().max(1_000).default(""),
    questions: z.array(QuestionSchema).min(1, "Add at least one question").max(200),
  })
  .superRefine((quiz, context) => {
    const byId = new Map(quiz.questions.map((question) => [question.id, question]));
    for (const [index, question] of quiz.questions.entries()) {
      if (!question.linkedRecheckQuestionId) continue;
      const linked = byId.get(question.linkedRecheckQuestionId);
      if (!linked) {
        context.addIssue({
          code: "custom",
          message: "Linked recheck checkpoint does not exist",
          path: ["questions", index, "linkedRecheckQuestionId"],
        });
      } else if ((linked.delivery ?? "main") !== "recheck") {
        context.addIssue({
          code: "custom",
          message: "Linked checkpoint must be marked as a recheck",
          path: ["questions", index, "linkedRecheckQuestionId"],
        });
      }
    }
  });
export type QuizContent = z.infer<typeof QuizContentSchema>;

export const OpenRoundCheckpointSetExportSchema = z.object({
  format: z.literal("openround.checkpoint-set"),
  version: z.literal(1),
  exportedAt: z.string().datetime(),
  checkpointSet: QuizDraftSchema,
});
export type OpenRoundCheckpointSetExport = z.infer<typeof OpenRoundCheckpointSetExportSchema>;

export const CheckpointSetImportRequestSchema = z
  .object({
    format: z.enum(["openround_json", "csv", "bulk", "qti3"]),
    data: z.string().min(1).max(8_000_000),
    encoding: z.enum(["text", "base64"]).default("text"),
    title: z.string().trim().min(1).max(160).optional(),
  })
  .superRefine((input, context) => {
    if (input.format === "qti3" && input.encoding !== "base64") {
      context.addIssue({
        code: "custom",
        path: ["encoding"],
        message: "QTI 3 packages must use base64 encoding",
      });
    }
    if (input.format !== "qti3" && input.encoding !== "text") {
      context.addIssue({
        code: "custom",
        path: ["encoding"],
        message: "This import format must use text encoding",
      });
    }
  });

export const ImportValidationIssueSchema = z.object({
  severity: z.enum(["error", "warning"]),
  code: z.string(),
  message: z.string(),
  row: z.number().int().positive().optional(),
  field: z.string().optional(),
});

export const ImportValidationReportSchema = z.object({
  format: z.enum(["openround_json", "csv", "bulk", "qti3"]),
  importedCheckpoints: z.number().int().nonnegative(),
  errors: z.array(ImportValidationIssueSchema),
  warnings: z.array(ImportValidationIssueSchema),
});
export type ImportValidationReport = z.infer<typeof ImportValidationReportSchema>;

export const FolderSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Folder = z.infer<typeof FolderSchema>;

export const CreateFolderSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const UpdateFolderSchema = CreateFolderSchema;

export const OrganizeQuizSchema = z.object({
  folderId: z.string().uuid().nullable(),
  tags: z
    .array(z.string().trim().min(1).max(40))
    .max(20)
    .transform((tags) => {
      const unique = new Map<string, string>();
      for (const tag of tags) {
        const normalized = tag.replace(/\s+/g, " ");
        if (!unique.has(normalized.toLocaleLowerCase())) {
          unique.set(normalized.toLocaleLowerCase(), normalized);
        }
      }
      return [...unique.values()];
    }),
});

export function questionPurpose(question: Pick<QuestionDraft, "type" | "purpose">) {
  return (
    question.purpose ??
    (question.type === "poll" || question.type === "rating" ? "opinion" : "diagnostic")
  );
}

export function questionConfidence(question: Pick<QuestionDraft, "confidence">) {
  return question.confidence ?? "off";
}

export function questionDelivery(question: Pick<QuestionDraft, "delivery">) {
  return question.delivery ?? "main";
}

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
  "intervention",
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
  type: QuestionTypeSchema.default("single_select"),
  prompt: z.string(),
  purpose: QuestionPurposeSchema.default("diagnostic"),
  confidence: ConfidenceModeSchema.default("off"),
  choices: z
    .array(ChoiceSchema.omit({ isCorrect: true, feedback: true, misconceptionKey: true }))
    .default([]),
  unit: z.string().nullable().optional(),
  rating: z
    .object({
      min: z.number().int(),
      max: z.number().int(),
      minLabel: z.string(),
      maxLabel: z.string(),
    })
    .optional(),
  linkedRecheckAvailable: z.boolean().default(false),
  timeLimitSeconds: z.number().int(),
  basePoints: z.number().int(),
  mediaId: z.string().uuid().nullable(),
  mediaAlt: z.string().nullable(),
});
export type PublicQuestion = z.infer<typeof PublicQuestionSchema>;

export const RoundKindSchema = z.enum(["main", "linked_recheck", "revote"]);
export type RoundKind = z.infer<typeof RoundKindSchema>;

export const InterventionTypeSchema = z.enum(["peer_discussion", "explain", "example", "break"]);
export type InterventionType = z.infer<typeof InterventionTypeSchema>;

export const InterventionStateSchema = z.object({
  id: z.string().uuid(),
  type: InterventionTypeSchema,
  sourceRoundId: z.string().uuid(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
});
export type InterventionState = z.infer<typeof InterventionStateSchema>;

export const InsightActionSchema = z.enum([
  "wait_or_check_access",
  "target_misconception",
  "explain",
  "show_example",
  "peer_discussion",
  "reinforce",
  "continue",
]);
export type InsightAction = z.infer<typeof InsightActionSchema>;

export const CheckpointInsightSchema = z.object({
  sampleSize: z.number().int().nonnegative(),
  activeParticipantCount: z.number().int().nonnegative(),
  participationPercent: z.number().min(0).max(100),
  correctnessPercent: z.number().min(0).max(100).nullable(),
  highConfidenceWrongPercent: z.number().min(0).max(100).nullable(),
  correctLowConfidencePercent: z.number().min(0).max(100).nullable(),
  dominantMisconception: z
    .object({
      key: z.string(),
      responses: z.number().int().positive(),
      allResponsePercent: z.number().min(0).max(100),
      wrongResponsePercent: z.number().min(0).max(100),
    })
    .nullable(),
  recommendation: z.object({
    code: z.string(),
    action: InsightActionSchema,
    title: z.string(),
    reason: z.string(),
    strong: z.boolean(),
  }),
});
export type CheckpointInsight = z.infer<typeof CheckpointInsightSchema>;

const ChoiceResponseSchema = z.object({
  kind: z.literal("choice"),
  choiceIds: z.array(z.string().uuid()).min(1).max(6),
});

const NumericResponseSchema = z.object({
  kind: z.literal("numeric"),
  value: DecimalStringSchema,
  unit: z.string().trim().max(32).optional(),
});

const RatingResponseSchema = z.object({
  kind: z.literal("rating"),
  value: z.number().int().min(1).max(10),
});

const PollResponseSchema = z.object({
  kind: z.literal("poll"),
  choiceIds: z.array(z.string().uuid()).length(1),
});

export const ResponsePayloadSchema = z
  .discriminatedUnion("kind", [
    ChoiceResponseSchema,
    NumericResponseSchema,
    RatingResponseSchema,
    PollResponseSchema,
  ])
  .superRefine((response, context) => {
    if (
      (response.kind === "choice" || response.kind === "poll") &&
      new Set(response.choiceIds).size !== response.choiceIds.length
    ) {
      context.addIssue({ code: "custom", message: "A choice can only be selected once" });
    }
  });
export type ResponsePayload = z.infer<typeof ResponsePayloadSchema>;

export function canonicalizeResponse(response: ResponsePayload): ResponsePayload {
  if (response.kind === "choice" || response.kind === "poll") {
    return { ...response, choiceIds: [...response.choiceIds].sort() };
  }
  if (response.kind === "numeric") {
    return { ...response, value: normalizeDecimalString(response.value) };
  }
  return response;
}

export const SessionSnapshotSchema = z.object({
  mode: z.literal("live").default("live"),
  stateSchemaVersion: z.number().int().positive().default(1),
  sessionId: z.string().uuid(),
  code: z.string().regex(/^\d{7}$/),
  version: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  phase: SessionPhaseSchema,
  roundId: z.string().uuid().nullable(),
  roundKind: RoundKindSchema.default("main"),
  sourceRoundId: z.string().uuid().nullable().default(null),
  questionIndex: z.number().int().nonnegative().nullable(),
  questionPosition: z.number().int().nonnegative().nullable().optional(),
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
  myResponse: ResponsePayloadSchema.nullable().optional(),
  myConfidence: ConfidenceValueSchema.nullable().optional(),
  myCorrect: z.boolean().nullable().optional(),
  correctChoiceId: z.string().uuid().nullable().optional(),
  correctResponse: ResponsePayloadSchema.nullable().optional(),
  explanation: z.string().nullable().optional(),
  feedback: z.string().nullable().optional(),
  intervention: InterventionStateSchema.nullable().default(null),
  insight: CheckpointInsightSchema.optional(),
});
export type SessionSnapshot = z.infer<typeof SessionSnapshotSchema>;

export const EventEnvelopeSchema = z.object({
  eventId: z.string(),
  sessionId: z.string().uuid(),
  sessionVersion: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  type: z.string(),
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
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

export const SessionStaffRoleSchema = z.enum(["cohost", "presenter"]);
export type SessionStaffRole = z.infer<typeof SessionStaffRoleSchema>;

export const CreateSessionStaffCredentialSchema = z.object({
  role: SessionStaffRoleSchema,
  label: z.string().trim().max(80).default(""),
  expiresInMinutes: z
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .default(240),
});

export const SessionStaffCredentialSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  role: SessionStaffRoleSchema,
  label: z.string(),
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type SessionStaffCredential = z.infer<typeof SessionStaffCredentialSchema>;

export const CreateSessionStaffCredentialResponseSchema = z.object({
  credential: SessionStaffCredentialSchema,
  token: z.string().min(20),
  embedPolicyKey: z.string().min(20).optional(),
  embedAllowedOrigins: z.array(z.string().url()).max(10).optional(),
});

const HttpsOriginSchema = z
  .string()
  .trim()
  .url()
  .superRefine((value, context) => {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") {
      context.addIssue({ code: "custom", message: "Embed origins must use HTTPS" });
    }
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      context.addIssue({
        code: "custom",
        message: "Enter an origin only, such as https://learning.example.org",
      });
    }
  })
  .transform((value) => new URL(value).origin);

export const EmbedAllowedOriginsSchema = z.object({
  origins: z
    .array(HttpsOriginSchema)
    .max(10)
    .transform((origins) => [...new Set(origins)]),
});
export type EmbedAllowedOrigins = z.infer<typeof EmbedAllowedOriginsSchema>;

export const EmbedPolicySchema = z.object({
  sessionId: z.string().uuid(),
  allowedOrigins: z.array(HttpsOriginSchema).max(10),
  expiresAt: z.string().datetime(),
});
export type EmbedPolicy = z.infer<typeof EmbedPolicySchema>;

export const WorkspaceRoleSchema = z.enum(["owner", "editor", "viewer"]);
export type WorkspaceRole = z.infer<typeof WorkspaceRoleSchema>;

export const IdentityRequirementSchema = z.enum(["guest", "optional", "institution"]);
export type IdentityRequirement = z.infer<typeof IdentityRequirementSchema>;

export const InstitutionContractStatusSchema = z.enum(["disabled", "pilot", "active"]);
export type InstitutionContractStatus = z.infer<typeof InstitutionContractStatusSchema>;

export const InstitutionCapabilitiesSchema = z.object({
  oidc: z.boolean(),
  managedSso: z.boolean(),
  scim: z.boolean(),
  lti: z.boolean(),
  nrps: z.boolean(),
  ags: z.boolean(),
  auditExports: z.boolean(),
  residencyControls: z.boolean(),
});
export type InstitutionCapabilities = z.infer<typeof InstitutionCapabilitiesSchema>;

function validateInstitutionPolicy(
  policy: {
    contractStatus: InstitutionContractStatus;
    identityRequirement: IdentityRequirement;
    capabilities: InstitutionCapabilities;
  },
  ctx: z.RefinementCtx,
) {
  const enabledCapabilities = Object.entries(policy.capabilities)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
  if (
    policy.contractStatus === "disabled" &&
    (policy.identityRequirement !== "guest" || enabledCapabilities.length > 0)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["contractStatus"],
      message: "A disabled contract must keep guest identity and all capabilities off",
    });
  }
  if (
    (policy.capabilities.nrps || policy.capabilities.ags) &&
    (!policy.capabilities.lti || policy.identityRequirement !== "institution")
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["capabilities"],
      message: "NRPS and AGS require LTI with institution-identified participation",
    });
  }
  if (policy.capabilities.scim && !policy.capabilities.managedSso) {
    ctx.addIssue({
      code: "custom",
      path: ["capabilities", "scim"],
      message: "SCIM requires managed SSO",
    });
  }
}

export const WorkspaceInstitutionPolicySchema = z
  .object({
    workspaceId: z.string().uuid(),
    contractStatus: InstitutionContractStatusSchema,
    identityRequirement: IdentityRequirementSchema,
    capabilities: InstitutionCapabilitiesSchema,
    k12Enabled: z.literal(false),
    updatedAt: z.string().datetime().nullable(),
  })
  .superRefine(validateInstitutionPolicy);
export type WorkspaceInstitutionPolicy = z.infer<typeof WorkspaceInstitutionPolicySchema>;

export const UpdateWorkspaceInstitutionPolicySchema = z
  .object({
    contractStatus: InstitutionContractStatusSchema,
    identityRequirement: IdentityRequirementSchema,
    capabilities: InstitutionCapabilitiesSchema,
    // This release deliberately cannot enable K-12 through an API call.
    k12Enabled: z.literal(false).default(false),
  })
  .superRefine(validateInstitutionPolicy);
export type UpdateWorkspaceInstitutionPolicy = z.infer<
  typeof UpdateWorkspaceInstitutionPolicySchema
>;

export const FederatedIdentitySchema = z.object({
  id: z.string().uuid(),
  provider: z.enum(["oidc", "lti"]),
  issuer: z.string().url(),
  emailHint: z.string().email().nullable(),
  linkedAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
});
export type FederatedIdentity = z.infer<typeof FederatedIdentitySchema>;

export const OidcStartSchema = z.object({
  workspaceId: z.string().uuid(),
  mode: z.enum(["login", "link"]),
});

export const OidcStatusSchema = z.object({
  enabled: z.boolean(),
  providerName: z.string().min(1).max(80).nullable(),
  workspaceId: z.string().uuid(),
  identityRequirement: IdentityRequirementSchema,
});
export type OidcStatus = z.infer<typeof OidcStatusSchema>;

export const LtiRegistrationStatusSchema = z.enum(["disabled", "active"]);
export const LtiRegistrationSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(120),
  issuer: z.string().url(),
  clientId: z.string().min(1).max(500),
  deploymentId: z.string().min(1).max(500),
  authorizationEndpoint: z.string().url(),
  tokenEndpoint: z.string().url().nullable(),
  jwksUrl: z.string().url(),
  deepLinkReturnOrigins: z.array(z.string().url()).max(10),
  status: LtiRegistrationStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type LtiRegistration = z.infer<typeof LtiRegistrationSchema>;

export const UpsertLtiRegistrationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  issuer: z.string().url().max(2_048),
  clientId: z.string().trim().min(1).max(500),
  deploymentId: z.string().trim().min(1).max(500),
  authorizationEndpoint: z.string().url().max(2_048),
  tokenEndpoint: z.string().url().max(2_048).nullable().default(null),
  jwksUrl: z.string().url().max(2_048),
  deepLinkReturnOrigins: z
    .array(z.string().url().max(2_048))
    .max(10)
    .transform((values) => [...new Set(values.map((value) => new URL(value).origin))]),
  status: LtiRegistrationStatusSchema.default("active"),
});

export const LtiLoginInitiationSchema = z.object({
  iss: z.string().url().max(2_048),
  login_hint: z.string().min(1).max(2_048),
  target_link_uri: z.string().url().max(2_048),
  lti_message_hint: z.string().min(1).max(8_192).optional(),
  client_id: z.string().min(1).max(500).optional(),
  lti_deployment_id: z.string().min(1).max(500).optional(),
});

export const LtiLaunchFormSchema = z.object({
  state: z.string().min(20).max(1_000),
  id_token: z.string().min(20).max(64_000),
});

export const LtiLaunchViewSchema = z.object({
  id: z.string().uuid(),
  messageType: z.enum(["LtiResourceLinkRequest", "LtiDeepLinkingRequest"]),
  role: z.enum(["instructor", "learner"]),
  quizId: z.string().uuid().nullable(),
  expiresAt: z.string().datetime(),
});
export type LtiLaunchView = z.infer<typeof LtiLaunchViewSchema>;

export const LtiDeepLinkSelectionSchema = z.object({ quizId: z.string().uuid() });

export const CreateWorkspaceInvitationSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(320)
    .transform((value) => value.toLocaleLowerCase()),
  role: WorkspaceRoleSchema.exclude(["owner"]),
});

export const AcceptWorkspaceInvitationSchema = z.object({
  token: z.string().min(20).max(1_000),
  acceptPolicies: z.literal(true),
});

export const UpdateWorkspaceMemberSchema = z.object({
  role: WorkspaceRoleSchema.exclude(["owner"]),
});

export const WorkspaceSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  segment: z.enum(["education", "workplace"]),
  role: WorkspaceRoleSchema,
  homeRegion: z.string(),
});
export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;

export const WorkspaceMemberSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  role: WorkspaceRoleSchema,
  joinedAt: z.string().datetime().nullable(),
});
export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;

export const WorkspaceInvitationSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: WorkspaceRoleSchema.exclude(["owner"]),
  invitedBy: z.string().uuid(),
  expiresAt: z.string().datetime(),
  acceptedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type WorkspaceInvitation = z.infer<typeof WorkspaceInvitationSchema>;

export const QnaDisplayModeSchema = z.enum(["anonymous_public", "alias_public"]);
export const QnaModerationModeSchema = z.enum(["pre", "post"]);
export const QnaQuestionStatusSchema = z.enum([
  "pending",
  "published",
  "answered",
  "dismissed",
  "removed",
]);
export const QnaReplyStatusSchema = z.enum(["pending", "published", "removed"]);

export const QnaSettingsSchema = z.object({
  enabled: z.boolean(),
  displayMode: QnaDisplayModeSchema,
  moderationMode: QnaModerationModeSchema,
  participantReplies: z.boolean(),
});
export type QnaSettings = z.infer<typeof QnaSettingsSchema>;

export const UpdateQnaSettingsSchema = QnaSettingsSchema.partial().refine(
  (update) => Object.keys(update).length > 0,
  "Provide at least one Q&A setting",
);

export const CreateQnaQuestionSchema = z.object({
  body: z.string().trim().min(1).max(1_000),
});

export const CreateQnaReplySchema = z.object({
  body: z.string().trim().min(1).max(1_000),
});

export const ModerateQnaQuestionSchema = z.object({
  status: QnaQuestionStatusSchema,
  label: z.string().trim().max(80).nullable().optional(),
  banParticipant: z.boolean().default(false),
});

export const ModerateQnaReplySchema = z.object({
  status: QnaReplyStatusSchema,
});

export const QnaReplySchema = z.object({
  id: z.string().uuid(),
  questionId: z.string().uuid(),
  body: z.string(),
  status: QnaReplyStatusSchema,
  author: z.object({
    displayName: z.string(),
    kind: z.enum(["participant", "staff"]),
    mine: z.boolean(),
  }),
  createdAt: z.string().datetime(),
});
export type QnaReply = z.infer<typeof QnaReplySchema>;

export const QnaQuestionSchema = z.object({
  id: z.string().uuid(),
  body: z.string(),
  status: QnaQuestionStatusSchema,
  label: z.string().nullable(),
  author: z.object({
    displayName: z.string(),
    mine: z.boolean(),
  }),
  voteCount: z.number().int().nonnegative(),
  votedByMe: z.boolean(),
  replies: z.array(QnaReplySchema),
  createdAt: z.string().datetime(),
  moderationParticipantId: z.string().uuid().optional(),
});
export type QnaQuestion = z.infer<typeof QnaQuestionSchema>;

export const QnaPageSchema = z.object({
  questions: z.array(QnaQuestionSchema),
  nextCursor: z.string().nullable(),
  settings: QnaSettingsSchema,
});
export type QnaPage = z.infer<typeof QnaPageSchema>;

export const AnswerSubmitSchema = z
  .object({
    sessionId: z.string().uuid(),
    roundId: z.string().uuid(),
    choiceId: z.string().uuid().optional(),
    response: ResponsePayloadSchema.optional(),
    confidence: ConfidenceValueSchema.optional(),
    participantToken: z.string().min(20),
    idempotencyKey: z.string().min(8).max(160),
  })
  .superRefine((answer, context) => {
    if (Boolean(answer.choiceId) === Boolean(answer.response)) {
      context.addIssue({
        code: "custom",
        message: "Provide either the legacy choiceId or a response payload",
        path: ["response"],
      });
    }
  });
export type AnswerSubmit = z.infer<typeof AnswerSubmitSchema>;

export function responseForAnswer(answer: AnswerSubmit): ResponsePayload {
  return canonicalizeResponse(answer.response ?? { kind: "choice", choiceIds: [answer.choiceId!] });
}

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
  "intervention.start",
  "intervention.finish",
  "recheck.open",
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
    interventionType: InterventionTypeSchema.optional(),
    recheckMode: z.enum(["linked", "revote"]).optional(),
    recheckQuestionId: z.string().uuid().optional(),
  })
  .superRefine((command, context) => {
    if (command.action === "kick" && !command.participantId) {
      context.addIssue({
        code: "custom",
        message: "participantId is required when kicking a participant",
        path: ["participantId"],
      });
    }
    if (command.action === "intervention.start" && !command.interventionType) {
      context.addIssue({
        code: "custom",
        message: "interventionType is required when starting an intervention",
        path: ["interventionType"],
      });
    }
    if (command.action === "recheck.open" && !command.recheckMode) {
      context.addIssue({
        code: "custom",
        message: "recheckMode is required when opening a recheck",
        path: ["recheckMode"],
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

export const CreateQuizSchema = z.object({
  title: z.string().trim().min(1, "Enter a checkpoint set title").max(160),
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
  returnTo: z
    .string()
    .max(500)
    .refine(
      (value) => value.startsWith("/") && !value.startsWith("//") && !/[\\\r\n]/.test(value),
      "Return path must be a local application path",
    )
    .optional(),
});

const ReportMetricsSchema = z.object({
  participantCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  answerCount: z.number().int().nonnegative(),
  accuracyPercent: z.number().min(0).max(100),
});

const ReportQuestionSchema = z.object({
  questionId: z.string().uuid(),
  prompt: z.string(),
  responses: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  accuracyPercent: z.number().min(0).max(100),
  difficult: z.boolean(),
});

const ReportParticipantSchema = z.object({
  participantId: z.string().uuid(),
  nickname: z.string(),
  score: z.number().int(),
  correctCount: z.number().int().nonnegative(),
  answerCount: z.number().int().nonnegative(),
});

const ReportBaseShape = {
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  status: z.enum(["pending", "ready", "failed"]),
  generatedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime(),
  metrics: ReportMetricsSchema,
  questions: z.array(ReportQuestionSchema),
  participants: z.array(ReportParticipantSchema),
};

export const LegacyReportSchema = z.object({
  ...ReportBaseShape,
  schemaVersion: z.literal(1).optional(),
});

export const ReportV2Schema = z.object({
  ...ReportBaseShape,
  schemaVersion: z.literal(2),
  initialAccuracy: z.object({
    correct: z.number().int().nonnegative(),
    responses: z.number().int().nonnegative(),
    percent: z.number().min(0).max(100),
  }),
  confidenceMatrix: z.array(
    z.object({
      confidence: ConfidenceValueSchema,
      correct: z.number().int().nonnegative(),
      incorrect: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    }),
  ),
  misconceptions: z.array(
    z.object({
      questionId: z.string().uuid(),
      key: z.string(),
      responses: z.number().int().positive(),
      allResponsePercent: z.number().min(0).max(100),
      wrongResponsePercent: z.number().min(0).max(100),
    }),
  ),
  interventions: z.array(
    z.object({
      id: z.string().uuid(),
      type: InterventionTypeSchema,
      sourceRoundId: z.string().uuid(),
      linkedRecheckRoundId: z.string().uuid().nullable(),
      startedAt: z.string().datetime(),
      finishedAt: z.string().datetime().nullable(),
    }),
  ),
  recovery: z.array(
    z.object({
      sourceQuestionId: z.string().uuid(),
      recheckQuestionId: z.string().uuid(),
      sourceRoundId: z.string().uuid(),
      recheckRoundId: z.string().uuid(),
      evidenceType: z.enum(["linked_recheck", "revote"]),
      recovered: z.number().int().nonnegative(),
      initiallyIncorrectWithBoth: z.number().int().nonnegative(),
      recoveryPercent: z.number().min(0).max(100).nullable(),
      smallSample: z.boolean(),
    }),
  ),
  unresolvedConcepts: z.array(
    z.object({
      conceptKey: z.string(),
      initiallyIncorrect: z.number().int().nonnegative(),
      recovered: z.number().int().nonnegative(),
      unresolved: z.number().int().nonnegative(),
    }),
  ),
  participation: z.object({
    participants: z.number().int().nonnegative(),
    respondents: z.number().int().nonnegative(),
    percent: z.number().min(0).max(100),
  }),
  responseTime: z.object({
    responses: z.number().int().nonnegative(),
    medianMs: z.number().int().nonnegative().nullable(),
    p95Ms: z.number().int().nonnegative().nullable(),
  }),
  qna: z.object({
    questions: z.number().int().nonnegative(),
    answered: z.number().int().nonnegative(),
    unresolved: z.number().int().nonnegative(),
  }),
  participantFeedback: z.array(
    z.object({
      participantId: z.string().uuid(),
      correct: z.number().int().nonnegative(),
      responses: z.number().int().nonnegative(),
      unresolvedConcepts: z.array(z.string()),
    }),
  ),
  evidenceNote: z.string(),
});

export const ReportSchema = z.union([ReportV2Schema, LegacyReportSchema]);
export type Report = z.infer<typeof ReportSchema>;
export type ReportV2 = z.infer<typeof ReportV2Schema>;

export const FollowupTimeModeSchema = z.enum(["timed", "flex"]);
export type FollowupTimeMode = z.infer<typeof FollowupTimeModeSchema>;

export const CreateFollowupSchema = z
  .object({
    conceptKeys: z.array(ConceptKeySchema).min(1).max(12),
    title: z.string().trim().min(1).max(160).optional(),
    timeMode: FollowupTimeModeSchema.default("flex"),
    opensAt: z.string().datetime().optional(),
    closesAt: z.string().datetime(),
  })
  .superRefine((input, context) => {
    if (input.opensAt && new Date(input.opensAt) >= new Date(input.closesAt)) {
      context.addIssue({
        code: "custom",
        path: ["closesAt"],
        message: "The follow-up close time must be after its open time",
      });
    }
  });
export type CreateFollowup = z.infer<typeof CreateFollowupSchema>;

export const FollowupSchema = z.object({
  id: z.string().uuid(),
  sourceSessionId: z.string().uuid(),
  sourceReportId: z.string().uuid(),
  title: z.string(),
  conceptKeys: z.array(ConceptKeySchema),
  checkpointCount: z.number().int().positive(),
  timeMode: FollowupTimeModeSchema,
  opensAt: z.string().datetime(),
  closesAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type Followup = z.infer<typeof FollowupSchema>;

export const FollowupAccessKindSchema = z.enum(["personal", "accommodation"]);
export const TimeMultiplierSchema = z.union([z.literal(1), z.literal(1.5), z.literal(2)]);
export type TimeMultiplier = z.infer<typeof TimeMultiplierSchema>;

export const FollowupAccessLinkSchema = z.object({
  id: z.string().uuid(),
  kind: FollowupAccessKindSchema,
  participantId: z.string().uuid().nullable(),
  nickname: z.string().nullable(),
  label: z.string(),
  timeMultiplier: TimeMultiplierSchema,
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
  token: z.string().min(20).optional(),
});
export type FollowupAccessLink = z.infer<typeof FollowupAccessLinkSchema>;

export const CreateAccommodationPassSchema = z.object({
  label: z.string().trim().min(1).max(80),
  timeMultiplier: z.union([z.literal(1.5), z.literal(2)]),
});

export const StartFollowupSchema = z.object({
  attemptToken: z.string().min(32).max(1_000).optional(),
});

export const FollowupAnswerSubmitSchema = z.object({
  idempotencyKey: z.string().min(1).max(160),
  response: ResponsePayloadSchema,
  confidence: ConfidenceValueSchema.optional(),
});
export type FollowupAnswerSubmit = z.infer<typeof FollowupAnswerSubmitSchema>;

export const FollowupSnapshotSchema = z.object({
  mode: z.literal("followup"),
  followupId: z.string().uuid(),
  attemptId: z.string().uuid(),
  version: z.number().int().nonnegative(),
  title: z.string(),
  status: z.enum(["in_progress", "completed"]),
  phase: z.enum(["question_open", "answer_reveal", "completed"]),
  questionIndex: z.number().int().nonnegative().nullable(),
  questionCount: z.number().int().positive(),
  question: PublicQuestionSchema.nullable(),
  deadline: z.string().datetime().nullable(),
  timeMode: FollowupTimeModeSchema,
  timeMultiplier: TimeMultiplierSchema,
  response: ResponsePayloadSchema.nullable(),
  confidence: ConfidenceValueSchema.nullable(),
  correct: z.boolean().nullable(),
  correctResponse: ResponsePayloadSchema.nullable(),
  explanation: z.string().nullable(),
  feedback: z.string().nullable(),
  completedAt: z.string().datetime().nullable(),
});
export type FollowupSnapshot = z.infer<typeof FollowupSnapshotSchema>;

export const AuthoringSourceTypeSchema = z.enum(["pasted_text", "pdf", "docx", "pptx"]);
export type AuthoringSourceType = z.infer<typeof AuthoringSourceTypeSchema>;

const PastedAuthoringSourceSchema = z.object({
  sourceType: z.literal("pasted_text"),
  sourceName: z.string().trim().min(1).max(200).default("Pasted source"),
  text: z.string().trim().min(50).max(100_000),
});

const FileAuthoringSourceSchema = z.object({
  sourceType: z.enum(["pdf", "docx", "pptx"]),
  sourceName: z.string().trim().min(1).max(200),
  mimeType: z.enum([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ]),
  encoding: z.literal("base64"),
  data: z.string().min(4).max(8_000_000),
});

export const CreateAuthoringJobSchema = z
  .discriminatedUnion("sourceType", [PastedAuthoringSourceSchema, FileAuthoringSourceSchema])
  .superRefine((input, context) => {
    if (input.sourceType === "pasted_text") return;
    const expected = {
      pdf: "application/pdf",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }[input.sourceType];
    if (input.mimeType !== expected) {
      context.addIssue({
        code: "custom",
        path: ["mimeType"],
        message: `The MIME type does not match the ${input.sourceType.toUpperCase()} source type`,
      });
    }
  });
export type CreateAuthoringJob = z.infer<typeof CreateAuthoringJobSchema>;

export const AuthoringCitationSchema = z.object({
  checkpointId: z.string().uuid(),
  locator: z.string().min(1).max(120),
  excerpt: z.string().min(1).max(500),
});

export const AuthoringDraftSchema = z.object({
  schemaVersion: z.literal(1),
  sourceName: z.string(),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  checkpointSet: QuizContentSchema,
  citations: z.array(AuthoringCitationSchema).min(2).max(20),
  generatedAt: z.string().datetime(),
  provider: z.string(),
  model: z.string(),
});
export type AuthoringDraft = z.infer<typeof AuthoringDraftSchema>;

export const AuthoringJobSchema = z.object({
  id: z.string().uuid(),
  sourceType: AuthoringSourceTypeSchema,
  sourceName: z.string(),
  status: z.enum(["pending", "processing", "ready", "failed"]),
  attempts: z.number().int().nonnegative(),
  appliedQuizId: z.string().uuid().nullable(),
  output: AuthoringDraftSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AuthoringJob = z.infer<typeof AuthoringJobSchema>;

export const ApplyAuthoringJobSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
});

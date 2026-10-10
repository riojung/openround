import { z } from "zod";

/** Additive audience protocol; it does not replace the Round game or audience envelopes. */
export const AudienceScopeKindSchema = z.enum(["round", "presentation", "feedback_room"]);
export type AudienceScopeKind = z.infer<typeof AudienceScopeKindSchema>;

export const AudienceRoleSchema = z.enum([
  "participant",
  "host",
  "cohost",
  "presenter",
  "companion",
]);
export type AudienceRole = z.infer<typeof AudienceRoleSchema>;

export const AudienceIdentityPolicySchema = z.enum([
  "facilitator_visible_alias",
  "organizer_blind",
  "named_feedback",
]);
export type AudienceIdentityPolicy = z.infer<typeof AudienceIdentityPolicySchema>;

export const AudienceScopeSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    scopeId: z.string().uuid(),
    kind: AudienceScopeKindSchema,
    lifecycle: z.enum(["open", "closed"]),
    identityPolicy: AudienceIdentityPolicySchema,
    identityDisclosure: z.string().min(1).max(500),
    audienceSeq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    permissions: z
      .object({
        read: z.boolean(),
        submit: z.boolean(),
        moderate: z.boolean(),
        manageSettings: z.boolean(),
      })
      .strict(),
    features: z.object({ qna: z.boolean(), chat: z.boolean(), pulse: z.boolean() }).strict(),
  })
  .strict()
  .superRefine((scope, context) => {
    if (scope.kind !== "feedback_room" && scope.identityPolicy !== "facilitator_visible_alias") {
      context.addIssue({
        code: "custom",
        message: "Learning scopes retain facilitator-visible aliases",
      });
    }
    if (scope.kind === "feedback_room" && (scope.features.chat || scope.features.pulse)) {
      context.addIssue({ code: "custom", message: "Feedback rooms do not support chat or Pulse" });
    }
    if (scope.kind === "feedback_room" && scope.identityPolicy === "facilitator_visible_alias") {
      context.addIssue({
        code: "custom",
        message: "Feedback rooms require a dedicated feedback identity policy",
      });
    }
    if (scope.lifecycle === "closed" && scope.permissions.submit) {
      context.addIssue({ code: "custom", message: "Closed scopes cannot accept submissions" });
    }
  });
export type AudienceScopeSnapshot = z.infer<typeof AudienceScopeSnapshotSchema>;

/** This foundation only activates Presentations. Feedback room writers arrive separately. */
export const ActivatePresentationAudienceScopeSchema = z
  .object({
    kind: z.literal("presentation"),
    sessionId: z.string().uuid(),
    idempotencyKey: z.string().uuid(),
  })
  .strict();

export const ScopedAudienceEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    eventId: z.string().uuid(),
    scopeId: z.string().uuid(),
    audienceSeq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    serverTime: z.string().datetime(),
    type: z.literal("audience.scope.activated"),
    payload: z.object({ kind: z.literal("presentation") }).strict(),
  })
  .strict();
export type ScopedAudienceEvent = z.infer<typeof ScopedAudienceEventSchema>;

export const ScopedAudienceSubscribeSchema = z
  .object({
    scopeId: z.string().uuid(),
    kind: z.enum(["round", "presentation"]),
    token: z.string().min(1).max(2_000),
  })
  .strict();
export const ScopedAudienceSyncRequestSchema = ScopedAudienceSubscribeSchema.extend({
  limit: z.number().int().min(1).max(50).default(50),
});

/** Credential capabilities are not gameplay controls. Companion is deliberately read-only here. */
export function audienceRolePermissions(role: AudienceRole, open: boolean) {
  const moderator = role === "host" || role === "cohost";
  return {
    read: true,
    submit: open && (role === "participant" || moderator),
    moderate: open && moderator,
    manageSettings: open && moderator,
  };
}

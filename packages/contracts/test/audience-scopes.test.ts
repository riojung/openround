import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ActivatePresentationAudienceScopeSchema,
  AudienceScopeSnapshotSchema,
  ScopedAudienceEventSchema,
  ScopedAudienceSyncRequestSchema,
  audienceRolePermissions,
} from "../src/index.js";

function snapshot() {
  return {
    schemaVersion: 1,
    scopeId: randomUUID(),
    kind: "round",
    lifecycle: "open",
    identityPolicy: "facilitator_visible_alias",
    identityDisclosure: "Moderators can see your session alias",
    audienceSeq: 0,
    permissions: audienceRolePermissions("participant", true),
    features: { qna: true, chat: true, pulse: true },
  };
}

describe("additive audience-scope contracts", () => {
  it("never grants moderation to presenter, Companion, or participant credentials", () => {
    for (const role of ["presenter", "companion", "participant"] as const) {
      expect(audienceRolePermissions(role, true)).toMatchObject({
        read: true,
        moderate: false,
        manageSettings: false,
      });
    }
    for (const role of ["presenter", "companion"] as const)
      expect(audienceRolePermissions(role, true).submit).toBe(false);
    for (const role of ["host", "cohost"] as const) {
      expect(audienceRolePermissions(role, true)).toMatchObject({
        moderate: true,
        manageSettings: true,
      });
      expect(audienceRolePermissions(role, false)).toMatchObject({
        submit: false,
        moderate: false,
        manageSettings: false,
      });
    }
  });

  it("rejects learning anonymity claims, future schemas, identity fields, and invalid sequences", () => {
    expect(AudienceScopeSnapshotSchema.safeParse(snapshot()).success).toBe(true);
    for (const mutation of [
      { identityPolicy: "organizer_blind" },
      { schemaVersion: 2 },
      { participantId: randomUUID() },
      { token: "secret" },
      { audienceSeq: Number.MAX_SAFE_INTEGER + 1 },
      { lifecycle: "closed" },
    ])
      expect(AudienceScopeSnapshotSchema.safeParse({ ...snapshot(), ...mutation }).success).toBe(
        false,
      );
  });

  it("reserves feedback scopes without enabling unsupported chat, Pulse, or activation", () => {
    const feedback = {
      ...snapshot(),
      kind: "feedback_room",
      identityPolicy: "organizer_blind",
      features: { qna: true, chat: false, pulse: false },
    };
    expect(AudienceScopeSnapshotSchema.safeParse(feedback).success).toBe(true);
    expect(
      AudienceScopeSnapshotSchema.safeParse({
        ...feedback,
        features: { qna: true, chat: true, pulse: false },
      }).success,
    ).toBe(false);
    expect(
      ActivatePresentationAudienceScopeSchema.safeParse({
        kind: "feedback_room",
        sessionId: randomUUID(),
        idempotencyKey: randomUUID(),
      }).success,
    ).toBe(false);
  });

  it("bounds resynchronization and validates the only currently writable scoped event", () => {
    const request = { kind: "round", scopeId: randomUUID(), token: "bearer" };
    expect(ScopedAudienceSyncRequestSchema.parse(request).limit).toBe(50);
    expect(ScopedAudienceSyncRequestSchema.safeParse({ ...request, limit: 51 }).success).toBe(
      false,
    );
    const event = {
      schemaVersion: 1,
      eventId: randomUUID(),
      scopeId: randomUUID(),
      audienceSeq: 1,
      serverTime: new Date().toISOString(),
      type: "audience.scope.activated",
      payload: { kind: "presentation" },
    };
    expect(ScopedAudienceEventSchema.safeParse(event).success).toBe(true);
    expect(
      ScopedAudienceEventSchema.safeParse({
        ...event,
        payload: { kind: "presentation", nickname: "private alias" },
      }).success,
    ).toBe(false);
    expect(
      ScopedAudienceEventSchema.safeParse({ ...event, type: "chat.message.created" }).success,
    ).toBe(false);
  });
});

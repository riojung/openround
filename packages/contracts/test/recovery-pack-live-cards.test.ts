import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  HostCommandSchema,
  InterventionStateSchema,
  RecoveryPackCardReferenceSchema,
  RecoveryPackCardSelectionSchema,
  RecoveryPackLiveCardSchema,
  ReportV2Schema,
  ReportV3Schema,
  ReportV4Schema,
  SessionDecisionEventSchema,
} from "../src/index.js";

function reference() {
  return {
    insertionId: randomUUID(),
    packId: randomUUID(),
    packVersionId: randomUUID(),
    packVersion: 2,
    contentHash: "a".repeat(64),
    cardId: randomUUID(),
  };
}

function command() {
  const card = reference();
  return {
    sessionId: randomUUID(),
    hostToken: "a-host-token-long-enough",
    commandId: randomUUID(),
    expectedVersion: 3,
    action: "intervention.start" as const,
    interventionType: "explain" as const,
    recoveryPackCard: { insertionId: card.insertionId, cardId: card.cardId },
  };
}

describe("live Recovery Pack card contracts", () => {
  it("keeps selection and immutable references strict and bounded", () => {
    const card = reference();
    expect(RecoveryPackCardReferenceSchema.parse(card)).toEqual(card);
    expect(RecoveryPackCardSelectionSchema.parse(command().recoveryPackCard)).toHaveProperty(
      "cardId",
    );
    for (const invalid of [
      { ...card, packVersion: 0 },
      { ...card, contentHash: "not-a-hash" },
      { ...card, body: "Untrusted payload" },
    ])
      expect(RecoveryPackCardReferenceSchema.safeParse(invalid).success).toBe(false);
    expect(
      RecoveryPackCardSelectionSchema.safeParse({
        ...command().recoveryPackCard,
        title: "Injected",
      }).success,
    ).toBe(false);
  });

  it("allows a selection only for an explanation or example start", () => {
    const input = command();
    expect(HostCommandSchema.parse(input).recoveryPackCard).toEqual(input.recoveryPackCard);
    expect(HostCommandSchema.safeParse({ ...input, interventionType: "example" }).success).toBe(
      true,
    );
    for (const action of [
      "start",
      "lock",
      "reveal",
      "next",
      "end",
      "intervention.finish",
      "recheck.open",
    ]) {
      expect(HostCommandSchema.safeParse({ ...input, action, recheckMode: "linked" }).success).toBe(
        false,
      );
    }
    for (const interventionType of [undefined, "break", "peer_discussion"]) {
      expect(HostCommandSchema.safeParse({ ...input, interventionType }).success).toBe(false);
    }
    const legacy = { ...input, recoveryPackCard: undefined };
    expect(HostCommandSchema.safeParse(legacy).success).toBe(true);
  });

  it("exposes only a bounded cited card, not source questions or arbitrary fields", () => {
    const card = {
      reference: reference(),
      title: "Worked example",
      body: "Describe a concrete physical isolation scenario.",
      citations: [
        {
          sourceName: "Handbook",
          sourceDigest: "b".repeat(64),
          locator: "Page 2",
          excerpt: "Physical isolation.",
        },
      ],
    };
    expect(RecoveryPackLiveCardSchema.parse(card)).toEqual(card);
    for (const invalid of [
      { ...card, title: "" },
      { ...card, body: "x".repeat(2_001) },
      { ...card, citations: Array.from({ length: 6 }, () => card.citations[0]) },
      { ...card, diagnostic: { explanation: "Hidden" } },
    ])
      expect(RecoveryPackLiveCardSchema.safeParse(invalid).success).toBe(false);
  });

  it("retains optional references in intervention snapshots, report versions, and strict decision events", () => {
    const recoveryPackCard = reference();
    const intervention = {
      id: randomUUID(),
      type: "example" as const,
      sourceRoundId: randomUUID(),
      linkedRecheckRoundId: null,
      startedAt: "2026-10-05T12:00:00.000Z",
      finishedAt: null,
    };
    expect(
      InterventionStateSchema.parse({ ...intervention, recoveryPackCard }).recoveryPackCard,
    ).toEqual(recoveryPackCard);
    expect(InterventionStateSchema.parse(intervention)).not.toHaveProperty("recoveryPackCard");
    for (const schema of [ReportV2Schema, ReportV3Schema, ReportV4Schema]) {
      expect(
        schema.shape.interventions.parse([{ ...intervention, recoveryPackCard }])[0]
          ?.recoveryPackCard,
      ).toEqual(recoveryPackCard);
      expect(schema.shape.interventions.parse([intervention])[0]).not.toHaveProperty(
        "recoveryPackCard",
      );
    }
    for (const type of ["intervention_started", "intervention_finished"]) {
      const event = {
        type,
        seq: 1,
        occurredAt: intervention.startedAt,
        roundId: intervention.sourceRoundId,
        interventionType: "example",
      };
      expect(SessionDecisionEventSchema.parse({ ...event, recoveryPackCard })).toHaveProperty(
        "recoveryPackCard",
        recoveryPackCard,
      );
      expect(SessionDecisionEventSchema.parse(event)).not.toHaveProperty("recoveryPackCard");
      expect(
        SessionDecisionEventSchema.safeParse({
          ...event,
          recoveryPackCard: { ...recoveryPackCard, body: "Hidden" },
        }).success,
      ).toBe(false);
    }
  });
});

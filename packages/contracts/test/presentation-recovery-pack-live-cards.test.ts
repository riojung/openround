import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PresentationCommandSchema,
  PresentationCompanionSnapshotSchema,
  PresentationHostSnapshotSchema,
  PresentationParticipantSnapshotSchema,
  PresentationRecoveryPackInterventionSchema,
  PresentationReportEnvelopeSchema,
  PresentationReportSchema,
  PresentationReportV1Schema,
  PresentationReportV2Schema,
  PresentationReportWithSessionContextEnvelopeSchema,
  PresentationRestV1HostSnapshotSchema,
  PresentationRestV1ParticipantSnapshotSchema,
} from "../src/index.js";

const NOW = "2026-10-06T12:00:00.000Z";

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

function liveCard() {
  return {
    reference: reference(),
    title: "Warning is not isolation",
    body: "Compare a warning sign with a physical lockout device.",
    citations: [
      {
        sourceName: "Maintenance handbook",
        sourceDigest: "b".repeat(64),
        locator: "Section 2",
        excerpt: "Physically isolate hazardous energy before maintenance.",
      },
    ],
  };
}

function command() {
  const card = reference();
  return {
    sessionId: randomUUID(),
    controlToken: "h".repeat(32),
    commandId: randomUUID(),
    expectedRevision: 3,
    action: "start_recovery_card" as const,
    recoveryPackCard: { insertionId: card.insertionId, cardId: card.cardId },
    interventionType: "explain" as const,
  };
}

function snapshotBase() {
  return {
    sessionId: randomUUID(),
    artifactType: "presentation" as const,
    presentationId: randomUUID(),
    presentationVersionId: randomUUID(),
    title: "Live recovery check",
    code: "1234567",
    status: "active" as const,
    phase: "question_reveal" as const,
    currentBlockIndex: 0,
    blockCount: 1,
    revision: 3,
    seq: 7,
    serverTime: NOW,
    questionOpenedAt: NOW,
    questionClosesAt: null,
    acceptingResponses: false,
    settings: { timeMode: "timed" as const, trustMode: "learning" as const },
    currentBlock: null,
    finishedAt: null,
  };
}

function roomStatus(sessionId: string) {
  return {
    sessionId,
    joinedCount: 0,
    connectedCount: 0,
    notCurrentlyConnectedCount: 0,
    responseCount: 0,
    sampledAt: NOW,
  };
}

function hostSnapshot() {
  const base = snapshotBase();
  return {
    ...base,
    projection: "host" as const,
    participantCount: 0,
    responseCount: 0,
    participants: [],
    roomStatus: roomStatus(base.sessionId),
  };
}

function participantSnapshot() {
  return {
    ...snapshotBase(),
    projection: "participant" as const,
    participantId: randomUUID(),
    participantCount: 0,
    responseSubmitted: false,
    standing: null,
    responseResult: null,
  };
}

function companionSnapshot() {
  const base = snapshotBase();
  return {
    ...base,
    projection: "companion" as const,
    roomStatus: roomStatus(base.sessionId),
    primaryAction: "advance" as const,
  };
}

function restHostSnapshot() {
  const host = hostSnapshot();
  return {
    ...host,
    id: host.sessionId,
    eventSeq: host.seq,
    trustMode: host.settings.trustMode,
    leaderboard: host.participants,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function restParticipantSnapshot() {
  const participant = participantSnapshot();
  return {
    ...participant,
    id: participant.sessionId,
    eventSeq: participant.seq,
    trustMode: participant.settings.trustMode,
  };
}

const snapshotContracts = [
  { schema: PresentationHostSnapshotSchema, fixture: hostSnapshot },
  { schema: PresentationParticipantSnapshotSchema, fixture: participantSnapshot },
  { schema: PresentationCompanionSnapshotSchema, fixture: companionSnapshot },
  { schema: PresentationRestV1HostSnapshotSchema, fixture: restHostSnapshot },
  { schema: PresentationRestV1ParticipantSnapshotSchema, fixture: restParticipantSnapshot },
];

function reportFixture() {
  return {
    schemaVersion: 1 as const,
    sessionId: randomUUID(),
    artifactType: "presentation" as const,
    presentationId: randomUUID(),
    presentationVersionId: randomUUID(),
    title: "Recovery review",
    status: "finished" as const,
    trustMode: "learning" as const,
    participantCount: 0,
    responseCount: 0,
    leaderboard: [],
    evidence: [],
    recovery: [],
    timeline: [
      {
        sequence: 1,
        type: "intervention.presented" as const,
        blockIndex: 0,
        blockId: randomUUID(),
        occurredAt: NOW,
      },
    ],
    evidenceNote: "Interventions record facilitation rather than evidence of learning.",
    createdAt: NOW,
    finishedAt: NOW,
  };
}

function reportV2() {
  const report = reportFixture();
  return {
    ...report,
    schemaVersion: 2 as const,
    timeline: report.timeline.map((event) => ({
      ...event,
      recoveryPackIntervention: { type: "example" as const, reference: reference() },
    })),
  };
}

describe("Presentation live Recovery Pack card contracts", () => {
  it("requires a strict card selection and explanation or example command", () => {
    const input = command();
    for (const interventionType of ["explain", "example"] as const) {
      expect(PresentationCommandSchema.parse({ ...input, interventionType })).toEqual({
        ...input,
        interventionType,
      });
    }
    for (const invalid of [
      { ...input, recoveryPackCard: undefined },
      { ...input, interventionType: undefined },
      { ...input, interventionType: "break" },
      { ...input, interventionType: "peer_discussion" },
      { ...input, recoveryPackCard: { cardId: input.recoveryPackCard.cardId } },
      { ...input, recoveryPackCard: { insertionId: input.recoveryPackCard.insertionId } },
      { ...input, recoveryPackCard: { ...input.recoveryPackCard, title: "Injected" } },
      { ...input, recoveryPackCard: { ...input.recoveryPackCard, cardId: "invalid" } },
      { ...input, intervention: { type: "example" } },
      { ...input, recoveryPackIntervention: { type: "example", reference: reference() } },
    ]) {
      expect(PresentationCommandSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("preserves legacy advance commands and rejects attached intervention selectors", () => {
    const input = command();
    const advance = {
      sessionId: input.sessionId,
      controlToken: input.controlToken,
      commandId: input.commandId,
      expectedRevision: input.expectedRevision,
      action: "advance",
    };
    expect(PresentationCommandSchema.parse(advance)).toEqual(advance);
    for (const extra of [
      { recoveryPackCard: input.recoveryPackCard },
      { interventionType: "explain" },
      { recoveryPackIntervention: { type: "example", reference: reference() } },
      { intervention: { type: "example" } },
    ]) {
      expect(PresentationCommandSchema.safeParse({ ...advance, ...extra }).success).toBe(false);
    }
  });

  it("keeps durable intervention metadata strict and free of live card content", () => {
    const intervention = { type: "explain", reference: reference() };
    expect(PresentationRecoveryPackInterventionSchema.parse(intervention)).toEqual(intervention);
    for (const invalid of [
      { ...intervention, type: undefined },
      { ...intervention, reference: undefined },
      { ...intervention, type: "break" },
      { ...intervention, type: "peer_discussion" },
      { ...intervention, reference: { ...intervention.reference, packVersion: 0 } },
      { ...intervention, reference: { ...intervention.reference, body: "Injected" } },
      { ...intervention, card: liveCard() },
      { ...intervention, title: "Injected", body: "Injected", citations: [] },
    ]) {
      expect(PresentationRecoveryPackInterventionSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("parses legacy snapshots unchanged without adding Recovery Pack fields", () => {
    for (const { schema, fixture } of snapshotContracts) {
      const legacy = fixture();
      expect(schema.parse(legacy)).toEqual(legacy);
      expect(schema.parse(legacy)).not.toHaveProperty("recoveryPackCards");
      expect(schema.parse(legacy)).not.toHaveProperty("recoveryPackIntervention");
    }
  });

  it("permits at most five host previews only during question reveal", () => {
    const cards = Array.from({ length: 5 }, liveCard);
    for (const { schema, fixture } of [snapshotContracts[0]!, snapshotContracts[3]!]) {
      const host = fixture();
      expect(schema.parse({ ...host, recoveryPackCards: cards })).toHaveProperty(
        "recoveryPackCards",
        cards,
      );
      expect(schema.safeParse({ ...host, recoveryPackCards: [...cards, liveCard()] }).success).toBe(
        false,
      );
      for (const phase of ["lobby", "content", "question_open", "intervention", "finished"]) {
        expect(schema.safeParse({ ...host, phase, recoveryPackCards: cards }).success).toBe(false);
        expect(schema.safeParse({ ...host, phase, recoveryPackCards: [] }).success).toBe(false);
      }
    }
  });

  it("rejects preview leakage into participant and companion snapshots", () => {
    for (const { schema, fixture } of [
      snapshotContracts[1]!,
      snapshotContracts[2]!,
      snapshotContracts[4]!,
    ]) {
      for (const phase of ["question_reveal", "intervention"]) {
        expect(
          schema.safeParse({ ...fixture(), phase, recoveryPackCards: [liveCard()] }).success,
        ).toBe(false);
        expect(schema.safeParse({ ...fixture(), phase, recoveryPackCards: [] }).success).toBe(
          false,
        );
      }
    }
  });

  it("shares a selected cited card with every role only during intervention", () => {
    for (const { schema, fixture } of snapshotContracts) {
      for (const type of ["explain", "example"]) {
        const recoveryPackIntervention = { type, card: liveCard() };
        expect(
          schema.parse({ ...fixture(), phase: "intervention", recoveryPackIntervention }),
        ).toHaveProperty("recoveryPackIntervention", recoveryPackIntervention);
        for (const phase of ["lobby", "content", "question_open", "question_reveal", "finished"]) {
          expect(schema.safeParse({ ...fixture(), phase, recoveryPackIntervention }).success).toBe(
            false,
          );
        }
      }
    }
  });

  it("rejects incomplete active cards and arbitrary intervention payloads", () => {
    const card = liveCard();
    for (const { schema, fixture } of snapshotContracts) {
      for (const recoveryPackIntervention of [
        { card },
        { type: "explain" },
        { type: "break", card },
        { type: "example", card: { ...card, reference: undefined } },
        { type: "example", card: { ...card, body: "" } },
        { type: "example", card: { ...card, diagnostic: { explanation: "Hidden" } } },
        { type: "example", card, reference: card.reference },
      ]) {
        expect(
          schema.safeParse({ ...fixture(), phase: "intervention", recoveryPackIntervention })
            .success,
        ).toBe(false);
      }
    }
  });

  it("keeps V1 reports unchanged and accepts both report versions in envelopes", () => {
    const legacy = reportFixture();
    const attributed = reportV2();
    expect(PresentationReportV1Schema.parse(legacy)).toEqual(legacy);
    expect(PresentationReportV2Schema.safeParse(legacy).success).toBe(false);
    expect(PresentationReportV1Schema.safeParse(attributed).success).toBe(false);
    for (const report of [legacy, attributed]) {
      expect(PresentationReportSchema.parse(report)).toEqual(report);
      expect(PresentationReportEnvelopeSchema.parse({ reportStatus: "ready", report })).toEqual({
        reportStatus: "ready",
        report,
      });
      expect(
        PresentationReportWithSessionContextEnvelopeSchema.parse({
          reportStatus: "ready",
          report,
          sessionContext: { timeMode: "flex" },
        }),
      ).toEqual({ reportStatus: "ready", report, sessionContext: { timeMode: "flex" } });
    }
    expect(PresentationReportV1Schema.safeParse({ ...attributed, schemaVersion: 1 }).success).toBe(
      false,
    );
  });

  it("retains only immutable attribution in V2 intervention timeline events", () => {
    const report = reportV2();
    expect(PresentationReportV2Schema.parse(report)).toEqual(report);
    const unattributed = { ...reportFixture(), schemaVersion: 2 };
    expect(PresentationReportV2Schema.parse(unattributed)).toEqual(unattributed);
    const event = report.timeline[0]!;
    for (const recoveryPackIntervention of [
      { ...event.recoveryPackIntervention, title: "Injected" },
      { ...event.recoveryPackIntervention, body: "Raw card body" },
      { ...event.recoveryPackIntervention, citations: liveCard().citations },
      { ...event.recoveryPackIntervention, card: liveCard() },
      { ...event.recoveryPackIntervention, reference: { ...reference(), body: "Injected" } },
      { ...event.recoveryPackIntervention, reference: undefined },
      { ...event.recoveryPackIntervention, type: "peer_discussion" },
    ]) {
      expect(
        PresentationReportV2Schema.safeParse({
          ...report,
          timeline: [{ ...event, recoveryPackIntervention }],
        }).success,
      ).toBe(false);
    }
    expect(
      PresentationReportV2Schema.safeParse({
        ...report,
        timeline: [{ ...event, recoveryPackCard: liveCard() }],
      }).success,
    ).toBe(false);
  });

  it("rejects Recovery Pack attribution on every non-intervention timeline event", () => {
    const report = reportV2();
    const event = report.timeline[0]!;
    for (const type of [
      "presentation.started",
      "content.presented",
      "question.launched",
      "question.revealed",
      "presentation.finished",
    ]) {
      expect(
        PresentationReportV2Schema.safeParse({ ...report, timeline: [{ ...event, type }] }).success,
      ).toBe(false);
      const legacyEvent = { ...reportFixture().timeline[0]!, type };
      expect(
        PresentationReportV2Schema.safeParse({ ...report, timeline: [legacyEvent] }).success,
      ).toBe(true);
    }
  });
});

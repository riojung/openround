import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PresentationCommandSchema,
  PresentationCompanionCommandSchema,
  PresentationCompanionRecoveryPackCatalogSchema,
  PresentationCompanionSnapshotSchema,
  PresentationControlCommandSchema,
} from "../src/index";

function card() {
  return {
    reference: {
      insertionId: randomUUID(),
      packId: randomUUID(),
      packVersionId: randomUUID(),
      packVersion: 1,
      contentHash: "a".repeat(64),
      cardId: randomUUID(),
    },
    title: "Synthetic worked example",
  };
}

function snapshot() {
  const sessionId = randomUUID();
  return {
    sessionId,
    artifactType: "presentation",
    presentationId: randomUUID(),
    presentationVersionId: randomUUID(),
    title: "Synthetic companion Pack",
    code: "1234567",
    status: "active",
    phase: "question_reveal",
    currentBlockIndex: 0,
    blockCount: 2,
    revision: 2,
    seq: 2,
    serverTime: "2026-10-08T12:00:00.000Z",
    questionOpenedAt: "2026-10-08T12:00:00.000Z",
    questionClosesAt: "2026-10-08T12:00:01.000Z",
    acceptingResponses: false,
    settings: { timeMode: "flex", recoveryPackCardsEnabled: true },
    projection: "companion",
    currentBlock: {
      id: randomUUID(),
      kind: "question",
      question: {
        id: randomUUID(),
        type: "single_select",
        prompt: "Synthetic checkpoint",
        confidence: "off",
        choices: [
          { id: randomUUID(), label: "Option one" },
          { id: randomUUID(), label: "Option two" },
        ],
        timeLimitSeconds: 30,
        basePoints: 100,
        mediaId: null,
        mediaAlt: null,
      },
    },
    roomStatus: {
      sessionId,
      joinedCount: 0,
      connectedCount: 0,
      notCurrentlyConnectedCount: 0,
      responseCount: 0,
      sampledAt: "2026-10-08T12:00:00.000Z",
    },
    primaryAction: "advance",
    resultSummary: null,
    finishedAt: null,
  };
}

describe("Companion Recovery Pack contracts", () => {
  it("permits only scoped insertion and card commands alongside legacy advance", () => {
    const base = {
      sessionId: randomUUID(),
      companionToken: "c".repeat(32),
      commandId: randomUUID(),
      expectedRevision: 0,
    };
    const commands = [
      { ...base, action: "advance" },
      { ...base, action: "insert_recovery_pack", packVersionId: randomUUID() },
      {
        ...base,
        action: "start_recovery_card",
        recoveryPackCard: { insertionId: randomUUID(), cardId: randomUUID() },
        interventionType: "example",
      },
    ];
    for (const command of commands) {
      expect(PresentationCompanionCommandSchema.parse(command)).toEqual(command);
      expect(PresentationControlCommandSchema.parse(command)).toEqual(command);
      expect(PresentationCommandSchema.safeParse(command).success).toBe(false);
      for (const extra of [
        { controlToken: "h".repeat(32) },
        { settings: { timeMode: "flex" } },
        { participantId: randomUUID() },
        { content: {} },
      ]) {
        expect(PresentationControlCommandSchema.safeParse({ ...command, ...extra }).success).toBe(
          false,
        );
      }
    }
    expect(
      PresentationCompanionCommandSchema.safeParse({ ...base, action: "insert_recovery_pack" })
        .success,
    ).toBe(false);
    expect(
      PresentationCompanionCommandSchema.safeParse({
        ...commands[2],
        interventionType: "discuss",
      }).success,
    ).toBe(false);
  });

  it("keeps the bounded published catalog metadata-only with unique versions", () => {
    const pack = {
      packId: randomUUID(),
      packVersionId: randomUUID(),
      packVersion: 1,
      title: "Pack",
    };
    expect(PresentationCompanionRecoveryPackCatalogSchema.parse({ packs: [pack] }).packs).toEqual([
      pack,
    ]);
    for (const extra of [
      { content: {} },
      { diagnostic: {} },
      { interventions: [] },
      { citations: [] },
      { workspaceId: randomUUID() },
    ]) {
      expect(
        PresentationCompanionRecoveryPackCatalogSchema.safeParse({ packs: [{ ...pack, ...extra }] })
          .success,
      ).toBe(false);
    }
    expect(
      PresentationCompanionRecoveryPackCatalogSchema.safeParse({ packs: [pack, pack] }).success,
    ).toBe(false);
    expect(
      PresentationCompanionRecoveryPackCatalogSchema.safeParse({
        packs: Array.from({ length: 101 }, () => ({ ...pack, packVersionId: randomUUID() })),
      }).success,
    ).toBe(false);
  });

  it("delivers only title/reference card choices and only after reveal", () => {
    const base = snapshot();
    const choice = card();
    expect(
      PresentationCompanionSnapshotSchema.parse({ ...base, recoveryPackCards: [choice] })
        .recoveryPackCards,
    ).toEqual([choice]);
    for (const extra of [{ body: "Hidden content" }, { citations: [] }, { correct: true }]) {
      expect(
        PresentationCompanionSnapshotSchema.safeParse({
          ...base,
          recoveryPackCards: [{ ...choice, ...extra }],
        }).success,
      ).toBe(false);
    }
    for (const phase of ["lobby", "content", "question_open", "intervention", "finished"]) {
      expect(
        PresentationCompanionSnapshotSchema.safeParse({
          ...base,
          phase,
          recoveryPackCards: [choice],
        }).success,
      ).toBe(false);
    }
    for (const extra of [
      { acceptingResponses: true },
      { currentBlock: null },
      { settings: { timeMode: "flex", recoveryPackCardsEnabled: false } },
      { recoveryPackCards: [choice, choice] },
    ]) {
      expect(
        PresentationCompanionSnapshotSchema.safeParse({
          ...base,
          recoveryPackCards: [choice],
          ...extra,
        }).success,
      ).toBe(false);
    }
  });

  it("keeps legacy snapshots compatible and rejects insertion at unsafe transport phases", () => {
    const base = snapshot();
    expect(PresentationCompanionSnapshotSchema.parse(base).canInsertRecoveryPack).toBeUndefined();
    for (const phase of ["lobby", "content", "question_reveal"]) {
      expect(
        PresentationCompanionSnapshotSchema.safeParse({
          ...base,
          phase,
          canInsertRecoveryPack: true,
        }).success,
      ).toBe(true);
    }
    for (const extra of [
      { phase: "question_open" },
      { phase: "intervention" },
      { phase: "finished", status: "finished" },
      { acceptingResponses: true },
      { settings: { timeMode: "flex" } },
    ]) {
      expect(
        PresentationCompanionSnapshotSchema.safeParse({
          ...base,
          canInsertRecoveryPack: true,
          ...extra,
        }).success,
      ).toBe(false);
    }
  });
});

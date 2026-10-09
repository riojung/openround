import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PresentationCommandSchema,
  PresentationCompanionCommandSchema,
  PresentationCompanionSnapshotSchema,
  PresentationContentSchema,
  PresentationDraftSchema,
  PresentationQuickCheckInputSchema,
} from "../src/index";

function content() {
  const blockId = randomUUID();
  return {
    title: "Synthetic session content",
    description: "",
    schemaVersion: 2,
    liveQuickCheck: { commandId: randomUUID(), blockId },
    blocks: [
      {
        id: blockId,
        kind: "question",
        question: {
          id: randomUUID(),
          type: "poll",
          prompt: "Which synthetic option should we discuss?",
          purpose: "opinion",
          confidence: "off",
          delivery: "main",
          conceptKeys: [] as string[],
          linkedRecheckQuestionId: null,
          timeLimitSeconds: 30,
          basePoints: 0,
          explanation: "",
          mediaId: null,
          mediaAlt: null,
          choices: [
            { id: randomUUID(), label: "Option one", isCorrect: false },
            { id: randomUUID(), label: "Option two", isCorrect: false },
          ],
        },
      },
    ],
  };
}

describe("Presentation session-only Quick Check contracts", () => {
  const input = { prompt: "Synthetic prompt", choices: ["One", "Two"], timeLimitSeconds: 30 };

  it("normalizes bounded input without accepting correctness or extra authority", () => {
    expect(
      PresentationQuickCheckInputSchema.parse({
        ...input,
        prompt: " Prompt ",
        choices: [" A ", "B"],
      }),
    ).toEqual({ prompt: "Prompt", choices: ["A", "B"], timeLimitSeconds: 30 });
    for (const invalid of [
      { prompt: " " },
      { prompt: "x".repeat(501) },
      { choices: ["One"] },
      { choices: Array.from({ length: 7 }, (_, i) => `Option ${i}`) },
      { choices: ["One", " "] },
      { choices: ["One", "x".repeat(181)] },
      { choices: [" ONE ", "one"] },
      { choices: ["Option  one", "option one"] },
      { choices: ["Ａ", "a"] },
      { choices: [{ label: "One", isCorrect: true }, "Two"] },
      { timeLimitSeconds: 9 },
      { timeLimitSeconds: 301 },
      { timeLimitSeconds: 10.5 },
      { basePoints: 100 },
      { confidence: "required" },
      { mediaId: randomUUID() },
      { correctChoice: 0 },
    ]) {
      expect(PresentationQuickCheckInputSchema.safeParse({ ...input, ...invalid }).success).toBe(
        false,
      );
    }
    for (const timeLimitSeconds of [10, 300]) {
      expect(
        PresentationQuickCheckInputSchema.safeParse({ ...input, timeLimitSeconds }).success,
      ).toBe(true);
    }
  });

  it("adds a companion-only command without expanding host authority", () => {
    const command = {
      sessionId: randomUUID(),
      companionToken: "c".repeat(32),
      commandId: randomUUID(),
      expectedRevision: 0,
      action: "insert_quick_check",
      quickCheck: input,
    };
    expect(PresentationCompanionCommandSchema.parse(command)).toEqual(command);
    expect(PresentationCommandSchema.safeParse(command).success).toBe(false);
    for (const extra of [
      { controlToken: "h".repeat(32) },
      { content: {} },
      { participantId: randomUUID() },
    ]) {
      expect(PresentationCompanionCommandSchema.safeParse({ ...command, ...extra }).success).toBe(
        false,
      );
    }
  });

  it("retains a single valid live marker in content but not authoring drafts", () => {
    const frozen = content();
    expect(PresentationContentSchema.parse(frozen).liveQuickCheck).toEqual(frozen.liveQuickCheck);
    expect(PresentationDraftSchema.parse(frozen)).not.toHaveProperty("liveQuickCheck");
    const legacy = { ...frozen, liveQuickCheck: undefined };
    expect(PresentationContentSchema.parse(legacy).liveQuickCheck).toBeUndefined();
    expect(
      PresentationContentSchema.safeParse({
        ...frozen,
        liveQuickCheck: { ...frozen.liveQuickCheck, blockId: randomUUID() },
      }).success,
    ).toBe(false);
    expect(
      PresentationContentSchema.safeParse({
        ...frozen,
        liveQuickCheck: [frozen.liveQuickCheck, frozen.liveQuickCheck],
      }).success,
    ).toBe(false);
    expect(
      PresentationContentSchema.safeParse({
        ...frozen,
        liveQuickCheck: { ...frozen.liveQuickCheck, nickname: "Synthetic alias" },
      }).success,
    ).toBe(false);
    for (const question of [
      { confidence: "optional" },
      { purpose: "practice" },
      { basePoints: 100 },
      { delivery: "recheck" },
      { linkedRecheckQuestionId: randomUUID() },
      { conceptKeys: ["synthetic"] },
      { explanation: "Not an unscored prompt" },
      { mediaId: randomUUID(), mediaAlt: "Synthetic image" },
      {
        choices: frozen.blocks[0]!.question.choices.map((choice) => ({
          ...choice,
          feedback: "Feedback",
        })),
      },
      {
        choices: frozen.blocks[0]!.question.choices.map((choice) => ({
          ...choice,
          isCorrect: true,
        })),
      },
    ]) {
      expect(
        PresentationContentSchema.safeParse({
          ...frozen,
          blocks: [
            { ...frozen.blocks[0], question: { ...frozen.blocks[0]!.question, ...question } },
          ],
        }).success,
      ).toBe(false);
    }
  });

  it("keeps legacy companion snapshots valid and fences affirmative capability", () => {
    const sessionId = randomUUID();
    const snapshot = {
      sessionId,
      artifactType: "presentation",
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: "Synthetic session",
      code: "1234567",
      status: "active",
      phase: "lobby",
      currentBlockIndex: -1,
      blockCount: 1,
      revision: 0,
      seq: 0,
      serverTime: "2026-10-08T12:00:00.000Z",
      questionOpenedAt: null,
      questionClosesAt: null,
      acceptingResponses: false,
      settings: { timeMode: "timed" },
      projection: "companion",
      currentBlock: null,
      roomStatus: {
        sessionId,
        joinedCount: 0,
        connectedCount: 0,
        notCurrentlyConnectedCount: 0,
        responseCount: 0,
        sampledAt: "2026-10-08T12:00:00.000Z",
      },
      primaryAction: "advance",
      finishedAt: null,
    };
    expect(PresentationCompanionSnapshotSchema.parse(snapshot)).not.toHaveProperty(
      "canInsertQuickCheck",
    );
    expect(
      PresentationCompanionSnapshotSchema.parse({ ...snapshot, canInsertQuickCheck: true })
        .canInsertQuickCheck,
    ).toBe(true);
    for (const extra of [
      { acceptingResponses: true },
      { phase: "question_open" },
      { phase: "intervention" },
      { status: "finished", phase: "finished" },
    ]) {
      expect(
        PresentationCompanionSnapshotSchema.safeParse({
          ...snapshot,
          ...extra,
          canInsertQuickCheck: true,
        }).success,
      ).toBe(false);
    }
  });
});

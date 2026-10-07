import { randomInt, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MemoryRepository,
  createPresentationSessionRepository,
  type PresentationSessionCreateInput,
} from "../src/index.js";
import {
  expectPresentationRecoveryPackLiveCardsConformance,
  presentationRecoveryPackIntervention,
  presentationSessionConformanceContent,
} from "./support/presentation-session-conformance.js";

function sessionInput(workspaceId: string = randomUUID(), createdBy: string = randomUUID()) {
  const now = new Date();
  const content = presentationSessionConformanceContent();
  return {
    id: randomUUID(),
    workspaceId,
    presentationId: randomUUID(),
    presentationVersionId: randomUUID(),
    title: content.title,
    content,
    code: String(randomInt(1_000_000, 10_000_000)),
    status: "active",
    phase: "question_reveal",
    currentBlockIndex: 0,
    revision: 0,
    recoveryPackCardsEnabled: true,
    createdBy,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    liveExpiresAt: new Date(now.getTime() + 60_000),
    retentionExpiresAt: new Date(now.getTime() + 86_400_000),
  } satisfies PresentationSessionCreateInput;
}

describe("Presentation Recovery Pack intervention persistence", () => {
  it("keeps memory on the shared card and strict command receipt contract", async () => {
    const memory = new MemoryRepository();
    const workspaceId = randomUUID();
    await expectPresentationRecoveryPackLiveCardsConformance({
      repository: createPresentationSessionRepository(memory),
      workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      createdBy: randomUUID(),
      content: presentationSessionConformanceContent(),
      beginWorkspaceDeletion: async () => {
        await memory.claimWorkspaceMediaDeletion(workspaceId);
      },
    });
  });

  it("preserves legacy null-hash receipts and isolates new selectors from hashed advance receipts", async () => {
    const sessions = createPresentationSessionRepository(new MemoryRepository());
    const input = sessionInput();
    await sessions.createSession({ ...input, recoveryPackCardsEnabled: undefined });
    const advance = {
      workspaceId: input.workspaceId,
      sessionId: input.id,
      commandId: randomUUID(),
      expectedRevision: 0,
      phase: "question_open" as const,
      currentBlockIndex: 0,
      status: "active" as const,
      event: {
        type: "question.launched" as const,
        blockIndex: 0,
        blockId: input.content.blocks[0]!.id,
      },
    };
    await sessions.transitionSessionCommand(advance);
    await expect(
      sessions.findCommandReceipt(input.workspaceId, input.id, advance.commandId),
    ).resolves.toMatchObject({ requestHash: null });
    await expect(
      sessions.transitionSessionCommand({ ...advance, requestHash: "a".repeat(64) }),
    ).resolves.toMatchObject({ status: "duplicate", session: { revision: 1 } });
    const hashedAdvance = {
      ...advance,
      commandId: randomUUID(),
      expectedRevision: 1,
      requestHash: "b".repeat(64),
    };
    await sessions.transitionSessionCommand(hashedAdvance);
    await expect(
      sessions.transitionSessionCommand({
        ...hashedAdvance,
        requestHash: "c".repeat(64),
        phase: "intervention",
        recoveryPackIntervention: presentationRecoveryPackIntervention(),
        event: { ...advance.event, type: "intervention.presented" },
      }),
    ).resolves.toMatchObject({ status: "idempotency_conflict", session: { revision: 2 } });
  });

  it.each(["account deletion", "retention expiry"])(
    "exports attribution and cascades it on %s",
    async (cleanup) => {
      const memory = new MemoryRepository();
      const now = new Date();
      const tokenHash = randomUUID();
      await memory.createMagicToken({
        id: randomUUID(),
        email: `presentation-cards-${randomUUID()}@example.com`,
        segment: "education",
        tokenHash,
        policyVersion: "test-v1",
        expiresAt: new Date(now.getTime() + 60_000),
        consumedAt: null,
      });
      const owner = await memory.consumeMagicToken(tokenHash, now);
      if (!owner) throw new Error("Expected a memory account owner");
      const sessions = createPresentationSessionRepository(memory);
      const input = sessionInput(owner.workspaceId, owner.userId);
      await sessions.createSession(input);
      const intervention = presentationRecoveryPackIntervention();
      const commandId = randomUUID();
      await sessions.transitionSessionCommand({
        workspaceId: owner.workspaceId,
        sessionId: input.id,
        commandId,
        requestHash: "d".repeat(64),
        expectedRevision: 0,
        phase: "intervention",
        currentBlockIndex: 0,
        status: "active",
        recoveryPackIntervention: intervention,
        event: {
          type: "intervention.presented",
          blockIndex: 0,
          blockId: input.content.blocks[0]!.id,
        },
      });
      expect(createPresentationSessionRepository(memory)).toBe(sessions);
      const exported = await memory.exportAccount(owner.userId);
      expect(exported).toMatchObject({
        presentationSessions: [
          { id: input.id, recoveryPackCardsEnabled: true, recoveryPackIntervention: intervention },
        ],
        presentationSessionTimeline: [{ recoveryPackIntervention: intervention }],
        presentationSessionCommandReceipts: [{ commandId, requestHash: "d".repeat(64) }],
        presentationSessionResponses: [],
        presentationSessionParticipants: [],
      });
      if (cleanup === "account deletion") {
        await memory.deleteAccount(owner.userId);
      } else {
        await expect(memory.purgeExpired(input.retentionExpiresAt)).resolves.toContain(input.id);
      }
      await expect(sessions.getSessionById(input.id)).resolves.toBeNull();
      await expect(sessions.listTimeline(input.id)).resolves.toEqual([]);
      await expect(
        sessions.findCommandReceipt(owner.workspaceId, input.id, commandId),
      ).resolves.toBeNull();
    },
  );

  it("rejects hidden payloads and attribution on an ineligible session without partial writes", async () => {
    const sessions = createPresentationSessionRepository(new MemoryRepository());
    const input = sessionInput();
    await sessions.createSession({ ...input, recoveryPackCardsEnabled: false });
    const intervention = presentationRecoveryPackIntervention();
    const command = {
      workspaceId: input.workspaceId,
      sessionId: input.id,
      commandId: randomUUID(),
      expectedRevision: 0,
      requestHash: "e".repeat(64),
      phase: "intervention" as const,
      currentBlockIndex: 0,
      status: "active" as const,
      recoveryPackIntervention: intervention,
      event: {
        type: "intervention.presented" as const,
        blockIndex: 0,
        blockId: input.content.blocks[0]!.id,
      },
    };
    await expect(sessions.transitionSessionCommand(command)).rejects.toThrow("not enabled");
    await expect(
      sessions.transitionSessionCommand({
        ...command,
        requestHash: "not-canonical",
        recoveryPackIntervention: null,
      }),
    ).rejects.toThrow("canonical SHA-256");
    await expect(
      sessions.transitionSessionCommand({
        ...command,
        recoveryPackIntervention: {
          ...intervention,
          learnerResponse: "private",
        } as typeof intervention,
      }),
    ).rejects.toThrow();
    await expect(sessions.getSessionById(input.id)).resolves.toMatchObject({
      revision: 0,
      recoveryPackIntervention: null,
    });
    await expect(
      sessions.findCommandReceipt(input.workspaceId, input.id, command.commandId),
    ).resolves.toBeNull();
    await expect(sessions.listTimeline(input.id)).resolves.toEqual([]);
  });
});

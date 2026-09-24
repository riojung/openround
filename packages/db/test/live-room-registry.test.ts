import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PresentationContent, QuizDraft } from "@openround/contracts";
import { createGameState } from "@openround/game-engine";
import {
  MemoryRepository,
  SessionCodeConflictError,
  createPresentationSessionRepository,
  type PresentationSessionCreateInput,
  type StoredSession,
} from "../src/index.js";

const roundContent: QuizDraft = {
  title: "Registry Round",
  description: "",
  questions: [],
};

const presentationContent: PresentationContent = {
  title: "Registry Presentation",
  description: "",
  experiencePreset: { id: "focus", version: 1 },
  schemaVersion: 1,
  blocks: [],
};

function roundSession(code: string, now = new Date()): StoredSession {
  const id = randomUUID();
  return {
    id,
    workspaceId: randomUUID(),
    quizVersionId: randomUUID(),
    hostId: randomUUID(),
    hostTokenHash: randomUUID(),
    state: createGameState({
      sessionId: id,
      code,
      quiz: roundContent,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "friendly_only",
      },
    }),
    expiresAt: new Date(now.getTime() + 60_000),
    retentionExpiresAt: new Date(now.getTime() + 86_400_000),
    createdAt: now,
    updatedAt: now,
  };
}

function presentationSession(
  code: string,
  now = new Date(),
  overrides: Partial<PresentationSessionCreateInput> = {},
): PresentationSessionCreateInput {
  return {
    id: randomUUID(),
    workspaceId: randomUUID(),
    presentationId: randomUUID(),
    presentationVersionId: randomUUID(),
    title: presentationContent.title,
    content: presentationContent,
    code,
    status: "active",
    phase: "lobby",
    currentBlockIndex: -1,
    revision: 0,
    createdBy: randomUUID(),
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    liveExpiresAt: new Date(now.getTime() + 60_000),
    retentionExpiresAt: new Date(now.getTime() + 86_400_000),
    ...overrides,
  };
}

describe("memory live-room registry", () => {
  it("rejects Presentation-after-Round and Round-after-Presentation collisions", async () => {
    const firstRepository = new MemoryRepository();
    const firstPresentations = createPresentationSessionRepository(firstRepository);
    const firstRound = roundSession("1234567");
    await firstRepository.createSession(firstRound);

    await expect(
      firstPresentations.createSession(presentationSession(firstRound.state.code)),
    ).rejects.toBeInstanceOf(SessionCodeConflictError);
    await expect(firstRepository.getLiveRoomCode(firstRound.state.code)).resolves.toMatchObject({
      artifactType: "round",
      artifactId: firstRound.id,
    });

    const secondRepository = new MemoryRepository();
    const secondPresentations = createPresentationSessionRepository(secondRepository);
    const presentation = await secondPresentations.createSession(presentationSession("7654321"));

    await expect(
      secondRepository.createSession(roundSession(presentation.code)),
    ).rejects.toBeInstanceOf(SessionCodeConflictError);
    await expect(secondRepository.getLiveRoomCode(presentation.code)).resolves.toMatchObject({
      artifactType: "presentation",
      artifactId: presentation.id,
    });
  });

  it("releases finished, deleted, and expired claims for cross-artifact reuse", async () => {
    const repository = new MemoryRepository();
    const presentations = createPresentationSessionRepository(repository);
    const presentation = await presentations.createSession(presentationSession("2345678"));
    await presentations.transitionSession({
      workspaceId: presentation.workspaceId,
      sessionId: presentation.id,
      expectedRevision: presentation.revision,
      phase: "finished",
      currentBlockIndex: presentation.currentBlockIndex,
      status: "finished",
      event: {
        type: "presentation.finished",
        blockIndex: null,
        blockId: null,
      },
    });
    await expect(repository.getLiveRoomCode(presentation.code)).resolves.toBeNull();
    const replacementRound = roundSession(presentation.code);
    await expect(repository.createSession(replacementRound)).resolves.toBeUndefined();

    await repository.deleteSession(replacementRound.workspaceId, replacementRound.id);
    const replacementPresentation = await presentations.createSession(
      presentationSession(presentation.code),
    );
    await expect(repository.getLiveRoomCode(presentation.code)).resolves.toMatchObject({
      artifactType: "presentation",
      artifactId: replacementPresentation.id,
    });

    const expiredCode = "3456789";
    await presentations.createSession(
      presentationSession(expiredCode, new Date(Date.now() - 120_000), {
        liveExpiresAt: new Date(Date.now() - 60_000),
      }),
    );
    await expect(repository.getLiveRoomCode(expiredCode)).resolves.toBeNull();
    await expect(repository.createSession(roundSession(expiredCode))).resolves.toBeUndefined();
  });
});

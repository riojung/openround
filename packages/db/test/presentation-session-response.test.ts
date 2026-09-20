import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PresentationContent } from "@openround/contracts";
import {
  MemoryRepository,
  createPresentationSessionRepository,
  type PresentationSessionResponseRecord,
} from "../src/index.js";

function fixture() {
  const workspaceId = randomUUID();
  const sessionId = randomUUID();
  const participantId = randomUUID();
  const blockId = randomUUID();
  const questionId = randomUUID();
  const correctChoiceId = randomUUID();
  const now = new Date("2026-09-20T12:00:00.000Z");
  const content: PresentationContent = {
    title: "Atomic response check",
    description: "",
    experiencePreset: { id: "focus", version: 1 },
    schemaVersion: 1,
    blocks: [
      {
        id: blockId,
        kind: "question",
        question: {
          id: questionId,
          type: "single_select",
          prompt: "Which response is accepted?",
          choices: [
            { id: correctChoiceId, label: "The in-window response", isCorrect: true },
            { id: randomUUID(), label: "A response after reveal", isCorrect: false },
          ],
          purpose: "diagnostic",
          confidence: "off",
          delivery: "main",
          conceptKeys: [],
          linkedRecheckQuestionId: null,
          timeLimitSeconds: 20,
          basePoints: 1_000,
          explanation: "The session row is the authority.",
          mediaId: null,
          mediaAlt: null,
        },
      },
    ],
  };
  const response = (participant: string, submittedAt = new Date(now.getTime() + 1_000)) =>
    ({
      id: randomUUID(),
      workspaceId,
      sessionId,
      participantId: participant,
      blockId,
      questionId,
      response: { choiceIds: [correctChoiceId] },
      correct: true,
      score: 975,
      responseMs: 1_000,
      submittedAt,
    }) satisfies PresentationSessionResponseRecord;
  return { workspaceId, sessionId, participantId, blockId, now, content, response };
}

describe("presentation response acceptance", () => {
  it("enforces the participant limit inside the session mutation", async () => {
    const repository = createPresentationSessionRepository(new MemoryRepository());
    const setup = fixture();
    await repository.createSession({
      id: setup.sessionId,
      workspaceId: setup.workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: setup.content.title,
      content: setup.content,
      code: "5555555",
      status: "active",
      phase: "lobby",
      currentBlockIndex: -1,
      revision: 0,
      createdBy: randomUUID(),
      createdAt: setup.now,
      updatedAt: setup.now,
      finishedAt: null,
      liveExpiresAt: new Date(setup.now.getTime() + 86_400_000),
      retentionExpiresAt: new Date(setup.now.getTime() + 86_400_000),
    });
    const participant = (nickname: string) => ({
      id: randomUUID(),
      workspaceId: setup.workspaceId,
      sessionId: setup.sessionId,
      nickname,
      tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
      joinedAt: setup.now,
      lastSeenAt: setup.now,
    });
    const results = await Promise.all([
      repository.joinParticipantWithinLimit(participant("First"), 1),
      repository.joinParticipantWithinLimit(participant("Second"), 1),
    ]);
    expect(results.map(({ status }) => status).sort()).toEqual(["accepted", "full"]);
    expect(await repository.listParticipants(setup.sessionId)).toHaveLength(1);

    const reportExpiresAt = new Date(setup.now.getTime() + 30 * 86_400_000);
    const finished = await repository.transitionSession({
      workspaceId: setup.workspaceId,
      sessionId: setup.sessionId,
      expectedRevision: 0,
      phase: "finished",
      currentBlockIndex: -1,
      status: "finished",
      retentionExpiresAt: reportExpiresAt,
      event: { type: "presentation.finished", blockIndex: null, blockId: null },
    });
    expect(finished?.retentionExpiresAt).toEqual(reportExpiresAt);
    await expect(repository.joinParticipantWithinLimit(participant("Late"), 2)).resolves.toEqual({
      status: "closed",
    });
  });

  it("atomically rejects duplicates and stale phases", async () => {
    const repository = createPresentationSessionRepository(new MemoryRepository());
    const setup = fixture();
    await repository.createSession({
      id: setup.sessionId,
      workspaceId: setup.workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: setup.content.title,
      content: setup.content,
      code: "1234567",
      status: "active",
      phase: "question_open",
      currentBlockIndex: 0,
      revision: 3,
      createdBy: randomUUID(),
      createdAt: setup.now,
      updatedAt: setup.now,
      finishedAt: null,
      liveExpiresAt: new Date(setup.now.getTime() + 86_400_000),
      retentionExpiresAt: new Date(setup.now.getTime() + 86_400_000),
    });

    const first = await repository.acceptResponse(setup.response(setup.participantId), 3);
    expect(first.status).toBe("accepted");
    const duplicate = await repository.acceptResponse(setup.response(setup.participantId), 3);
    expect(duplicate.status).toBe("duplicate");

    await repository.transitionSession({
      workspaceId: setup.workspaceId,
      sessionId: setup.sessionId,
      expectedRevision: 3,
      phase: "question_reveal",
      currentBlockIndex: 0,
      status: "active",
      event: { type: "question.revealed", blockIndex: 0, blockId: setup.blockId },
    });
    const afterReveal = await repository.acceptResponse(setup.response(randomUUID()), 3);
    expect(afterReveal).toEqual({ status: "phase_closed" });
  });

  it("rejects an otherwise current response after the server deadline", async () => {
    const repository = createPresentationSessionRepository(new MemoryRepository());
    const setup = fixture();
    await repository.createSession({
      id: setup.sessionId,
      workspaceId: setup.workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: setup.content.title,
      content: setup.content,
      code: "7654321",
      status: "active",
      phase: "question_open",
      currentBlockIndex: 0,
      revision: 1,
      createdBy: randomUUID(),
      createdAt: setup.now,
      updatedAt: setup.now,
      finishedAt: null,
      liveExpiresAt: new Date(setup.now.getTime() + 86_400_000),
      retentionExpiresAt: new Date(setup.now.getTime() + 86_400_000),
    });
    const late = await repository.acceptResponse(
      setup.response(setup.participantId, new Date(setup.now.getTime() + 20_001)),
      1,
    );
    expect(late).toEqual({ status: "phase_closed" });
  });

  it("rejects joins and responses after the live expiry", async () => {
    const repository = createPresentationSessionRepository(new MemoryRepository());
    const setup = fixture();
    await repository.createSession({
      id: setup.sessionId,
      workspaceId: setup.workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: setup.content.title,
      content: setup.content,
      code: "7654322",
      status: "active",
      phase: "question_open",
      currentBlockIndex: 0,
      revision: 1,
      createdBy: randomUUID(),
      createdAt: setup.now,
      updatedAt: setup.now,
      finishedAt: null,
      liveExpiresAt: new Date(0),
      retentionExpiresAt: new Date(setup.now.getTime() + 86_400_000),
    });
    const participant = {
      id: randomUUID(),
      workspaceId: setup.workspaceId,
      sessionId: setup.sessionId,
      nickname: "Late",
      tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
      joinedAt: new Date(),
      lastSeenAt: new Date(),
    };
    await expect(repository.joinParticipantWithinLimit(participant, 20)).resolves.toEqual({
      status: "closed",
    });
    await expect(
      repository.acceptResponse(setup.response(setup.participantId), 1),
    ).resolves.toEqual({ status: "phase_closed" });
  });
});

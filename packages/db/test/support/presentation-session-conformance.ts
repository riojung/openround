import { createHash, randomInt, randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { PresentationContent } from "@openround/contracts";
import type {
  PresentationSessionRepository,
  PresentationSessionResponseRecord,
} from "../../src/index.js";

export function presentationSessionConformanceContent(): PresentationContent {
  return {
    title: "Presentation repository conformance",
    description: "Shared memory and PostgreSQL behavior",
    experiencePreset: { id: "focus", version: 1 },
    schemaVersion: 1,
    blocks: [
      {
        id: randomUUID(),
        kind: "question",
        question: {
          id: randomUUID(),
          type: "numeric",
          prompt: "How many accepted responses should one participant create per block?",
          correctValue: "1",
          tolerance: "0",
          unit: null,
          purpose: "diagnostic",
          confidence: "off",
          delivery: "main",
          conceptKeys: ["repository.conformance"],
          linkedRecheckQuestionId: null,
          timeLimitSeconds: 30,
          basePoints: 1_000,
          explanation: "Only the first valid response is accepted.",
          mediaId: null,
          mediaAlt: null,
        },
      },
    ],
  };
}

export async function expectPresentationSessionRepositoryConformance(input: {
  repository: PresentationSessionRepository;
  workspaceId: string;
  presentationId: string;
  presentationVersionId: string;
  createdBy: string;
  content: PresentationContent;
}) {
  const questionBlock = input.content.blocks.find((block) => block.kind === "question");
  if (!questionBlock || questionBlock.question.type !== "numeric") {
    throw new Error("Presentation repository conformance requires one numeric question");
  }

  const now = new Date();
  const sessionId = randomUUID();
  const participantId = randomUUID();
  const openCommandId = randomUUID();
  const responseIdempotencyKey = randomUUID();
  const responseRequestHash = "a".repeat(64);
  const session = await input.repository.createSession({
    id: sessionId,
    workspaceId: input.workspaceId,
    presentationId: input.presentationId,
    presentationVersionId: input.presentationVersionId,
    title: input.content.title,
    content: input.content,
    code: String(randomInt(1_000_000, 10_000_000)),
    status: "active",
    phase: "lobby",
    currentBlockIndex: -1,
    revision: 0,
    settings: { timeMode: "flex" },
    trustMode: "learning",
    eventSeq: 0,
    questionOpenedAt: null,
    questionClosesAt: null,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    liveExpiresAt: new Date(now.getTime() + 60 * 60_000),
    retentionExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
  });
  expect(session).toMatchObject({ phase: "lobby", revision: 0, eventSeq: 0 });

  const openCommand = {
    workspaceId: input.workspaceId,
    sessionId,
    commandId: openCommandId,
    expectedRevision: 0,
    phase: "question_open" as const,
    currentBlockIndex: 0,
    status: "active" as const,
    occurredAt: now,
    questionOpenedAt: now,
    questionClosesAt: new Date(now.getTime() + 30_000),
    event: {
      type: "question.launched" as const,
      blockIndex: 0,
      blockId: questionBlock.id,
    },
  };
  const opened = await input.repository.transitionSessionCommand(openCommand);
  expect(opened).toMatchObject({
    status: "accepted",
    session: {
      phase: "question_open",
      revision: 1,
      eventSeq: 1,
      settings: { timeMode: "flex" },
      questionOpenedAt: now,
      questionClosesAt: null,
    },
  });
  await expect(input.repository.transitionSessionCommand(openCommand)).resolves.toMatchObject({
    status: "duplicate",
    session: { revision: 1, eventSeq: 1, questionClosesAt: null },
  });

  const participant = {
    id: participantId,
    workspaceId: input.workspaceId,
    sessionId,
    nickname: "Conformance learner",
    tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
    joinedAt: new Date(now.getTime() + 100),
    lastSeenAt: new Date(now.getTime() + 100),
  };
  await expect(input.repository.joinParticipantWithinLimit(participant, 20)).resolves.toEqual({
    status: "accepted",
    participant,
  });
  await expect(
    input.repository.getSessionForWorkspace(input.workspaceId, sessionId),
  ).resolves.toMatchObject({ revision: 1, eventSeq: 2 });

  const response = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    sessionId,
    participantId,
    blockId: questionBlock.id,
    questionId: questionBlock.question.id,
    response: { numericValue: "1" },
    correct: true,
    score: 1_000,
    responseMs: 1_000,
    submittedAt: new Date(now.getTime() + 1_000),
    idempotencyKey: responseIdempotencyKey,
    requestHash: responseRequestHash,
  } satisfies PresentationSessionResponseRecord;
  const accepted = await input.repository.acceptResponse(response, 1);
  expect(accepted).toMatchObject({
    status: "accepted",
    response: { id: response.id, requestHash: responseRequestHash },
    acknowledgement: {
      session: { phase: "question_open", revision: 1, eventSeq: 3 },
      projection: {
        participantCount: 1,
        standing: null,
        currentResponse: { id: response.id },
      },
    },
  });

  await expect(
    input.repository.acceptResponse({ ...response, id: randomUUID() }, 0),
  ).resolves.toMatchObject({
    status: "duplicate",
    response: { id: response.id },
    acknowledgement: { session: { revision: 1, eventSeq: 3 } },
  });
  await expect(
    input.repository.acceptResponse(
      { ...response, id: randomUUID(), requestHash: "b".repeat(64) },
      0,
    ),
  ).resolves.toMatchObject({ status: "idempotency_conflict", response: { id: response.id } });
  await expect(
    input.repository.acceptResponse(
      {
        ...response,
        id: randomUUID(),
        idempotencyKey: randomUUID(),
        requestHash: "c".repeat(64),
      },
      1,
    ),
  ).resolves.toMatchObject({ status: "already_responded", response: { id: response.id } });
  await expect(
    input.repository.getSessionForWorkspace(input.workspaceId, sessionId),
  ).resolves.toMatchObject({ revision: 1, eventSeq: 3 });

  const revealed = await input.repository.transitionSessionCommand({
    workspaceId: input.workspaceId,
    sessionId,
    commandId: randomUUID(),
    expectedRevision: 1,
    phase: "question_reveal",
    currentBlockIndex: 0,
    status: "active",
    occurredAt: new Date(now.getTime() + 2_000),
    event: { type: "question.revealed", blockIndex: 0, blockId: questionBlock.id },
  });
  expect(revealed).toMatchObject({
    status: "accepted",
    session: {
      phase: "question_reveal",
      revision: 2,
      eventSeq: 4,
      questionOpenedAt: null,
      questionClosesAt: null,
    },
  });

  await expect(
    input.repository.acceptResponse({ ...response, id: randomUUID() }, 1),
  ).resolves.toMatchObject({
    status: "duplicate",
    acknowledgement: {
      session: { phase: "question_reveal", revision: 2, eventSeq: 4 },
      projection: {
        participantCount: 1,
        standing: { rank: 1, score: 1_000 },
        currentResponse: { id: response.id },
      },
    },
  });
  await expect(input.repository.listResponses(sessionId)).resolves.toEqual([
    expect.objectContaining({ id: response.id }),
  ]);
  await expect(input.repository.listTimeline(sessionId)).resolves.toEqual([
    expect.objectContaining({ sequence: 1, type: "question.launched" }),
    expect.objectContaining({ sequence: 4, type: "question.revealed" }),
  ]);
}

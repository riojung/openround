import { randomInt, randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { PresentationContent } from "@openround/contracts";
import { PresentationSessionConflictError } from "../../src/index.js";
import type { PresentationSessionRepositoryConformanceInput } from "./presentation-session-conformance.js";

/** Content, timer, timeline and receipt must commit as one CAS in both durable backends. */
export async function expectPresentationLiveInsertionConformance(
  input: PresentationSessionRepositoryConformanceInput & { otherWorkspaceId?: string },
) {
  const { repository, workspaceId } = input;
  const source = input.content.blocks.find((block) => block.kind === "question");
  if (!source) throw new Error("Live insertion conformance requires a question");
  const now = new Date();
  const session = await repository.createSession({
    id: randomUUID(),
    workspaceId,
    presentationId: input.presentationId,
    presentationVersionId: input.presentationVersionId,
    title: input.content.title,
    content: input.content,
    code: String(randomInt(1_000_000, 10_000_000)),
    status: "active",
    phase: "lobby",
    currentBlockIndex: -1,
    revision: 0,
    recoveryPackCardsEnabled: true,
    settings: { timeMode: "timed" },
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    liveExpiresAt: new Date(now.getTime() + 3_600_000),
    retentionExpiresAt: new Date(now.getTime() + 86_400_000),
  });
  const inserted = {
    ...structuredClone(source),
    id: randomUUID(),
    question: { ...structuredClone(source.question), id: randomUUID(), timeLimitSeconds: 17 },
  };
  const content: PresentationContent = {
    ...structuredClone(input.content),
    blocks: [inserted, ...structuredClone(input.content.blocks)],
  };
  const command = {
    workspaceId,
    sessionId: session.id,
    commandId: randomUUID(),
    requestHash: "a".repeat(64),
    expectedRevision: 0,
    content,
    phase: "question_open" as const,
    currentBlockIndex: 0,
    status: "active" as const,
    occurredAt: now,
    event: { type: "question.launched" as const, blockIndex: 0, blockId: inserted.id },
  };
  expect(
    await repository.transitionSessionCommand({
      ...command,
      workspaceId: input.otherWorkspaceId ?? randomUUID(),
    }),
  ).toEqual({ status: "not_found" });
  await expect(repository.transitionSessionCommand(command)).resolves.toMatchObject({
    status: "accepted",
    session: {
      revision: 1,
      eventSeq: 1,
      content,
      presentationId: input.presentationId,
      presentationVersionId: input.presentationVersionId,
      questionOpenedAt: now,
      questionClosesAt: new Date(now.getTime() + 17_000),
    },
  });
  // Caller mutation cannot modify the frozen session after acknowledgement.
  const insertedBlock = content.blocks[0];
  if (insertedBlock?.kind !== "question") throw new Error("Expected inserted question");
  insertedBlock.question.prompt = "Caller mutation";
  expect((await repository.getSessionById(session.id))?.content.blocks[0]).toMatchObject({
    id: inserted.id,
    question: { prompt: source.question.prompt },
  });
  await expect(
    repository.findCommandReceipt(workspaceId, session.id, command.commandId),
  ).resolves.toMatchObject({
    requestHash: command.requestHash,
    expectedRevision: 0,
    resultingRevision: 1,
    eventType: "question.launched",
  });

  const reveal = {
    ...command,
    commandId: randomUUID(),
    requestHash: "b".repeat(64),
    expectedRevision: 1,
    content: undefined,
    phase: "question_reveal" as const,
    event: { type: "question.revealed" as const, blockIndex: 0, blockId: inserted.id },
  };
  await repository.transitionSessionCommand(reveal);
  await expect(repository.transitionSessionCommand(command)).resolves.toMatchObject({
    status: "duplicate",
    session: { revision: 2, eventSeq: 2, phase: "question_reveal" },
  });
  await expect(
    repository.transitionSessionCommand({ ...command, requestHash: "c".repeat(64) }),
  ).resolves.toMatchObject({ status: "idempotency_conflict" });
  const invalidCommandId = randomUUID();
  await expect(
    repository.transitionSessionCommand({
      ...command,
      commandId: invalidCommandId,
      expectedRevision: 2,
      content: { ...content, blocks: [] },
    }),
  ).rejects.toThrow();
  expect(await repository.findCommandReceipt(workspaceId, session.id, invalidCommandId)).toBeNull();
  expect((await repository.getSessionById(session.id))?.revision).toBe(2);
  expect(await repository.listTimeline(session.id)).toHaveLength(2);

  const launch = {
    ...command,
    commandId: randomUUID(),
    expectedRevision: 2,
    content: undefined,
    currentBlockIndex: 1,
    event: { type: "question.launched" as const, blockIndex: 1, blockId: source.id },
  };
  const race = await Promise.allSettled([
    repository.transitionSessionCommand(launch),
    repository.transitionSessionCommand({ ...launch, commandId: randomUUID(), content }),
  ]);
  expect(race.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(race.find((result) => result.status === "rejected")).toMatchObject({
    reason: expect.any(PresentationSessionConflictError),
  });
  expect((await repository.getSessionById(session.id))?.revision).toBe(3);
  expect(await repository.listTimeline(session.id)).toHaveLength(3);
  await expect(
    repository.transitionSessionCommand({ ...launch, commandId: randomUUID() }),
  ).rejects.toBeInstanceOf(PresentationSessionConflictError);

  const legacy = {
    ...launch,
    commandId: randomUUID(),
    expectedRevision: 3,
    requestHash: undefined,
  };
  await repository.transitionSessionCommand(legacy);
  await expect(
    repository.transitionSessionCommand({ ...legacy, requestHash: "d".repeat(64) }),
  ).resolves.toMatchObject({ status: "duplicate" });
  // Legacy unhashed advance receipts cannot masquerade as a content insertion.
  await expect(
    repository.transitionSessionCommand({
      ...legacy,
      requestHash: "d".repeat(64),
      content,
    }),
  ).resolves.toMatchObject({ status: "idempotency_conflict" });
  await input.beginWorkspaceDeletion();
  await expect(repository.transitionSessionCommand(command)).resolves.toMatchObject({
    status: "duplicate",
    session: { revision: 4, eventSeq: 4 },
  });
}

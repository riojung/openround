import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createAudienceScopeRepository,
  createPresentationSessionRepository,
  MemoryRepository,
} from "../src/index.js";
import { expectAudienceScopeConformance } from "./support/audience-scope-conformance.js";
import { presentationSessionConformanceContent } from "./support/presentation-session-conformance.js";

async function livePresentationFixture() {
  const memory = new MemoryRepository();
  const scopes = createAudienceScopeRepository(memory);
  const sessions = createPresentationSessionRepository(memory);
  const now = new Date();
  const session = await sessions.createSession({
    id: randomUUID(),
    workspaceId: randomUUID(),
    presentationId: randomUUID(),
    presentationVersionId: randomUUID(),
    title: "Atomic audience activation",
    content: presentationSessionConformanceContent(),
    code: "7418529",
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
  });
  const activation = {
    workspaceId: session.workspaceId,
    sessionId: session.id,
    idempotencyKey: randomUUID(),
    now,
  };
  const finish = () =>
    sessions.transitionSession({
      workspaceId: session.workspaceId,
      sessionId: session.id,
      expectedRevision: session.revision,
      phase: "finished",
      status: "finished",
      currentBlockIndex: session.currentBlockIndex,
      occurredAt: now,
      event: {
        type: "presentation.finished",
        blockId: null,
        blockIndex: session.currentBlockIndex,
      },
    });
  return { scopes, sessions, activation, finish };
}

describe("audience scope repository", () => {
  it("uses one lifecycle-aware memory adapter with atomic activation and lease-fenced delivery", async () => {
    const memory = new MemoryRepository();
    const scopes = createAudienceScopeRepository(memory);
    expect(createAudienceScopeRepository(memory)).toBe(scopes);
    await expectAudienceScopeConformance({
      scopes,
      sessions: createPresentationSessionRepository(memory),
      workspaceId: randomUUID(),
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      createdBy: randomUUID(),
    });
  });

  it("cannot recreate scope or outbox records after concurrent parent finishing and deletion", async () => {
    const f = await livePresentationFixture();
    // Start all three operations in the same turn, before resolving any async receipts.
    const activating = f.scopes.activatePresentation(f.activation);
    const finishing = f.finish();
    const deleting = f.sessions.deleteSession(f.activation.workspaceId, f.activation.sessionId);
    const [activated, , deleted] = await Promise.all([activating, finishing, deleting]);
    expect(activated.created).toBe(true);
    expect(deleted.status).toBe("deleted");
    expect(await f.sessions.getSessionById(f.activation.sessionId)).toBeNull();
    expect(await f.scopes.get(f.activation.workspaceId, f.activation.sessionId)).toBeNull();
    expect(
      await f.scopes.claimOutbox(f.activation.now, new Date(f.activation.now.getTime() + 30_000)),
    ).toBeNull();
  });

  it("rejects new activation when parent finishing wins the race", async () => {
    const f = await livePresentationFixture();
    const finishing = f.finish();
    await expect(f.scopes.activatePresentation(f.activation)).rejects.toMatchObject({
      code: "ROOM_CLOSED",
    });
    await finishing;
    expect(await f.scopes.get(f.activation.workspaceId, f.activation.sessionId)).toBeNull();
    expect(
      await f.scopes.claimOutbox(f.activation.now, new Date(f.activation.now.getTime() + 30_000)),
    ).toBeNull();
  });
});

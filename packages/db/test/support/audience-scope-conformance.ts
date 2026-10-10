import { randomInt, randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { AudienceScopeRepository, PresentationSessionRepository } from "../../src/index.js";
import { presentationSessionConformanceContent } from "./presentation-session-conformance.js";

export async function expectAudienceScopeConformance(input: {
  scopes: AudienceScopeRepository;
  sessions: PresentationSessionRepository;
  workspaceId: string;
  presentationId: string;
  presentationVersionId: string;
  createdBy: string;
}) {
  const now = new Date();
  const session = await input.sessions.createSession({
    id: randomUUID(),
    workspaceId: input.workspaceId,
    presentationId: input.presentationId,
    presentationVersionId: input.presentationVersionId,
    title: "Scope foundation",
    content: presentationSessionConformanceContent(),
    code: String(randomInt(1_000_000, 10_000_000)),
    status: "active",
    phase: "lobby",
    currentBlockIndex: -1,
    revision: 0,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    liveExpiresAt: new Date(now.getTime() + 60_000),
    retentionExpiresAt: new Date(now.getTime() + 86_400_000),
  });
  const baseline = (await input.sessions.getSessionById(session.id))!;
  const activation = {
    workspaceId: input.workspaceId,
    sessionId: session.id,
    idempotencyKey: randomUUID(),
    now,
  };
  const [first, retry] = await Promise.all([
    input.scopes.activatePresentation(activation),
    input.scopes.activatePresentation(activation),
  ]);
  expect([first.created, retry.created].filter(Boolean)).toHaveLength(1);
  expect(retry.scope).toEqual(first.scope);
  expect(first.scope).toMatchObject({
    id: session.id,
    audienceSeq: 1,
    identityPolicy: "facilitator_visible_alias",
    expiresAt: session.retentionExpiresAt,
  });
  expect(await input.scopes.get(randomUUID(), session.id)).toBeNull();
  expect(await input.sessions.getSessionById(session.id)).toMatchObject({
    revision: baseline.revision,
    eventSeq: baseline.eventSeq,
  });

  const claimTime = new Date(now.getTime() + 1);
  const leased = await input.scopes.claimOutbox(claimTime, new Date(claimTime.getTime() + 100));
  expect(leased?.event).toMatchObject({
    scopeId: session.id,
    audienceSeq: 1,
    payload: { kind: "presentation" },
  });
  expect(await input.scopes.claimOutbox(claimTime, new Date(claimTime.getTime() + 100))).toBeNull();
  const restarted = await input.scopes.claimOutbox(
    new Date(claimTime.getTime() + 101),
    new Date(claimTime.getTime() + 201),
  );
  expect(restarted?.event.eventId).toBe(leased!.event.eventId);
  expect(restarted?.leaseToken).not.toBe(leased!.leaseToken);
  expect(
    await input.scopes.completeOutbox(
      input.workspaceId,
      leased!.event.eventId,
      leased!.leaseToken!,
      new Date(claimTime.getTime() + 102),
    ),
  ).toBe(false);
  expect(
    await input.scopes.completeOutbox(
      randomUUID(),
      restarted!.event.eventId,
      restarted!.leaseToken!,
      new Date(claimTime.getTime() + 102),
    ),
  ).toBe(false);
  expect(
    await input.scopes.completeOutbox(
      input.workspaceId,
      restarted!.event.eventId,
      restarted!.leaseToken!,
      new Date(claimTime.getTime() + 102),
    ),
  ).toBe(true);
  expect(
    await input.scopes.claimOutbox(
      new Date(claimTime.getTime() + 103),
      new Date(claimTime.getTime() + 203),
    ),
  ).toBeNull();

  // Existing activation receipts survive a closed lifecycle; no new scope is admitted after expiry.
  expect(
    await input.scopes.activatePresentation({
      ...activation,
      now: new Date(now.getTime() + 60_001),
    }),
  ).toMatchObject({ created: false, scope: first.scope });
  await input.sessions.deleteSession(
    input.workspaceId,
    session.id,
    new Date(now.getTime() + 60_001),
  );
  expect(await input.scopes.get(input.workspaceId, session.id)).toBeNull();
  expect(await input.scopes.claimOutbox(claimTime, new Date(claimTime.getTime() + 100))).toBeNull();
  await expect(input.scopes.activatePresentation(activation)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
}

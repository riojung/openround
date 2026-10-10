import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Server } from "socket.io";
import {
  AudienceScopeSnapshotSchema,
  type PresentationContent,
  type QuizDraft,
} from "@openround/contracts";
import { MemoryRepository } from "@openround/db";
import { addParticipant, createGameState } from "@openround/game-engine";
import { buildApp } from "../src/app.js";
import { ConfigSchema } from "../src/config.js";
import { coreParityCreationEnabled } from "../src/core-parity-rollout.js";
import { hashToken } from "../src/security.js";
import { RoundAudienceAccess, PresentationAudienceAccess } from "../src/audience-access.js";
import { attachRealtime } from "../src/realtime.js";
import { ScopedAudienceOutboxWorker } from "../src/scoped-audience-outbox-worker.js";
import { registerScopedAudienceRealtime } from "../src/scoped-audience-realtime.js";
import { io as connect, type Socket } from "socket.io-client";

const apps: FastifyInstance[] = [];
const transports: Array<Awaited<ReturnType<typeof attachRealtime>>> = [];
const clients: Socket[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  await Promise.all(transports.splice(0).map((transport) => transport.close()));
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function config(workspaceId?: string) {
  return ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    LOG_LEVEL: "silent",
    WEB_ORIGIN: "http://localhost:3000",
    PUBLIC_API_URL: "http://localhost:4000",
    FEATURE_AUDIENCE_SCOPES: workspaceId ? "true" : "false",
    CORE_PARITY_WORKSPACE_ALLOWLIST: workspaceId ?? "",
  });
}

async function fixture(enabled = true) {
  const workspaceId = randomUUID();
  const settings = config(enabled ? workspaceId : undefined);
  const built = await buildApp(settings, { repository: new MemoryRepository() });
  apps.push(built.app);
  const now = new Date();
  const presentationId = randomUUID();
  const content: PresentationContent = {
    title: "Audience foundation",
    description: "",
    schemaVersion: 2,
    experiencePreset: { id: "focus", version: 1 },
    blocks: [],
  };
  const session = await built.presentationSessions.createSession({
    id: randomUUID(),
    workspaceId,
    presentationId,
    presentationVersionId: randomUUID(),
    title: content.title,
    content,
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
  const tokens = { host: randomUUID(), companion: randomUUID(), participant: randomUUID() };
  const credentialIds: Record<string, string> = {};
  for (const role of ["host", "companion"] as const) {
    credentialIds[role] = randomUUID();
    await built.presentationSessions.createCredential({
      id: credentialIds[role]!,
      workspaceId,
      sessionId: session.id,
      role,
      tokenHash: hashToken(tokens[role]),
      createdAt: now,
      expiresAt: session.liveExpiresAt,
      revokedAt: null,
    });
  }
  await built.presentationSessions.addParticipant({
    id: randomUUID(),
    workspaceId,
    sessionId: session.id,
    nickname: "Never in scope metadata",
    tokenHash: hashToken(tokens.participant),
    joinedAt: now,
    lastSeenAt: now,
  });
  const baseline = (await built.presentationSessions.getSessionById(session.id))!;
  const activate = (token = tokens.host, idempotencyKey = randomUUID()) =>
    built.app.inject({
      method: "POST",
      url: "/v1/audience-scopes",
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: "presentation", sessionId: session.id, idempotencyKey },
    });
  return { ...built, settings, workspaceId, session: baseline, tokens, credentialIds, activate };
}

async function roundFixture(built: Awaited<ReturnType<typeof buildApp>>) {
  const now = new Date();
  const tokens = {
    host: randomUUID(),
    participant: randomUUID(),
    cohost: randomUUID(),
    presenter: randomUUID(),
  };
  const sessionId = randomUUID();
  const workspaceId = randomUUID();
  const participantId = randomUUID();
  const quiz: QuizDraft = {
    title: "Legacy Round",
    description: "",
    questions: [
      {
        id: randomUUID(),
        type: "numeric",
        prompt: "How many?",
        correctValue: "2",
        tolerance: "0",
        unit: null,
        timeLimitSeconds: 30,
        basePoints: 1000,
        explanation: "PRIVATE ANSWER",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  };
  const state = addParticipant(
    createGameState({
      sessionId,
      code: "9638527",
      quiz,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    }),
    {
      id: participantId,
      nickname: "Learner alias",
      score: 0,
      correctCount: 0,
      acceptedResponseMs: 0,
      connected: true,
      kicked: false,
    },
  ).state;
  await built.repository.createSession({
    id: sessionId,
    workspaceId,
    quizVersionId: randomUUID(),
    hostId: randomUUID(),
    hostTokenHash: hashToken(tokens.host),
    state,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
    retentionExpiresAt: new Date(now.getTime() + 86_400_000),
  });
  await built.repository.createParticipant({
    id: participantId,
    sessionId,
    nickname: "Learner alias",
    tokenHash: hashToken(tokens.participant),
    status: "active",
    joinedAt: now,
  });
  const credentials = [];
  for (const role of ["cohost", "presenter"] as const)
    credentials.push(
      await built.repository.createSessionStaffCredential({
        id: randomUUID(),
        workspaceId,
        sessionId,
        role,
        label: role,
        tokenHash: hashToken(tokens[role]),
        createdBy: randomUUID(),
        createdAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
        revokedAt: null,
      }),
    );
  return { tokens, sessionId, workspaceId, participantId, credentials };
}

describe("core-parity foundation", () => {
  it("keeps independent writer gates default-off and requires the dedicated allowlist", () => {
    const workspaceId = randomUUID();
    const settings = config();
    expect(settings.CORE_PARITY_WORKSPACE_ALLOWLIST).toEqual([]);
    for (const feature of [
      "audienceScopes",
      "feedbackRooms",
      "surveys",
      "feedbackExports",
    ] as const)
      expect(coreParityCreationEnabled(settings, workspaceId, feature)).toBe(false);
    const enabled = config(workspaceId);
    expect(coreParityCreationEnabled(enabled, workspaceId, "audienceScopes")).toBe(true);
    expect(coreParityCreationEnabled(enabled, randomUUID(), "audienceScopes")).toBe(false);
    expect(coreParityCreationEnabled(enabled, workspaceId, "surveys")).toBe(false);
  });

  it("activates exactly once and preserves reads/retries when rollout is paused", async () => {
    const f = await fixture();
    const key = randomUUID();
    const first = await f.activate(f.tokens.host, key);
    expect(first.statusCode).toBe(201);
    const scope = AudienceScopeSnapshotSchema.parse(first.json().scope);
    expect(scope).toMatchObject({
      scopeId: f.session.id,
      kind: "presentation",
      audienceSeq: 1,
      identityPolicy: "facilitator_visible_alias",
      features: { qna: false, chat: false, pulse: false },
    });
    expect(first.body).not.toContain("Never in scope metadata");
    expect(first.body).not.toContain(f.tokens.host);
    f.settings.FEATURE_AUDIENCE_SCOPES = false;
    f.settings.CORE_PARITY_WORKSPACE_ALLOWLIST = [];
    expect((await f.activate(f.tokens.host, key)).statusCode).toBe(200);
    for (const role of ["host", "companion", "participant"] as const) {
      const read = await f.app.inject({
        method: "GET",
        url: `/v1/audience-scopes/${f.session.id}?kind=presentation`,
        headers: { authorization: `Bearer ${f.tokens[role]}` },
      });
      expect(read.statusCode).toBe(200);
      expect(read.headers["cache-control"]).toBe("private, no-store");
      expect(read.json().scope.permissions).toEqual({
        read: true,
        submit: false,
        moderate: false,
        manageSettings: false,
      });
    }
    expect(await f.presentationSessions.getSessionById(f.session.id)).toMatchObject({
      revision: f.session.revision,
      eventSeq: f.session.eventSeq,
    });
  });

  it("fails closed for activation outside rollout, wrong tokens, Companion, and participants", async () => {
    const f = await fixture(false);
    expect((await f.activate()).statusCode).toBe(404);
    f.settings.FEATURE_AUDIENCE_SCOPES = true;
    f.settings.CORE_PARITY_WORKSPACE_ALLOWLIST = [f.workspaceId];
    for (const token of [f.tokens.companion, f.tokens.participant, randomUUID()])
      expect((await f.activate(token)).statusCode).toBe(401);
    expect(await f.audienceScopes.get(f.workspaceId, f.session.id)).toBeNull();
    expect(
      (
        await f.app.inject({
          method: "GET",
          url: `/v1/audience-scopes/${f.session.id}?kind=presentation&token=${f.tokens.host}`,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await f.app.inject({
          method: "GET",
          url: `/v1/audience-scopes/${f.session.id}?kind=presentation`,
        })
      ).statusCode,
    ).toBe(401);
  });

  it("throttles activation retries without allocating new audience or game sequences", async () => {
    const f = await fixture();
    const key = randomUUID();
    for (let index = 0; index < 20; index += 1)
      expect((await f.activate(f.tokens.host, key)).statusCode).toBe(index === 0 ? 201 : 200);
    const limited = await f.activate(f.tokens.host, key);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toMatchObject({
      code: "RATE_LIMITED",
      message: expect.stringContaining("wait a minute"),
    });
    expect(await f.audienceScopes.get(f.workspaceId, f.session.id)).toMatchObject({
      audienceSeq: 1,
    });
    expect(await f.presentationSessions.getSessionById(f.session.id)).toMatchObject({
      revision: f.session.revision,
      eventSeq: f.session.eventSeq,
    });
  });

  it("revalidates revoked Presentation credentials and never accepts a Round token across scopes", async () => {
    const f = await fixture();
    await f.activate();
    const round = await roundFixture(f);
    const access = new PresentationAudienceAccess(f.presentationSessions);
    await expect(access.authenticate(f.session.id, round.tokens.host)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      access.authenticateHash(f.session.id, hashToken(round.tokens.host)),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(access.authenticateHash(f.session.id, f.tokens.host)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      access.authenticateHash(f.session.id, hashToken(f.tokens.host), f.session.liveExpiresAt),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await f.presentationSessions.revokeCredential(
      f.workspaceId,
      f.session.id,
      f.credentialIds.companion!,
    );
    await expect(access.authenticate(f.session.id, f.tokens.companion)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      access.authenticateHash(f.session.id, hashToken(f.tokens.companion)),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: `/v1/audience-scopes/${f.session.id}/sync`,
          headers: { authorization: `Bearer ${f.tokens.host}` },
          payload: { kind: "presentation", limit: 51 },
        })
      ).statusCode,
    ).toBe(400);
  });

  it("adapts Round Q&A/chat/Pulse with existing role projections and excludes answers from sync", async () => {
    const f = await fixture(false);
    const round = await roundFixture(f);
    for (const role of ["host", "cohost", "presenter", "participant"] as const) {
      const response = await f.app.inject({
        method: "POST",
        url: `/v1/audience-scopes/${round.sessionId}/sync`,
        headers: { authorization: `Bearer ${round.tokens[role]}` },
        payload: { kind: "round" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().scope.permissions.moderate).toBe(role === "host" || role === "cohost");
      expect(response.json().scope.identityDisclosure).toContain("not from moderators");
      expect(response.body).not.toContain("PRIVATE ANSWER");
      if (role === "presenter" || role === "participant")
        expect(response.json().round.interactions.summary.participants).toBeUndefined();
    }
    await expect(
      new RoundAudienceAccess(f.repository).authenticate(round.sessionId, f.tokens.host),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const access = new RoundAudienceAccess(f.repository);
    await f.repository.revokeSessionStaff(
      round.workspaceId,
      round.sessionId,
      round.credentials[0]!.id,
    );
    await expect(access.authenticate(round.sessionId, round.tokens.cohost)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await f.repository.saveQnaSettings({
      workspaceId: round.workspaceId,
      sessionId: round.sessionId,
      enabled: false,
      displayMode: "anonymous_public",
      moderationMode: "pre",
      participantReplies: false,
      updatedAt: new Date(),
    });
    const disabled = await f.audienceScopeService.sync(
      "round",
      round.sessionId,
      round.tokens.host,
      50,
    );
    expect(disabled.scope.features.qna).toBe(false);
    expect(disabled.round?.qna).toBeNull();
  });

  it("keeps closed Round scope reads and sync read-only when settings were never initialized", async () => {
    const f = await fixture(false);
    const round = await roundFixture(f);
    const memory = f.repository as MemoryRepository;
    // Simulate a retained legacy room that never initialized audience interactions.
    memory.interactionSettings.delete(round.sessionId);
    memory.sessions.get(round.sessionId)!.state.phase = "finished";
    const saveInteractions = vi.spyOn(f.repository, "saveInteractionSettings");
    const saveQna = vi.spyOn(f.repository, "saveQnaSettings");
    for (const role of ["host", "cohost", "presenter", "participant"] as const) {
      const headers = { authorization: `Bearer ${round.tokens[role]}` };
      const read = await f.app.inject({
        method: "GET",
        url: `/v1/audience-scopes/${round.sessionId}?kind=round`,
        headers,
      });
      expect(read.statusCode).toBe(200);
      expect(read.json().scope).toMatchObject({
        lifecycle: "closed",
        audienceSeq: 0,
        permissions: { read: true, submit: false, moderate: false, manageSettings: false },
      });
      const sync = await f.app.inject({
        method: "POST",
        url: `/v1/audience-scopes/${round.sessionId}/sync`,
        headers,
        payload: { kind: "round" },
      });
      expect(sync.statusCode).toBe(200);
      expect(sync.json().scope).toEqual(read.json().scope);
      expect(sync.json().round.interactions.summary.audienceSeq).toBe(0);
      expect(sync.json().round.interactions.chat.audienceSeq).toBe(0);
      expect(sync.json().round.qna.questions).toEqual([]);
      expect(sync.body).not.toContain("PRIVATE ANSWER");
      if (role === "presenter" || role === "participant")
        expect(sync.json().round.interactions.summary.participants).toBeUndefined();
    }
    expect(saveInteractions).not.toHaveBeenCalled();
    expect(saveQna).not.toHaveBeenCalled();
    expect(
      await f.repository.getInteractionSettings(round.workspaceId, round.sessionId),
    ).toBeNull();
    expect(await f.repository.getQnaSettings(round.workspaceId, round.sessionId)).toBeNull();
    expect(memory.audienceOutbox.size).toBe(0);
  });

  it.each(["GET", "sync"] as const)(
    "returns the initialized audience sequence on the first %s request",
    async (method) => {
      const f = await fixture(false);
      const round = await roundFixture(f);
      (f.repository as MemoryRepository).interactionSettings.delete(round.sessionId);
      expect(
        await f.repository.getInteractionSettings(round.workspaceId, round.sessionId),
      ).toBeNull();
      const headers = { authorization: `Bearer ${round.tokens.host}` };
      const response = await f.app.inject(
        method === "GET"
          ? {
              method: "GET",
              url: `/v1/audience-scopes/${round.sessionId}?kind=round`,
              headers,
            }
          : {
              method: "POST",
              url: `/v1/audience-scopes/${round.sessionId}/sync`,
              headers,
              payload: { kind: "round" },
            },
      );
      expect(response.statusCode).toBe(200);
      expect(response.json().scope.audienceSeq).toBe(1);
      const sync =
        method === "sync"
          ? response
          : await f.app.inject({
              method: "POST",
              url: `/v1/audience-scopes/${round.sessionId}/sync`,
              headers,
              payload: { kind: "round" },
            });
      expect(sync.statusCode).toBe(200);
      expect(sync.json().scope.audienceSeq).toBe(1);
      expect(sync.json().round.interactions.summary.audienceSeq).toBe(1);
      expect(sync.json().round.interactions.chat.audienceSeq).toBe(1);
      const reads = await Promise.all(
        Object.values(round.tokens).map((token) =>
          f.app.inject({
            method: "GET",
            url: `/v1/audience-scopes/${round.sessionId}?kind=round`,
            headers: { authorization: `Bearer ${token}` },
          }),
        ),
      );
      for (const read of reads) {
        expect(read.statusCode).toBe(200);
        expect(read.json().scope.audienceSeq).toBe(1);
      }
      const events = [...(f.repository as MemoryRepository).audienceOutbox.values()].filter(
        (event) => event.sessionId === round.sessionId,
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: "audience.settings.updated", audienceSeq: 1 });
    },
  );

  it("shares revoked/kicked/expired Round authentication between Q&A and interactions", async () => {
    const f = await fixture(false);
    const round = await roundFixture(f);
    const memory = f.repository as MemoryRepository;
    const stored = memory.sessions.get(round.sessionId)!;
    stored.state.participants[round.participantId]!.kicked = true;
    for (const service of [
      () => f.qna.list(round.sessionId, round.tokens.participant, { limit: 50 }),
      () => f.interactions.summary(round.sessionId, round.tokens.participant),
    ]) {
      await expect(service()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    stored.expiresAt = new Date(0);
    for (const service of [
      () => f.qna.list(round.sessionId, round.tokens.host, { limit: 50 }),
      () => f.interactions.summary(round.sessionId, round.tokens.host),
    ]) {
      await expect(service()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("keeps native and Round bearer credentials out of distributed socket metadata", async () => {
    const f = await fixture();
    await f.activate();
    const round = await roundFixture(f);
    const realtime = await attachRealtime(
      f.app.server,
      f.sessions,
      f.settings,
      f.metrics,
      f.interactions,
      undefined,
      f.audienceScopeService,
    );
    transports.push(realtime);
    const url = await f.app.listen({ host: "127.0.0.1", port: 0 });
    const client = connect(url, {
      transports: ["websocket"],
      extraHeaders: { Origin: f.settings.WEB_ORIGIN },
    });
    clients.push(client);
    await new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
    });
    const credentials = [
      ...Object.values(f.tokens).map((token) => ({
        kind: "presentation" as const,
        scopeId: f.session.id,
        token,
      })),
      ...Object.values(round.tokens).map((token) => ({
        kind: "round" as const,
        scopeId: round.sessionId,
        token,
      })),
    ];
    for (const request of credentials) {
      const subscribed = await client
        .timeout(2_000)
        .emitWithAck("audience.scope.subscribe", request);
      expect(subscribed.error).toBeUndefined();
      const key = `audience-scope:${request.kind}:${request.scopeId}`;
      const sockets = await realtime.io.in(key).fetchSockets();
      expect(sockets).toHaveLength(1);
      // This is exactly the data the adapter serializes during a cross-process fetch.
      const metadata = JSON.stringify(sockets.map((socket) => socket.data));
      for (const credential of credentials) expect(metadata).not.toContain(credential.token);
      expect(sockets[0]!.data.scopedAudience[key]).toEqual({
        kind: request.kind,
        scopeId: request.scopeId,
        tokenHash: hashToken(request.token),
      });
      expect(
        (
          await client.timeout(2_000).emitWithAck("audience.scope.subscribe", {
            ...request,
            token: hashToken(request.token),
          })
        ).error.code,
      ).toBe("UNAUTHORIZED");
    }
  });

  it("revalidates a remote subscriber using only serialized hashes and ejects revoked credentials", async () => {
    const f = await fixture();
    await f.activate();
    const now = new Date();
    const leased = await f.audienceScopes.claimOutbox(now, new Date(now.getTime() + 30_000));
    expect(leased).not.toBeNull();
    const key = `audience-scope:presentation:${f.session.id}`;
    const remoteSocket = {
      data: structuredClone({
        scopedAudience: {
          [key]: {
            kind: "presentation",
            scopeId: f.session.id,
            tokenHash: hashToken(f.tokens.companion),
          },
        },
      }),
      emit: vi.fn(),
      leave: vi.fn(async () => {}),
    };
    const io = {
      on: vi.fn(),
      in: vi.fn(() => ({ fetchSockets: async () => [remoteSocket] })),
    } as unknown as Server;
    const relay = registerScopedAudienceRealtime(io, f.audienceScopeService);
    await relay.publish(leased!.event);
    expect(remoteSocket.emit).toHaveBeenCalledExactlyOnceWith(leased!.event.type, leased!.event);
    await f.presentationSessions.revokeCredential(
      f.workspaceId,
      f.session.id,
      f.credentialIds.companion!,
    );
    await relay.publish(leased!.event);
    expect(remoteSocket.emit).toHaveBeenCalledTimes(1);
    expect(remoteSocket.leave).toHaveBeenCalledExactlyOnceWith(key);
    expect(remoteSocket.data.scopedAudience[key]).toBeUndefined();
  });

  it("subscribes and synchronizes independently, retries outbox delivery, and removes revoked subscribers", async () => {
    const f = await fixture();
    await f.activate();
    const realtime = await attachRealtime(
      f.app.server,
      f.sessions,
      f.settings,
      f.metrics,
      f.interactions,
      undefined,
      f.audienceScopeService,
    );
    transports.push(realtime);
    const url = await f.app.listen({ host: "127.0.0.1", port: 0 });
    const client = connect(url, {
      transports: ["websocket"],
      extraHeaders: { Origin: f.settings.WEB_ORIGIN },
    });
    clients.push(client);
    await new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
    });
    const request = { kind: "presentation", scopeId: f.session.id, token: f.tokens.companion };
    const subscription = await client
      .timeout(2_000)
      .emitWithAck("audience.scope.subscribe", request);
    expect(subscription.data.scope.permissions.moderate).toBe(false);
    expect(
      (
        await client
          .timeout(2_000)
          .emitWithAck("audience.scope.sync.request", { ...request, limit: 50 })
      ).data.scope.audienceSeq,
    ).toBe(1);
    const eventPromise = new Promise<unknown>((resolve) => {
      client.once("audience.scope.activated", resolve);
    });
    let deliveries = 0;
    const worker = new ScopedAudienceOutboxWorker(f.audienceScopes, async (event) => {
      await realtime.scopedAudience!.publish(event);
      // Simulate loss after publish but before marking the outbox delivered.
      if (++deliveries === 1) throw new Error("process loss");
    });
    expect(await worker.runOnce()).toBe("retry");
    const firstEvent = await eventPromise;
    const duplicatePromise = new Promise<unknown>((resolve) => {
      client.once("audience.scope.activated", resolve);
    });
    // The event receipt, not a new sequence/event, is retried after the lease expires.
    expect(await worker.runOnce(new Date(Date.now() + 31_000))).toBe("completed");
    expect(await duplicatePromise).toEqual(firstEvent);
    expect(await worker.runOnce()).toBe("idle");
    await f.presentationSessions.revokeCredential(
      f.workspaceId,
      f.session.id,
      f.credentialIds.companion!,
    );
    expect(
      (await client.timeout(2_000).emitWithAck("audience.scope.sync.request", request)).error.code,
    ).toBe("UNAUTHORIZED");
    await realtime.scopedAudience!.publish(
      firstEvent as Parameters<NonNullable<typeof realtime.scopedAudience>["publish"]>[0],
    );
    expect(
      await realtime.io.in(`audience-scope:presentation:${f.session.id}`).fetchSockets(),
    ).toHaveLength(0);
  });
});

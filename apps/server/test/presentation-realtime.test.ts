import { createServer, type Server as HttpServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import type {
  PresentationCommand,
  PresentationContent,
  PresentationEventEnvelope,
  PresentationHostSnapshot,
  PresentationParticipantSnapshot,
  PresentationResponseAck,
  PresentationResponseSubmit,
  PresentationRoomStatus,
  PresentationSyncRequest,
  PresentationSyncResponse,
} from "@openround/contracts";
import { PresentationContentSchema } from "@openround/contracts";
import {
  MemoryRepository,
  createPresentationRepository,
  createPresentationSessionRepository,
} from "@openround/db";
import { ConfigSchema } from "../src/config.js";
import { MetricsService } from "../src/metrics.js";
import type { PresentationRealtimeService } from "../src/presentation-realtime.js";
import {
  PresentationBroadcastConsistencyError,
  PresentationSessionService,
  presentationParticipantTokenHash,
} from "../src/presentation-session-service.js";
import { attachRealtime } from "../src/realtime.js";
import type { SessionService } from "../src/session-service.js";
import { StorageService } from "../src/storage.js";

const workspaceId = crypto.randomUUID();
const sessionId = crypto.randomUUID();
const presentationId = crypto.randomUUID();
const presentationVersionId = crypto.randomUUID();
const participantId = crypto.randomUUID();
const blockId = crypto.randomUUID();
const controlToken = "host-control-token-that-is-long-enough";
const participantToken = "participant-token-that-is-long-enough";

function roomStatus(responseCount = 0) {
  return {
    sessionId,
    joinedCount: 1,
    connectedCount: 1,
    notCurrentlyConnectedCount: 0,
    responseCount,
    sampledAt: new Date().toISOString(),
  };
}

function snapshotBase(revision = 0) {
  return {
    sessionId,
    artifactType: "presentation" as const,
    presentationId,
    presentationVersionId,
    title: "Realtime recovery",
    code: "1234567",
    status: "active" as const,
    phase: "lobby" as const,
    currentBlockIndex: -1,
    blockCount: 1,
    revision,
    seq: revision,
    serverTime: new Date().toISOString(),
    questionOpenedAt: null,
    questionClosesAt: null,
    acceptingResponses: false,
    settings: { timeMode: "timed" as const, trustMode: "learning" as const },
    finishedAt: null,
  };
}

function hostSnapshot(revision = 0, responseCount = 0): PresentationHostSnapshot {
  return {
    ...snapshotBase(revision),
    projection: "host",
    currentBlock: null,
    participantCount: 1,
    responseCount,
    participants: [
      {
        id: participantId,
        nickname: "Learner",
        joinedAt: new Date().toISOString(),
        score: 0,
        rank: 1,
      },
    ],
    roomStatus: roomStatus(responseCount),
  };
}

function participantSnapshot(
  revision = 0,
  responseSubmitted = false,
): PresentationParticipantSnapshot {
  return {
    ...snapshotBase(revision),
    projection: "participant",
    participantId,
    currentBlock: null,
    participantCount: 1,
    responseSubmitted,
    standing: null,
    responseResult: null,
  };
}

class FakePresentationRealtimeService implements PresentationRealtimeService {
  revision = 0;
  responseId = crypto.randomUUID();
  responses = new Set<string>();
  internalSyncError = false;
  syncBarrier: Promise<void> | null = null;
  activeSyncs = 0;
  maximumActiveSyncs = 0;
  syncCalls = 0;

  async workspaceForCode(code: string) {
    return code === "1234567" ? workspaceId : null;
  }

  async workspaceForSession(candidate: string) {
    return candidate === sessionId ? workspaceId : null;
  }

  async join(code: string, _nickname: string) {
    if (code !== "1234567")
      throw Object.assign(new Error("Presentation not found"), { code: "NOT_FOUND" });
    return {
      workspaceId,
      participantToken,
      snapshot: participantSnapshot(this.revision),
    };
  }

  async sync(input: PresentationSyncRequest): Promise<PresentationSyncResponse> {
    this.syncCalls += 1;
    this.activeSyncs += 1;
    this.maximumActiveSyncs = Math.max(this.maximumActiveSyncs, this.activeSyncs);
    try {
      if (this.syncBarrier) await this.syncBarrier;
      if (this.internalSyncError) {
        throw Object.assign(new Error("database host db.internal and table secret_table failed"), {
          details: { internalQuery: "SELECT secret" },
        });
      }
      if (input.projection === "host") {
        if (input.controlToken !== controlToken) this.unauthorized();
        return {
          resetRequired: false,
          events: [],
          snapshot: hostSnapshot(this.revision, this.responses.size),
        };
      }
      if (input.projection === "participant") {
        if (input.participantToken !== participantToken) this.unauthorized();
        return {
          resetRequired: false,
          events: [],
          snapshot: participantSnapshot(this.revision, this.responses.size > 0),
        };
      }
      this.unauthorized();
    } finally {
      this.activeSyncs -= 1;
    }
  }

  async command(input: PresentationCommand) {
    if (input.controlToken !== controlToken) this.unauthorized();
    if (input.expectedRevision !== this.revision) {
      throw Object.assign(new Error("This Presentation advanced in another host window"), {
        code: "STALE_SESSION",
        details: { expectedRevision: input.expectedRevision, currentRevision: this.revision },
      });
    }
    this.revision += 1;
    return hostSnapshot(this.revision, this.responses.size);
  }

  async submitResponse(input: PresentationResponseSubmit): Promise<PresentationResponseAck> {
    if (input.participantToken !== participantToken) this.unauthorized();
    const duplicate = this.responses.has(input.idempotencyKey);
    this.responses.add(input.idempotencyKey);
    return {
      sessionId,
      blockId: input.blockId,
      idempotencyKey: input.idempotencyKey,
      accepted: true,
      duplicate,
      responseId: this.responseId,
      acceptedAt: new Date().toISOString(),
      snapshot: participantSnapshot(this.revision, true),
    };
  }

  private unauthorized(): never {
    throw Object.assign(new Error("Presentation credential is invalid"), { code: "UNAUTHORIZED" });
  }
}

function emitAck<T>(socket: Socket, event: string, payload: unknown) {
  return new Promise<T>((resolve) => socket.emit(event, payload, resolve));
}

function waitForRoomStatus(socket: Socket, connectedCount: number) {
  return new Promise<PresentationRoomStatus>((resolve) => {
    const listener = (
      event: PresentationEventEnvelope<{ roomStatus: PresentationRoomStatus }>,
      acknowledge?: () => void,
    ) => {
      acknowledge?.();
      if (event.payload.roomStatus.connectedCount !== connectedCount) return;
      socket.off("presentation.room-status.updated", listener);
      resolve(event.payload.roomStatus);
    };
    socket.on("presentation.room-status.updated", listener);
  });
}

describe("Presentation realtime transport", () => {
  let httpServer: HttpServer;
  let realtime: Awaited<ReturnType<typeof attachRealtime>>;
  let origin: string;
  let clients: Socket[];
  let service: FakePresentationRealtimeService;
  let metrics: MetricsService;
  let realtimeEnabled: boolean;

  beforeEach(async () => {
    clients = [];
    service = new FakePresentationRealtimeService();
    metrics = new MetricsService();
    realtimeEnabled = true;
    const roundSessions = {
      subscribe: vi.fn(() => vi.fn()),
      subscribeAuxiliary: vi.fn(() => vi.fn()),
      disconnect: vi.fn().mockResolvedValue(undefined),
    } as unknown as SessionService;
    httpServer = createServer();
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind");
    origin = `http://127.0.0.1:${address.port}`;
    realtime = await attachRealtime(
      httpServer,
      roundSessions,
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        WEB_ORIGIN: origin,
        PUBLIC_API_URL: origin,
        LOG_LEVEL: "silent",
      }),
      metrics,
      undefined,
      { service, isEnabled: () => realtimeEnabled },
    );
  });

  afterEach(async () => {
    for (const client of clients) client.disconnect();
    await realtime.close();
    if (httpServer.listening) {
      await new Promise<void>((resolve, reject) =>
        httpServer.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  async function connect() {
    const client = createClient(origin, {
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: { origin },
    });
    clients.push(client);
    await new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
    });
    return client;
  }

  it("joins and synchronizes with authoritative role projections", async () => {
    expect(
      (realtime.io as unknown as { _opts?: { connectionStateRecovery?: unknown } })._opts
        ?.connectionStateRecovery,
    ).toBeUndefined();
    const participant = await connect();
    const joined = await emitAck<{
      data: { participantToken: string; snapshot: PresentationParticipantSnapshot };
    }>(participant, "presentation.join", { code: "1234567", nickname: "Learner" });
    expect(joined.data).toMatchObject({
      participantToken,
      snapshot: { projection: "participant", participantId, sessionId },
    });

    const host = await connect();
    const synchronized = await emitAck<{ data: PresentationSyncResponse }>(
      host,
      "presentation.sync.request",
      { sessionId, projection: "host", controlToken, afterSeq: 0 },
    );
    expect(synchronized.data.snapshot).toMatchObject({
      projection: "host",
      sessionId,
      participants: [{ id: participantId, nickname: "Learner" }],
    });
    const socketData = JSON.stringify(
      (await realtime.io.fetchSockets()).map((serverSocket) => serverSocket.data),
    );
    expect(socketData).not.toContain(participantToken);
    expect(socketData).not.toContain(controlToken);
    expect(socketData).toContain("presentationParticipantTokenHash");
    expect(socketData).toContain("presentationControlTokenHash");
  });

  it("returns the same durable acknowledgement for a duplicate response", async () => {
    const participant = await connect();
    const payload = {
      sessionId,
      participantToken,
      blockId,
      expectedRevision: 0,
      idempotencyKey: "durable-response-1",
      response: { ratingValue: 3 },
    };
    const first = await emitAck<{ data: PresentationResponseAck }>(
      participant,
      "presentation.response.submit",
      payload,
    );
    const duplicate = await emitAck<{ data: PresentationResponseAck }>(
      participant,
      "presentation.response.submit",
      payload,
    );

    expect(first.data).toMatchObject({ accepted: true, duplicate: false, blockId });
    expect(duplicate.data).toMatchObject({
      accepted: true,
      duplicate: true,
      responseId: first.data.responseId,
      blockId,
    });
  });

  it("keeps an already-bound active session usable when rollout is paused", async () => {
    const participant = await connect();
    await emitAck(participant, "presentation.join", {
      code: "1234567",
      nickname: "Learner",
    });
    realtimeEnabled = false;

    const accepted = await emitAck<{ data: PresentationResponseAck }>(
      participant,
      "presentation.response.submit",
      {
        sessionId,
        participantToken,
        blockId,
        expectedRevision: 0,
        idempotencyKey: "rollout-paused-response",
        response: { ratingValue: 3 },
      },
    );
    expect(accepted.data).toMatchObject({ accepted: true, duplicate: false });

    const reconnect = await connect();
    const rejected = await emitAck<{ error: { code: string } }>(
      reconnect,
      "presentation.sync.request",
      { sessionId, projection: "participant", participantToken, afterSeq: 0 },
    );
    expect(rejected.error.code).toBe("FEATURE_UNAVAILABLE");
  });

  it("rate-limits reconnecting join abuse by room and alias instead of campus IP", async () => {
    const attempts: Array<{ data?: unknown; error?: { code: string } }> = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const client = await connect();
      attempts.push(
        await emitAck(client, "presentation.join", {
          code: "1234567",
          nickname: "Repeated alias",
        }),
      );
    }

    expect(attempts.slice(0, 10).every(({ data }) => Boolean(data))).toBe(true);
    expect(attempts[10]).toEqual({
      error: { code: "RATE_LIMITED", message: "Too many join attempts" },
    });
    const renderedMetrics = await metrics.render();
    expect(renderedMetrics).toContain(
      'openround_presentation_admission_attempts_total{transport="socket",outcome="accepted"} 10',
    );
    expect(renderedMetrics).toContain(
      'openround_presentation_admission_attempts_total{transport="socket",outcome="rate_limited"} 1',
    );
  });

  it("rejects a stale command without rebinding or broadcasting it", async () => {
    const host = await connect();
    const result = await emitAck<{ error: { code: string; details: unknown } }>(
      host,
      "presentation.command",
      {
        sessionId,
        controlToken,
        commandId: crypto.randomUUID(),
        expectedRevision: 8,
        action: "advance",
      },
    );
    expect(result.error).toMatchObject({
      code: "STALE_SESSION",
      details: { expectedRevision: 8, currentRevision: 0 },
    });
    expect(service.revision).toBe(0);
  });

  it("does not disclose unexpected service errors over the socket", async () => {
    service.internalSyncError = true;
    const client = await connect();
    const result = await emitAck<{ error: { code: string; message: string; details?: unknown } }>(
      client,
      "presentation.sync.request",
      { sessionId, projection: "host", controlToken, afterSeq: 0 },
    );
    expect(result).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "The Presentation realtime request failed",
      },
    });
    expect(JSON.stringify(result)).not.toContain("db.internal");
    expect(JSON.stringify(result)).not.toContain("secret_table");
  });

  it("broadcasts only the projection authorized for each socket", async () => {
    const participant = await connect();
    const host = await connect();
    await emitAck(participant, "presentation.sync.request", {
      sessionId,
      projection: "participant",
      participantToken,
      afterSeq: 0,
    });
    await emitAck(host, "presentation.sync.request", {
      sessionId,
      projection: "host",
      controlToken,
      afterSeq: 0,
    });

    const participantUpdate = new Promise<any>((resolve) =>
      participant.on("presentation.session.updated", (event, acknowledge) => {
        acknowledge?.();
        if (event.payload.snapshot.revision === 1) resolve(event);
      }),
    );
    const hostUpdate = new Promise<any>((resolve) =>
      host.on("presentation.session.updated", (event, acknowledge) => {
        acknowledge?.();
        if (event.payload.snapshot.revision === 1) resolve(event);
      }),
    );
    const command = await emitAck<{ data: { snapshot: PresentationHostSnapshot } }>(
      host,
      "presentation.command",
      {
        sessionId,
        controlToken,
        commandId: crypto.randomUUID(),
        expectedRevision: 0,
        action: "advance",
      },
    );
    expect(command.data.snapshot.revision).toBe(1);

    const [participantEvent, hostEvent] = await Promise.all([participantUpdate, hostUpdate]);
    expect(participantEvent.payload.snapshot).toMatchObject({
      projection: "participant",
      participantId,
      revision: 1,
    });
    expect(participantEvent.payload.snapshot).not.toHaveProperty("participants");
    expect(participantEvent.payload.snapshot).not.toHaveProperty("roomStatus");
    expect(JSON.stringify(participantEvent)).not.toContain("isCorrect");
    expect(hostEvent.payload.snapshot).toMatchObject({
      projection: "host",
      revision: 1,
      participants: [{ id: participantId }],
      roomStatus: { connectedCount: 1 },
    });
  });

  it("keeps authorized sockets connected while a transient bulk projection is retried", async () => {
    const participant = await connect();
    const host = await connect();
    await emitAck(participant, "presentation.sync.request", {
      sessionId,
      projection: "participant",
      participantToken,
      afterSeq: 0,
    });
    await emitAck(host, "presentation.sync.request", {
      sessionId,
      projection: "host",
      controlToken,
      afterSeq: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const bulkSync = vi.fn(async () => {
      throw new PresentationBroadcastConsistencyError(sessionId);
    });
    Object.assign(service, { syncManyByCredentialHash: bulkSync });

    await emitAck(host, "presentation.command", {
      sessionId,
      controlToken,
      commandId: crypto.randomUUID(),
      expectedRevision: 0,
      action: "advance",
    });

    await vi.waitFor(() => expect(bulkSync).toHaveBeenCalled());
    expect(participant.connected).toBe(true);
    expect(host.connected).toBe(true);
    expect(await realtime.io.fetchSockets()).toHaveLength(2);
    expect(await metrics.render()).toContain(
      'openround_presentation_broadcast_duration_seconds_count{outcome="error"}',
    );
  });

  it("coalesces overlapping room broadcasts into one queued rerun", async () => {
    const participant = await connect();
    const host = await connect();
    await emitAck(participant, "presentation.sync.request", {
      sessionId,
      projection: "participant",
      participantToken,
      afterSeq: 0,
    });
    await emitAck(host, "presentation.sync.request", {
      sessionId,
      projection: "host",
      controlToken,
      afterSeq: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));

    let release!: () => void;
    service.syncBarrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    service.maximumActiveSyncs = 0;
    const startingCalls = service.syncCalls;
    await emitAck(host, "presentation.command", {
      sessionId,
      controlToken,
      commandId: crypto.randomUUID(),
      expectedRevision: 0,
      action: "advance",
    });
    await vi.waitFor(() => expect(service.activeSyncs).toBe(2));
    await emitAck(host, "presentation.command", {
      sessionId,
      controlToken,
      commandId: crypto.randomUUID(),
      expectedRevision: 1,
      action: "advance",
    });
    release();
    service.syncBarrier = null;

    await vi.waitFor(() => expect(service.syncCalls - startingCalls).toBeGreaterThanOrEqual(4));
    await vi.waitFor(() => expect(service.activeSyncs).toBe(0));
    expect(service.maximumActiveSyncs).toBe(2);
  });
});

function mixedTransportContent(): PresentationContent {
  return PresentationContentSchema.parse({
    title: "Mixed transport presence",
    description: "",
    experiencePreset: { id: "focus", version: 1 },
    schemaVersion: 1,
    blocks: [
      {
        id: crypto.randomUUID(),
        kind: "question",
        citations: [],
        question: {
          id: crypto.randomUUID(),
          type: "single_select",
          prompt: "Which participant is still connected?",
          purpose: "diagnostic",
          confidence: "optional",
          delivery: "main",
          conceptKeys: ["presence"],
          linkedRecheckQuestionId: null,
          choices: [
            {
              id: crypto.randomUUID(),
              label: "The active socket participant",
              isCorrect: true,
              feedback: "Correct",
            },
            {
              id: crypto.randomUUID(),
              label: "Nobody",
              isCorrect: false,
              misconceptionKey: "socket-presence",
            },
          ],
          timeLimitSeconds: 60,
          basePoints: 1_000,
          explanation: "Socket presence survives a host-only fallback.",
          mediaId: null,
          mediaAlt: null,
          sourceCitations: [],
        },
      },
    ],
  });
}

describe("Presentation mixed-transport presence", () => {
  it("keeps an active socket participant connected in a REST host snapshot after heartbeat expiry", async () => {
    const mixedWorkspaceId = crypto.randomUUID();
    const mixedSessionId = crypto.randomUUID();
    const mixedParticipantId = crypto.randomUUID();
    const mixedParticipantToken = "mixed-participant-token-that-is-long-enough";
    const repository = new MemoryRepository({ initialWorkspaceId: mixedWorkspaceId });
    const presentationSessions = createPresentationSessionRepository(repository);
    const joinedAt = new Date();
    await presentationSessions.createSession({
      id: mixedSessionId,
      workspaceId: mixedWorkspaceId,
      presentationId: crypto.randomUUID(),
      presentationVersionId: crypto.randomUUID(),
      title: "Mixed transport presence",
      content: mixedTransportContent(),
      code: "7654321",
      status: "active",
      phase: "lobby",
      currentBlockIndex: -1,
      revision: 0,
      settings: { timeMode: "timed" },
      trustMode: "learning",
      eventSeq: 0,
      questionOpenedAt: null,
      questionClosesAt: null,
      createdBy: crypto.randomUUID(),
      createdAt: joinedAt,
      updatedAt: joinedAt,
      finishedAt: null,
      liveExpiresAt: new Date(joinedAt.getTime() + 60 * 60_000),
      retentionExpiresAt: new Date(joinedAt.getTime() + 24 * 60 * 60_000),
    });
    await presentationSessions.addParticipant({
      id: mixedParticipantId,
      workspaceId: mixedWorkspaceId,
      sessionId: mixedSessionId,
      nickname: "Socket learner",
      tokenHash: presentationParticipantTokenHash(mixedParticipantToken),
      joinedAt,
      lastSeenAt: joinedAt,
    });

    const httpServer = createServer();
    let realtime: Awaited<ReturnType<typeof attachRealtime>> | null = null;
    let client: Socket | null = null;
    try {
      await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
      const address = httpServer.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind");
      const mixedOrigin = `http://127.0.0.1:${address.port}`;
      const mixedConfig = ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: mixedOrigin,
        PUBLIC_API_URL: mixedOrigin,
        FEATURE_PRESENTATIONS: "true",
        LOG_LEVEL: "silent",
      });
      const service = new PresentationSessionService({
        repository,
        presentations: createPresentationRepository(repository),
        sessions: presentationSessions,
        config: mixedConfig,
        storage: new StorageService(mixedConfig, null),
      });
      const roundSessions = {
        subscribe: vi.fn(() => vi.fn()),
        subscribeAuxiliary: vi.fn(() => vi.fn()),
        disconnect: vi.fn().mockResolvedValue(undefined),
      } as unknown as SessionService;
      realtime = await attachRealtime(
        httpServer,
        roundSessions,
        mixedConfig,
        new MetricsService(),
        undefined,
        { service },
      );
      client = createClient(mixedOrigin, {
        transports: ["websocket"],
        reconnection: false,
        extraHeaders: { origin: mixedOrigin },
      });
      await new Promise<void>((resolve, reject) => {
        client!.once("connect", resolve);
        client!.once("connect_error", reject);
      });
      const synchronized = await emitAck<{ data: PresentationSyncResponse }>(
        client,
        "presentation.sync.request",
        {
          sessionId: mixedSessionId,
          projection: "participant",
          participantToken: mixedParticipantToken,
          afterSeq: 0,
        },
      );
      expect(synchronized.data.snapshot).toMatchObject({
        projection: "participant",
        participantId: mixedParticipantId,
      });
      expect(synchronized.data.snapshot).not.toHaveProperty("roomStatus");

      const heartbeatBeforeFallback = (
        await presentationSessions.listParticipants(mixedSessionId)
      )[0]!.lastSeenAt;
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(heartbeatBeforeFallback.getTime() + 60_000));

      const fallbackSnapshot = await service.getHostSnapshot(mixedWorkspaceId, mixedSessionId);
      expect(fallbackSnapshot.roomStatus).toMatchObject({
        joinedCount: 1,
        connectedCount: 1,
        notCurrentlyConnectedCount: 0,
      });
      expect(
        (await presentationSessions.listParticipants(mixedSessionId))[0]!.lastSeenAt.toISOString(),
      ).toBe(heartbeatBeforeFallback.toISOString());

      const serverParticipantSocket = [...realtime.io.sockets.sockets.values()].find(
        (socket) => socket.data.presentationParticipantId === mixedParticipantId,
      );
      if (!serverParticipantSocket) throw new Error("Participant socket was not bound");
      const serverDisconnected = new Promise<void>((resolve) =>
        serverParticipantSocket.once("disconnect", () => resolve()),
      );
      client.disconnect();
      await serverDisconnected;
      const afterDisconnect = await service.getHostSnapshot(mixedWorkspaceId, mixedSessionId);
      expect(afterDisconnect.roomStatus).toMatchObject({
        joinedCount: 1,
        connectedCount: 0,
        notCurrentlyConnectedCount: 1,
      });
    } finally {
      vi.useRealTimers();
      client?.disconnect();
      await realtime?.close();
      if (httpServer.listening) {
        await new Promise<void>((resolve, reject) =>
          httpServer.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  });

  it("includes a REST-fallback participant in socket host broadcasts without leaking staff presence", async () => {
    const mixedWorkspaceId = crypto.randomUUID();
    const mixedSessionId = crypto.randomUUID();
    const mixedParticipantId = crypto.randomUUID();
    const mixedParticipantToken = "rest-fallback-participant-token-that-is-long-enough";
    const mixedControlToken = "mixed-socket-host-token-that-is-long-enough";
    const repository = new MemoryRepository({ initialWorkspaceId: mixedWorkspaceId });
    const presentationSessions = createPresentationSessionRepository(repository);
    const createdAt = new Date();
    const staleHeartbeatAt = new Date(createdAt.getTime() - 60_000);
    const liveExpiresAt = new Date(createdAt.getTime() + 60 * 60_000);
    await presentationSessions.createSession({
      id: mixedSessionId,
      workspaceId: mixedWorkspaceId,
      presentationId: crypto.randomUUID(),
      presentationVersionId: crypto.randomUUID(),
      title: "Mixed transport presence",
      content: mixedTransportContent(),
      code: "7654322",
      status: "active",
      phase: "lobby",
      currentBlockIndex: -1,
      revision: 0,
      settings: { timeMode: "timed" },
      trustMode: "learning",
      eventSeq: 0,
      questionOpenedAt: null,
      questionClosesAt: null,
      createdBy: crypto.randomUUID(),
      createdAt,
      updatedAt: createdAt,
      finishedAt: null,
      liveExpiresAt,
      retentionExpiresAt: new Date(createdAt.getTime() + 24 * 60 * 60_000),
    });
    await presentationSessions.addParticipant({
      id: mixedParticipantId,
      workspaceId: mixedWorkspaceId,
      sessionId: mixedSessionId,
      nickname: "REST fallback learner",
      tokenHash: presentationParticipantTokenHash(mixedParticipantToken),
      joinedAt: staleHeartbeatAt,
      lastSeenAt: staleHeartbeatAt,
    });
    await presentationSessions.createCredential({
      id: crypto.randomUUID(),
      workspaceId: mixedWorkspaceId,
      sessionId: mixedSessionId,
      role: "host",
      tokenHash: presentationParticipantTokenHash(mixedControlToken),
      createdAt,
      expiresAt: liveExpiresAt,
      revokedAt: null,
    });

    const httpServer = createServer();
    let realtime: Awaited<ReturnType<typeof attachRealtime>> | null = null;
    let host: Socket | null = null;
    try {
      await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
      const address = httpServer.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind");
      const mixedOrigin = `http://127.0.0.1:${address.port}`;
      const mixedConfig = ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: mixedOrigin,
        PUBLIC_API_URL: mixedOrigin,
        FEATURE_PRESENTATIONS: "true",
        LOG_LEVEL: "silent",
      });
      const service = new PresentationSessionService({
        repository,
        presentations: createPresentationRepository(repository),
        sessions: presentationSessions,
        config: mixedConfig,
        storage: new StorageService(mixedConfig, null),
      });
      const roundSessions = {
        subscribe: vi.fn(() => vi.fn()),
        subscribeAuxiliary: vi.fn(() => vi.fn()),
        disconnect: vi.fn().mockResolvedValue(undefined),
      } as unknown as SessionService;
      realtime = await attachRealtime(
        httpServer,
        roundSessions,
        mixedConfig,
        new MetricsService(),
        undefined,
        { service },
      );
      host = createClient(mixedOrigin, {
        transports: ["websocket"],
        reconnection: false,
        extraHeaders: { origin: mixedOrigin },
      });
      await new Promise<void>((resolve, reject) => {
        host!.once("connect", resolve);
        host!.once("connect_error", reject);
      });

      const initiallyDisconnected = waitForRoomStatus(host, 0);
      const initialSync = await emitAck<{ data: PresentationSyncResponse }>(
        host,
        "presentation.sync.request",
        {
          sessionId: mixedSessionId,
          projection: "host",
          controlToken: mixedControlToken,
          afterSeq: 0,
        },
      );
      expect(initialSync.data.snapshot).toMatchObject({
        projection: "host",
        roomStatus: { joinedCount: 1, connectedCount: 0, notCurrentlyConnectedCount: 1 },
      });
      await expect(initiallyDisconnected).resolves.toMatchObject({ connectedCount: 0 });

      const restParticipant = await service.getParticipantSnapshot(
        mixedSessionId,
        mixedParticipantToken,
      );
      expect(restParticipant.snapshot).toMatchObject({
        projection: "participant",
        participantId: mixedParticipantId,
      });
      expect(restParticipant.snapshot).not.toHaveProperty("roomStatus");
      expect(restParticipant.snapshot).not.toHaveProperty("participants");

      const connectedBroadcast = waitForRoomStatus(host, 1);
      await emitAck(host, "presentation.sync.request", {
        sessionId: mixedSessionId,
        projection: "host",
        controlToken: mixedControlToken,
        afterSeq: 0,
      });
      await expect(connectedBroadcast).resolves.toMatchObject({
        joinedCount: 1,
        connectedCount: 1,
        notCurrentlyConnectedCount: 0,
      });

      const overlappingUnion = await service.syncManyByCredentialHash(
        [
          {
            sessionId: mixedSessionId,
            projection: "host",
            controlTokenHash: presentationParticipantTokenHash(mixedControlToken),
            afterSeq: 0,
          },
        ],
        new Set([mixedParticipantId]),
      );
      expect(overlappingUnion[0]?.snapshot).toMatchObject({
        projection: "host",
        roomStatus: { joinedCount: 1, connectedCount: 1, notCurrentlyConnectedCount: 0 },
      });
      expect(
        [...realtime.io.sockets.sockets.values()].filter(
          (socket) => socket.data.presentationProjection === "participant",
        ),
      ).toHaveLength(0);
    } finally {
      host?.disconnect();
      await realtime?.close();
      if (httpServer.listening) {
        await new Promise<void>((resolve, reject) =>
          httpServer.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  });
});

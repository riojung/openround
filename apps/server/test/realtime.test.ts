import { createServer, type Server as HttpServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import {
  acceptAnswer,
  addParticipant,
  applyHostCommand,
  createGameState,
} from "@openround/game-engine";
import { ConfigSchema } from "../src/config.js";
import { MetricsService } from "../src/metrics.js";
import { attachRealtime, snapshotSelector } from "../src/realtime.js";
import type { InteractionService } from "../src/interaction-service.js";
import {
  SessionError,
  type SessionAudienceEvent,
  type SessionService,
} from "../src/session-service.js";
import type { SessionAuxiliaryEvent } from "../src/session-service.js";

describe("realtime authorization", () => {
  let httpServer: HttpServer | undefined;
  let realtime: Awaited<ReturnType<typeof attachRealtime>> | undefined;
  let client: Socket | undefined;

  afterEach(async () => {
    client?.disconnect();
    if (realtime) await realtime.close();
    if (httpServer?.listening) {
      await new Promise<void>((resolve, reject) => {
        httpServer!.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("builds the complete private participant snapshot for a reveal broadcast", () => {
    const participantId = crypto.randomUUID();
    const correctChoiceId = crypto.randomUUID();
    const wrongChoiceId = crypto.randomUUID();
    let state = createGameState({
      sessionId: crypto.randomUUID(),
      code: "1234567",
      quiz: {
        title: "Realtime reveal",
        description: "",
        questions: [
          {
            id: crypto.randomUUID(),
            type: "single_select",
            prompt: "Choose the correct response",
            choices: [
              { id: correctChoiceId, label: "Correct", isCorrect: true },
              {
                id: wrongChoiceId,
                label: "Incorrect",
                isCorrect: false,
                feedback: "Review the explanation and try the recheck.",
              },
            ],
            timeLimitSeconds: 20,
            basePoints: 1_000,
            explanation: "The first response is correct.",
            mediaId: null,
            mediaAlt: null,
          },
        ],
      },
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    });
    state = addParticipant(state, {
      id: participantId,
      nickname: "Private learner",
      score: 0,
      correctCount: 0,
      acceptedResponseMs: 0,
      connected: true,
      kicked: false,
    }).state;
    state = applyHostCommand(state, {
      action: "start",
      commandId: crypto.randomUUID(),
      expectedVersion: state.version,
      nowMs: 1_000,
      newRoundId: () => crypto.randomUUID(),
    }).state;
    state = acceptAnswer(state, {
      answerId: crypto.randomUUID(),
      participantId,
      roundId: state.roundId!,
      response: { kind: "choice", choiceIds: [wrongChoiceId] },
      idempotencyKey: crypto.randomUUID(),
      nowMs: 2_000,
    }).state;
    for (const action of ["lock", "reveal"] as const) {
      state = applyHostCommand(state, {
        action,
        commandId: crypto.randomUUID(),
        expectedVersion: state.version,
        nowMs: 3_000,
        newRoundId: () => crypto.randomUUID(),
      }).state;
    }

    expect(snapshotSelector(state)("participant", participantId)).toMatchObject({
      myParticipantId: participantId,
      myCorrect: false,
      feedback: "Review the explanation and try the recheck.",
      correctResponse: { kind: "choice", choiceIds: [correctChoiceId] },
      participants: [expect.objectContaining({ id: participantId, nickname: "Private learner" })],
    });
  });

  it("does not promote or subscribe a socket when host authentication fails", async () => {
    const sessionId = crypto.randomUUID();
    const sessions = {
      subscribe: vi.fn(() => vi.fn()),
      subscribeAuxiliary: vi.fn(() => vi.fn()),
      hostCommand: vi
        .fn()
        .mockRejectedValue(new SessionError("UNAUTHORIZED", "Host token is invalid")),
    } as unknown as SessionService;
    httpServer = createServer();
    await new Promise<void>((resolve) => httpServer!.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind a port");
    const origin = `http://127.0.0.1:${address.port}`;
    realtime = await attachRealtime(
      httpServer,
      sessions,
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        WEB_ORIGIN: origin,
        PUBLIC_API_URL: origin,
        LOG_LEVEL: "silent",
      }),
      new MetricsService(),
    );
    client = createClient(origin, {
      transports: ["websocket"],
      extraHeaders: { origin },
    });
    await new Promise<void>((resolve, reject) => {
      client!.once("connect", resolve);
      client!.once("connect_error", reject);
    });

    const acknowledgement = await new Promise<unknown>((resolve) => {
      client!.emit(
        "host.command",
        {
          sessionId,
          hostToken: "invalid-host-token-long-enough",
          commandId: crypto.randomUUID(),
          expectedVersion: 0,
          action: "start",
        },
        resolve,
      );
    });

    expect(acknowledgement).toMatchObject({ error: { code: "UNAUTHORIZED" } });
    const sockets = await realtime.io.fetchSockets();
    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.data.role).toBeUndefined();
    expect(sockets[0]?.rooms.has(`session:${sessionId}`)).toBe(false);
  });

  it("disconnects a connected staff socket as soon as its credential is revoked", async () => {
    const sessionId = crypto.randomUUID();
    const credentialId = crypto.randomUUID();
    let auxiliaryListener: ((event: SessionAuxiliaryEvent) => Promise<void> | void) | undefined;
    const snapshot = {
      mode: "live" as const,
      stateSchemaVersion: 3,
      sessionId,
      code: "1234567",
      version: 0,
      seq: 0,
      phase: "lobby" as const,
      roundId: null,
      roundKind: "main" as const,
      sourceRoundId: null,
      questionIndex: null,
      questionPosition: null,
      questionCount: 1,
      question: null,
      deadline: null,
      participants: [],
      answerCount: 0,
      lobbyLocked: false,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy" as const,
        resultVisibility: "private" as const,
        allowLateJoin: true,
        nicknamePolicy: "custom" as const,
      },
      brandTheme: null,
      pausedRemainingMs: null,
      intervention: null,
    };
    const sessions = {
      subscribe: vi.fn(() => vi.fn()),
      subscribeAuxiliary: vi.fn(
        (listener: (event: SessionAuxiliaryEvent) => Promise<void> | void) => {
          auxiliaryListener = listener;
          return vi.fn();
        },
      ),
      sync: vi.fn().mockResolvedValue({ snapshot, replay: [], replayComplete: true }),
      realtimeStaffIdentity: vi.fn().mockResolvedValue({
        credentialId,
        expiresAtMs: Date.now() + 60_000,
        tokenHash: "staff-token-hash",
      }),
    } as unknown as SessionService;
    httpServer = createServer();
    await new Promise<void>((resolve) => httpServer!.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind a port");
    const origin = `http://127.0.0.1:${address.port}`;
    realtime = await attachRealtime(
      httpServer,
      sessions,
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        WEB_ORIGIN: origin,
        PUBLIC_API_URL: origin,
        LOG_LEVEL: "silent",
      }),
      new MetricsService(),
    );
    client = createClient(origin, {
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: { origin },
    });
    await new Promise<void>((resolve, reject) => {
      client!.once("connect", resolve);
      client!.once("connect_error", reject);
    });
    const synchronized = await new Promise<unknown>((resolve) => {
      client!.emit(
        "sync.request",
        {
          sessionId,
          role: "presenter",
          hostToken: "presenter-token-long-enough",
          lastSeq: 0,
        },
        resolve,
      );
    });
    expect(synchronized).toMatchObject({ data: { snapshot: { sessionId } } });
    const disconnected = new Promise<void>((resolve) =>
      client!.once("disconnect", () => resolve()),
    );

    await auxiliaryListener?.({
      sessionId,
      type: "session.staff.revoked",
      payload: { credentialId },
    });
    await disconnected;

    expect(client.connected).toBe(false);
  });

  it("revalidates staff credentials before sending private audience events", async () => {
    const sessionId = crypto.randomUUID();
    const credentialId = crypto.randomUUID();
    let audienceListener:
      ((event: SessionAudienceEvent) => boolean | void | Promise<boolean | void>) | undefined;
    const snapshot = {
      mode: "live" as const,
      stateSchemaVersion: 4,
      sessionId,
      code: "1234567",
      version: 0,
      seq: 0,
      phase: "lobby" as const,
      roundId: null,
      roundKind: "main" as const,
      sourceRoundId: null,
      questionIndex: null,
      questionPosition: null,
      questionCount: 1,
      question: null,
      deadline: null,
      participants: [],
      answerCount: 0,
      lobbyLocked: false,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy" as const,
        resultVisibility: "private" as const,
        allowLateJoin: true,
        nicknamePolicy: "custom" as const,
      },
      brandTheme: null,
      pausedRemainingMs: null,
      intervention: null,
    };
    const sessions = {
      subscribe: vi.fn(() => vi.fn()),
      subscribeAuxiliary: vi.fn(() => vi.fn()),
      subscribeAudience: vi.fn(
        (listener: (event: SessionAudienceEvent) => boolean | void | Promise<boolean | void>) => {
          audienceListener = listener;
          return vi.fn();
        },
      ),
      sync: vi.fn().mockResolvedValue({ snapshot, replay: [], replayComplete: true }),
      realtimeStaffIdentity: vi.fn().mockResolvedValue({
        credentialId,
        credentialRole: "cohost",
        expiresAtMs: Date.now() + 60_000,
        tokenHash: "revoked-staff-token-hash",
      }),
      revalidateRealtimeStaff: vi
        .fn()
        .mockRejectedValue(new SessionError("UNAUTHORIZED", "Credential revoked")),
    } as unknown as SessionService;
    const interactions = {
      realtimeSummaries: vi.fn().mockResolvedValue({
        publicSummary: {},
        moderatorSummary: {},
      }),
    } as unknown as InteractionService;
    httpServer = createServer();
    await new Promise<void>((resolve) => httpServer!.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind a port");
    const origin = `http://127.0.0.1:${address.port}`;
    realtime = await attachRealtime(
      httpServer,
      sessions,
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        WEB_ORIGIN: origin,
        PUBLIC_API_URL: origin,
        LOG_LEVEL: "silent",
      }),
      new MetricsService(),
      interactions,
    );
    client = createClient(origin, {
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: { origin },
    });
    await new Promise<void>((resolve, reject) => {
      client!.once("connect", resolve);
      client!.once("connect_error", reject);
    });
    await new Promise<void>((resolve) => {
      client!.emit(
        "sync.request",
        {
          sessionId,
          role: "host",
          hostToken: "cohost-token-long-enough",
          lastSeq: 0,
        },
        () => resolve(),
      );
    });
    const disconnected = new Promise<void>((resolve) =>
      client!.once("disconnect", () => resolve()),
    );

    await audienceListener?.({
      eventId: crypto.randomUUID(),
      sessionId,
      audienceSeq: 1,
      type: "audience.signal.updated",
      payload: {
        participantId: crypto.randomUUID(),
        contextKey: "lobby",
        signal: "unsure",
      },
      createdAt: new Date(),
    });
    await disconnected;

    expect(sessions.revalidateRealtimeStaff).toHaveBeenCalledWith(
      sessionId,
      "revoked-staff-token-hash",
      "host",
    );
    expect(client.connected).toBe(false);
  });

  it("keeps coalesced audience events pending until the delayed summary is emitted", async () => {
    const sessionId = crypto.randomUUID();
    let audienceListener:
      ((event: SessionAudienceEvent) => boolean | void | Promise<boolean | void>) | undefined;
    const sessions = {
      subscribe: vi.fn(() => vi.fn()),
      subscribeAuxiliary: vi.fn(() => vi.fn()),
      subscribeAudience: vi.fn(
        (listener: (event: SessionAudienceEvent) => boolean | void | Promise<boolean | void>) => {
          audienceListener = listener;
          return vi.fn();
        },
      ),
    } as unknown as SessionService;
    const completeOutboxEvents = vi.fn().mockResolvedValue(undefined);
    const interactions = {
      realtimeSummaries: vi.fn().mockResolvedValue({
        publicSummary: {},
        moderatorSummary: {},
      }),
      completeOutboxEvents,
    } as unknown as InteractionService;
    httpServer = createServer();
    realtime = await attachRealtime(
      httpServer,
      sessions,
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        LOG_LEVEL: "silent",
      }),
      new MetricsService(),
      interactions,
    );
    const event = (audienceSeq: number): SessionAudienceEvent => ({
      eventId: crypto.randomUUID(),
      sessionId,
      audienceSeq,
      type: "audience.summary.updated",
      payload: {},
      createdAt: new Date(),
    });

    expect(await audienceListener?.(event(1))).toBe(true);
    const deferred = event(2);
    expect(await audienceListener?.(deferred)).toBe(false);
    expect(completeOutboxEvents).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(completeOutboxEvents).toHaveBeenCalledWith(new Set([deferred.eventId]));
    });
  });
});

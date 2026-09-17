import type { Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createAdapter } from "@socket.io/redis-streams-adapter";
import Redis from "ioredis";
import { Server } from "socket.io";
import { ZodError } from "zod";
import {
  AnswerSubmitSchema,
  HostCommandSchema,
  JoinRequestSchema,
  SyncRequestSchema,
  type SessionSnapshot,
} from "@openround/contracts";
import { snapshotForRole, type GameState } from "@openround/game-engine";
import type { AppConfig } from "./config.js";
import type { MetricsService } from "./metrics.js";
import { originAllowed } from "./origin.js";
import type { SessionService } from "./session-service.js";

const CLIENT_EVENT_RECEIPT_TIMEOUT_MS = 5_000;

type RealtimeRole = "host" | "presenter" | "participant";

function socketError(error: unknown) {
  if (error instanceof ZodError) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: "The realtime payload is invalid",
      },
    };
  }
  const candidate = error as { code?: string; message?: string };
  return {
    error: {
      code: candidate.code ?? "INTERNAL_ERROR",
      message: candidate.message ?? "The realtime request failed",
    },
  };
}

function consumeRateLimit(
  buckets: Record<string, { startedAt: number; count: number }>,
  event: string,
  maximum: number,
) {
  const now = Date.now();
  const bucket = buckets[event];
  if (!bucket || now - bucket.startedAt >= 10_000) {
    buckets[event] = { startedAt: now, count: 1 };
    return true;
  }
  bucket.count += 1;
  return bucket.count <= maximum;
}

export function snapshotSelector(state: GameState) {
  const staffSnapshot = snapshotForRole(state, { role: "host" });
  const participantBase = snapshotForRole(state, { role: "participant" });

  return (role: RealtimeRole, participantId?: string): SessionSnapshot => {
    if (role !== "participant") return staffSnapshot;
    return participantId
      ? snapshotForRole(state, { role: "participant", participantId })
      : participantBase;
  };
}

function emitTrackedEvent(
  socket: Awaited<ReturnType<Server["fetchSockets"]>>[number],
  eventType: string,
  envelope: unknown,
  role: RealtimeRole,
  metrics: MetricsService,
) {
  const startedAt = performance.now();
  socket
    .timeout(CLIENT_EVENT_RECEIPT_TIMEOUT_MS)
    .emit(eventType, envelope, (error: Error | null) => {
      metrics.observeClientEventReceipt(
        eventType,
        role,
        error ? "timeout" : "acknowledged",
        (performance.now() - startedAt) / 1_000,
      );
    });
}

export async function attachRealtime(
  httpServer: HttpServer,
  sessions: SessionService,
  config: AppConfig,
  metrics: MetricsService,
) {
  let closing = false;
  const adapterRedis = config.REDIS_URL
    ? new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: null })
    : null;
  if (adapterRedis) await adapterRedis.connect();
  const io = new Server(httpServer, {
    adapter: adapterRedis
      ? createAdapter(adapterRedis, {
          streamName: "openround:socket.io",
          sessionKeyPrefix: "openround:socket.io:session:",
          maxLen: 10_000,
          onlyPlaintext: true,
        })
      : undefined,
    cors: { origin: config.WEB_ORIGIN, credentials: true },
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60_000,
      skipMiddlewares: false,
    },
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 20_000,
    pingTimeout: 10_000,
    allowRequest: (request, callback) => {
      callback(
        null,
        originAllowed({
          origin: request.headers.origin,
          host: request.headers.host,
          forwardedProto: request.headers["x-forwarded-proto"],
          encrypted: Boolean((request.socket as { encrypted?: boolean }).encrypted),
          configuredOrigin: config.WEB_ORIGIN,
        }),
      );
    },
  });

  sessions.subscribe(async ({ state, events, reportId }) => {
    const startedAt = performance.now();
    try {
      const sockets = await io.in(`session:${state.sessionId}`).fetchSockets();
      const selectSnapshot = snapshotSelector(state);
      for (const event of events) {
        const staffEnvelope = sessions.envelope(state, event, {
          snapshot: selectSnapshot("host"),
          ...(reportId ? { reportId } : {}),
        });
        for (const socket of sockets) {
          const role = socket.data.role as RealtimeRole | undefined;
          if (!role) continue;
          if (role !== "participant") {
            const staffExpiresAtMs = socket.data.staffExpiresAtMs as number | undefined;
            if (staffExpiresAtMs !== undefined && staffExpiresAtMs <= Date.now()) {
              socket.disconnect(true);
              continue;
            }
            const staffTokenHash = socket.data.staffTokenHash as string | undefined;
            if (staffTokenHash) {
              try {
                await sessions.revalidateRealtimeStaff(state.sessionId, staffTokenHash, role);
              } catch {
                socket.disconnect(true);
                continue;
              }
            }
            emitTrackedEvent(socket, event.type, staffEnvelope, role, metrics);
            continue;
          }
          const snapshot = selectSnapshot(role, socket.data.participantId as string | undefined);
          emitTrackedEvent(
            socket,
            event.type,
            sessions.envelope(state, event, { snapshot, ...(reportId ? { reportId } : {}) }),
            role,
            metrics,
          );
        }
      }
      metrics.observeBroadcast("success", (performance.now() - startedAt) / 1_000);
    } catch (error) {
      metrics.observeBroadcast("error", (performance.now() - startedAt) / 1_000);
      throw error;
    }
  });

  sessions.subscribeAuxiliary(async (event) => {
    const sockets = await io.in(`session:${event.sessionId}`).fetchSockets();
    if (event.type === "session.staff.revoked") {
      const credentialId = event.payload.credentialId;
      for (const socket of sockets) {
        if (socket.data.staffCredentialId === credentialId) socket.disconnect(true);
      }
      return;
    }
    const envelope = {
      eventId: randomUUID(),
      sessionId: event.sessionId,
      sessionVersion: 0,
      seq: 0,
      type: event.type,
      schemaVersion: 2 as const,
      serverTime: new Date().toISOString(),
      payload: event.payload,
    };
    for (const socket of sockets) {
      const role = socket.data.role as RealtimeRole | undefined;
      if (role) emitTrackedEvent(socket, event.type, envelope, role, metrics);
    }
  });

  io.on("connection", (socket) => {
    metrics.socketConnected();
    const rateLimits: Record<string, { startedAt: number; count: number }> = {};

    socket.on("session.join", async (raw, acknowledge) => {
      if (typeof acknowledge !== "function") return;
      if (!consumeRateLimit(rateLimits, "session.join", 10)) {
        acknowledge({ error: { code: "RATE_LIMITED", message: "Too many join attempts" } });
        return;
      }
      try {
        const input = JoinRequestSchema.parse(raw);
        const joined = await sessions.join(input);
        socket.data.role = "participant";
        socket.data.participantId = joined.participantId;
        socket.data.participantToken = joined.participantToken;
        await socket.join(`session:${joined.snapshot.sessionId}`);
        acknowledge({ data: joined });
      } catch (error) {
        acknowledge(socketError(error));
      }
    });

    socket.on("answer.submit", async (raw, acknowledge) => {
      if (typeof acknowledge !== "function") return;
      if (!consumeRateLimit(rateLimits, "answer.submit", 30)) {
        acknowledge({ error: { code: "RATE_LIMITED", message: "Too many answer attempts" } });
        return;
      }
      try {
        const input = AnswerSubmitSchema.parse(raw);
        const result = await sessions.answer(input);
        acknowledge({ data: result });
      } catch (error) {
        acknowledge(socketError(error));
      }
    });

    socket.on("host.command", async (raw, acknowledge) => {
      if (typeof acknowledge !== "function") return;
      if (!consumeRateLimit(rateLimits, "host.command", 30)) {
        acknowledge({ error: { code: "RATE_LIMITED", message: "Too many host commands" } });
        return;
      }
      try {
        const input = HostCommandSchema.parse(raw);
        const snapshot = await sessions.hostCommand(input);
        const staff = await sessions.realtimeStaffIdentity(
          input.sessionId,
          input.hostToken,
          "host",
        );
        socket.data.role = "host";
        socket.data.participantId = undefined;
        socket.data.participantToken = undefined;
        socket.data.staffCredentialId = staff.credentialId ?? undefined;
        socket.data.staffExpiresAtMs = staff.expiresAtMs ?? undefined;
        socket.data.staffTokenHash = staff.tokenHash;
        await socket.join(`session:${input.sessionId}`);
        acknowledge({ data: { snapshot } });
      } catch (error) {
        acknowledge(socketError(error));
      }
    });

    socket.on("sync.request", async (raw, acknowledge) => {
      if (typeof acknowledge !== "function") return;
      if (!consumeRateLimit(rateLimits, "sync.request", 20)) {
        acknowledge({ error: { code: "RATE_LIMITED", message: "Too many sync requests" } });
        return;
      }
      try {
        const input = SyncRequestSchema.parse(raw);
        const synchronized = await sessions.sync(input);
        const staff =
          input.role !== "participant" && input.hostToken
            ? await sessions.realtimeStaffIdentity(input.sessionId, input.hostToken, input.role)
            : null;
        socket.data.role = input.role;
        socket.data.participantToken = input.participantToken;
        socket.data.participantId = synchronized.snapshot.myParticipantId ?? undefined;
        socket.data.staffCredentialId = staff?.credentialId ?? undefined;
        socket.data.staffExpiresAtMs = staff?.expiresAtMs ?? undefined;
        socket.data.staffTokenHash = staff?.tokenHash ?? undefined;
        await socket.join(`session:${input.sessionId}`);
        acknowledge({ data: synchronized });
      } catch (error) {
        acknowledge(socketError(error));
      }
    });

    socket.on("disconnect", () => {
      metrics.socketDisconnected();
      const participantToken = socket.data.participantToken as string | undefined;
      if (participantToken && !closing) void sessions.disconnect(participantToken);
    });
  });

  return {
    io,
    async close() {
      closing = true;
      await new Promise<void>((resolve) => io.close(() => resolve()));
      if (adapterRedis && adapterRedis.status !== "end") await adapterRedis.quit();
    },
  };
}

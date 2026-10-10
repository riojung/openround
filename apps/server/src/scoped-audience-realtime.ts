import type { Server } from "socket.io";
import { ZodError } from "zod";
import {
  ScopedAudienceEventSchema,
  ScopedAudienceSubscribeSchema,
  ScopedAudienceSyncRequestSchema,
  type ScopedAudienceEvent,
} from "@openround/contracts";
import type { AudienceScopeService } from "./audience-scope-service.js";
import { hashToken } from "./security.js";

type ScopedAudienceBinding = {
  kind: "round" | "presentation";
  scopeId: string;
  tokenHash: string;
};

const room = (kind: "round" | "presentation", scopeId: string) =>
  `audience-scope:${kind}:${scopeId}`;

function safeError(error: unknown) {
  if (error instanceof ZodError)
    return { error: { code: "VALIDATION_ERROR", message: "The audience request is invalid" } };
  const code = (error as { code?: string }).code;
  return {
    error: {
      code: code === "UNAUTHORIZED" || code === "NOT_FOUND" ? code : "DEPENDENCY_UNAVAILABLE",
      message:
        code === "UNAUTHORIZED" || code === "NOT_FOUND"
          ? "Audience access is invalid or expired; rejoin the room"
          : "Audience synchronization is temporarily unavailable; retry",
    },
  };
}

export function registerScopedAudienceRealtime(io: Server, service: AudienceScopeService) {
  io.on("connection", (socket) => {
    // A separate binding never mutates the legacy game or Presentation socket role.
    // Socket data is serialized by the Redis adapter; never retain a bearer credential here.
    const subscriptions: Record<string, ScopedAudienceBinding> = Object.create(null);
    socket.data.scopedAudience = subscriptions;
    let windowStarted = Date.now();
    let requests = 0;
    const allowed = () => {
      if (Date.now() - windowStarted >= 10_000) {
        windowStarted = Date.now();
        requests = 0;
      }
      return ++requests <= 20;
    };
    socket.on("audience.scope.subscribe", async (raw, acknowledge) => {
      if (typeof acknowledge !== "function") return;
      if (!allowed()) {
        acknowledge({
          error: { code: "RATE_LIMITED", message: "Wait before synchronizing again" },
        });
        return;
      }
      try {
        const input = ScopedAudienceSubscribeSchema.parse(raw);
        const scope = await service.snapshot(input.kind, input.scopeId, input.token);
        const key = room(input.kind, input.scopeId);
        if (!subscriptions[key] && Object.keys(subscriptions).length >= 5) {
          acknowledge({
            error: {
              code: "RATE_LIMITED",
              message: "Too many audience subscriptions on this connection",
            },
          });
          return;
        }
        subscriptions[key] = {
          kind: input.kind,
          scopeId: input.scopeId,
          tokenHash: hashToken(input.token),
        };
        await socket.join(key);
        acknowledge({ data: { scope } });
      } catch (error) {
        acknowledge(safeError(error));
      }
    });
    socket.on("audience.scope.sync.request", async (raw, acknowledge) => {
      if (typeof acknowledge !== "function") return;
      if (!allowed()) {
        acknowledge({
          error: { code: "RATE_LIMITED", message: "Wait before synchronizing again" },
        });
        return;
      }
      try {
        const input = ScopedAudienceSyncRequestSchema.parse(raw);
        acknowledge({
          data: await service.sync(input.kind, input.scopeId, input.token, input.limit),
        });
      } catch (error) {
        acknowledge(safeError(error));
      }
    });
  });

  return {
    async publish(raw: ScopedAudienceEvent) {
      // Only strict metadata invalidations contain no text, identities, or answers. Fetch visible
      // current state after each notice; never broadcast arbitrary outbox payloads.
      const event = ScopedAudienceEventSchema.parse(raw);
      const key = room("presentation", event.scopeId);
      for (const socket of await io.in(key).fetchSockets()) {
        const subscription = socket.data.scopedAudience?.[key] as ScopedAudienceBinding | undefined;
        if (
          !subscription ||
          subscription.kind !== "presentation" ||
          subscription.scopeId !== event.scopeId
        )
          continue;
        try {
          await service.snapshotPresentationByTokenHash(event.scopeId, subscription.tokenHash);
        } catch (error) {
          if (["UNAUTHORIZED", "NOT_FOUND"].includes((error as { code?: string }).code ?? "")) {
            delete socket.data.scopedAudience[key];
            await socket.leave(key);
            continue;
          }
          throw error; // A transient repository failure must not mark a committed event delivered.
        }
        socket.emit(event.type, event);
      }
    },
  };
}

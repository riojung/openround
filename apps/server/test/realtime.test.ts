import { createServer, type Server as HttpServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import { ConfigSchema } from "../src/config.js";
import { MetricsService } from "../src/metrics.js";
import { attachRealtime } from "../src/realtime.js";
import { SessionError, type SessionService } from "../src/session-service.js";

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

  it("does not promote or subscribe a socket when host authentication fails", async () => {
    const sessionId = crypto.randomUUID();
    const sessions = {
      subscribe: vi.fn(() => vi.fn()),
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
});

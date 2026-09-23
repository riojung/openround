import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("trusted proxy client addresses", () => {
  it("keys rate limits by forwarded clients only when the direct peer is trusted", async () => {
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        TRUSTED_PROXY_IP: "127.0.0.1",
        LOG_LEVEL: "silent",
      }),
      { cache: new MemorySessionCache() },
    );
    app = built.app;
    app.get(
      "/test/client-rate-limit",
      { config: { rateLimit: { max: 1, timeWindow: "1 minute" } } },
      async (request) => ({ ip: request.ip }),
    );

    const throughTrustedProxy = (clientIp: string) =>
      app!.inject({
        method: "GET",
        url: "/test/client-rate-limit",
        remoteAddress: "127.0.0.1",
        headers: { "x-forwarded-for": clientIp },
      });

    const firstClient = await throughTrustedProxy("198.51.100.10");
    const secondClient = await throughTrustedProxy("198.51.100.11");
    const firstClientAgain = await throughTrustedProxy("198.51.100.10");

    expect(firstClient).toMatchObject({ statusCode: 200 });
    expect(firstClient.json()).toEqual({ ip: "198.51.100.10" });
    expect(secondClient).toMatchObject({ statusCode: 200 });
    expect(secondClient.json()).toEqual({ ip: "198.51.100.11" });
    expect(firstClientAgain).toMatchObject({ statusCode: 429 });

    const directRequest = (spoofedClientIp: string) =>
      app!.inject({
        method: "GET",
        url: "/test/client-rate-limit",
        remoteAddress: "127.0.0.2",
        headers: { "x-forwarded-for": spoofedClientIp },
      });

    const directFirst = await directRequest("203.0.113.10");
    const directWithDifferentSpoof = await directRequest("203.0.113.11");

    expect(directFirst).toMatchObject({ statusCode: 200 });
    expect(directFirst.json()).toEqual({ ip: "127.0.0.2" });
    expect(directWithDifferentSpoof).toMatchObject({ statusCode: 429 });
  });
});

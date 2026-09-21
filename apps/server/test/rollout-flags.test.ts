import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

let app: FastifyInstance | undefined;

async function signIn(target: FastifyInstance) {
  const magic = await target.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: {
      email: "rollout-owner@example.com",
      segment: "workplace",
      acceptPolicies: true,
    },
  });
  const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await target.inject({ method: "GET", url: `/v1/auth/verify?token=${token}` });
  const setCookie = verified.headers["set-cookie"]!;
  return (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
}

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe("professional workspace rollout flags", () => {
  it("fails closed by default and does not register Presentation or Group routes", async () => {
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        LOG_LEVEL: "silent",
      }),
      { repository: new MemoryRepository(), cache: new MemorySessionCache() },
    );
    app = built.app;
    const cookie = await signIn(app);

    const account = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
    expect(account.json()).toMatchObject({
      productFeatures: {
        workspaceShell: false,
        builderV2: false,
        presentations: false,
        groups: false,
        discover: false,
      },
    });
    expect((await app.inject({ method: "GET", url: "/v1/features" })).json()).toMatchObject({
      presentations: false,
    });
    expect(
      (await app.inject({ method: "GET", url: "/v1/presentations", headers: { cookie } }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: "/v1/presentation-sessions", headers: { cookie } }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: "/v1/groups", headers: { cookie } })).statusCode,
    ).toBe(404);
  });

  it("keeps globally enabled professional features closed outside the beta allowlist", async () => {
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        FEATURE_UX_BETA: "true",
        FEATURE_WORKSPACE_SHELL: "true",
        FEATURE_BUILDER_V2: "true",
        FEATURE_PRESENTATIONS: "true",
        FEATURE_GROUPS: "true",
        FEATURE_DISCOVER: "true",
        LOG_LEVEL: "silent",
      }),
      { repository: new MemoryRepository(), cache: new MemorySessionCache() },
    );
    app = built.app;
    const cookie = await signIn(app);

    const account = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
    expect(account.json()).toMatchObject({
      productFeatures: {
        uxBeta: false,
        workspaceShell: false,
        builderV2: false,
        presentations: false,
        groups: false,
        discover: false,
      },
    });
    expect((await app.inject({ method: "GET", url: "/v1/features" })).json()).toMatchObject({
      presentations: true,
    });
    expect(
      (await app.inject({ method: "GET", url: "/v1/presentations", headers: { cookie } }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: "/v1/presentation-sessions", headers: { cookie } }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: "/v1/groups", headers: { cookie } })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: "/v1/home/summary", headers: { cookie } }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: "/v1/library/favorites", headers: { cookie } }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: "/v1/quizzes", headers: { cookie } })).statusCode,
    ).toBe(200);
  });

  it("exposes independently enabled professional features to an allowlisted workspace", async () => {
    const workspaceId = randomUUID();
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        FEATURE_UX_BETA: "true",
        UX_BETA_WORKSPACE_ALLOWLIST: workspaceId,
        FEATURE_WORKSPACE_SHELL: "true",
        FEATURE_BUILDER_V2: "true",
        FEATURE_PRESENTATIONS: "true",
        FEATURE_GROUPS: "true",
        FEATURE_DISCOVER: "true",
        LOG_LEVEL: "silent",
      }),
      {
        repository: new MemoryRepository({ initialWorkspaceId: workspaceId }),
        cache: new MemorySessionCache(),
      },
    );
    app = built.app;
    const cookie = await signIn(app);

    const account = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
    expect(account.json()).toMatchObject({
      productFeatures: {
        uxBeta: true,
        workspaceShell: true,
        builderV2: true,
        presentations: true,
        groups: true,
        discover: true,
      },
    });
    for (const url of [
      "/v1/presentations",
      "/v1/presentation-sessions",
      "/v1/groups",
      "/v1/home/summary",
      "/v1/library/favorites",
    ]) {
      expect((await app.inject({ method: "GET", url, headers: { cookie } })).statusCode).toBe(200);
    }
  });

  it("allows public Presentation participation only while the owning workspace is eligible", async () => {
    const workspaceId = randomUUID();
    const config = ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
      FEATURE_UX_BETA: "true",
      UX_BETA_WORKSPACE_ALLOWLIST: workspaceId,
      FEATURE_PRESENTATIONS: "true",
      LOG_LEVEL: "silent",
    });
    const built = await buildApp(config, {
      repository: new MemoryRepository({ initialWorkspaceId: workspaceId }),
      cache: new MemorySessionCache(),
    });
    app = built.app;
    const cookie = await signIn(app);
    const account = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
    const creator = account.json<{ creator: { userId: string } }>().creator;
    const now = new Date();
    await built.presentationSessions.createSession({
      id: randomUUID(),
      workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: "Allowlisted briefing",
      content: {
        title: "Allowlisted briefing",
        description: "",
        experiencePreset: { id: "focus", version: 1 },
        schemaVersion: 1,
        blocks: [
          {
            id: randomUUID(),
            kind: "content",
            layout: "title_body",
            title: "Welcome",
            body: "A source-grounded briefing.",
            mediaId: null,
            mediaAlt: null,
            speakerNotes: "",
          },
        ],
      },
      code: "7654321",
      status: "active",
      phase: "lobby",
      currentBlockIndex: -1,
      revision: 0,
      createdBy: creator.userId,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      liveExpiresAt: new Date(now.getTime() + 86_400_000),
      retentionExpiresAt: new Date(now.getTime() + 86_400_000),
    });

    config.UX_BETA_WORKSPACE_ALLOWLIST.splice(0);
    const excluded = await app.inject({
      method: "POST",
      url: "/v1/presentation-sessions/join",
      payload: { code: "7654321", nickname: "Learner" },
    });
    expect(excluded.statusCode).toBe(404);
    expect(excluded.json()).toMatchObject({ error: { code: "NOT_FOUND" } });

    config.UX_BETA_WORKSPACE_ALLOWLIST.push(workspaceId);
    const eligible = await app.inject({
      method: "POST",
      url: "/v1/presentation-sessions/join",
      payload: { code: "7654321", nickname: "Learner" },
    });
    expect(eligible.statusCode).toBe(201);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { MemoryRepository } from "@openround/db";
import type { AuthoringAssistant } from "../src/authoring-assistant.js";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

async function signIn(target: FastifyInstance, email: string) {
  const requested = await target.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "education", acceptPolicies: true },
  });
  const token = new URL(requested.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await target.inject({ method: "GET", url: `/v1/auth/verify?token=${token}` });
  const setCookie = verified.headers["set-cookie"]!;
  return (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
}

function testAssistant(): AuthoringAssistant {
  return {
    providerName: "approved-test-provider",
    modelName: "grounded-test-model",
    generate: vi.fn().mockResolvedValue({
      title: "Energy isolation",
      description: "Generated for human review.",
      conceptKey: "energy-isolation",
      citations: [
        {
          locator: "paragraph 1",
          excerpt: "Lockout physically isolates hazardous energy",
        },
      ],
      main: {
        type: "single_select",
        prompt: "What physically isolates hazardous energy?",
        purpose: "diagnostic",
        confidence: "required",
        explanation: "Lockout provides physical isolation.",
        timeLimitSeconds: 30,
        citationIndexes: [0],
        choices: [
          {
            label: "Lockout",
            isCorrect: true,
            rationale: "It provides physical isolation.",
            misconceptionLabel: null,
          },
          {
            label: "A warning sign",
            isCorrect: false,
            rationale: "A sign does not isolate energy.",
            misconceptionLabel: "warning-is-isolation",
          },
        ],
      },
      recheck: {
        type: "single_select",
        prompt: "Which action separates a machine from hazardous energy before maintenance?",
        purpose: "practice",
        confidence: "optional",
        explanation: "Apply lockout before maintenance.",
        timeLimitSeconds: 30,
        citationIndexes: [0],
        choices: [
          {
            label: "Apply lockout",
            isCorrect: true,
            rationale: "It separates the energy source.",
            misconceptionLabel: null,
          },
          {
            label: "Post a reminder",
            isCorrect: false,
            rationale: "A reminder is not isolation.",
            misconceptionLabel: "communication-is-control",
          },
        ],
      },
    }),
  };
}

function config() {
  return ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    COMMUNITY_MODE: "false",
    AUTH_DEBUG_MAGIC_LINKS: "true",
    LOG_LEVEL: "silent",
  });
}

describe("authoring assistant API", () => {
  it("reports a disabled deployment and refuses to retain a source", async () => {
    const repository = new MemoryRepository();
    const built = await buildApp(config(), {
      repository,
      cache: new MemorySessionCache(),
      authoringAssistant: null,
    });
    app = built.app;
    const cookie = await signIn(app, "disabled-authoring@example.com");

    const status = await app.inject({
      method: "GET",
      url: "/v1/authoring/status",
      headers: { cookie },
    });
    expect(status.json()).toMatchObject({
      status: { enabled: false, monthlyLimit: 3, used: 0, remaining: 3 },
    });
    const attempted = await app.inject({
      method: "POST",
      url: "/v1/authoring/jobs",
      headers: { cookie },
      payload: {
        sourceType: "pasted_text",
        sourceName: "Private notes",
        text: "This source is long enough to pass request validation but must not be stored.",
      },
    });
    expect(attempted.statusCode).toBe(503);
    expect(attempted.json()).toMatchObject({ error: { code: "AUTHORING_DISABLED" } });
    expect(repository.authoringJobs.size).toBe(0);
  });

  it("queues, processes, reviews, and explicitly applies an unpublished draft", async () => {
    const repository = new MemoryRepository();
    const assistant = testAssistant();
    const built = await buildApp(config(), {
      repository,
      cache: new MemorySessionCache(),
      authoringAssistant: assistant,
    });
    app = built.app;
    const cookie = await signIn(app, "enabled-authoring@example.com");
    const source =
      "Lockout physically isolates hazardous energy before maintenance. A warning sign does not provide isolation.";

    const queued = await app.inject({
      method: "POST",
      url: "/v1/authoring/jobs",
      headers: { cookie },
      payload: { sourceType: "pasted_text", sourceName: "Safety guide", text: source },
    });
    expect(queued.statusCode).toBe(202);
    expect(queued.body).not.toContain(source);
    const jobId = queued.json<{ job: { id: string } }>().job.id;

    const workerResult = await built.authoringWorker.runOnce();
    const persistedJob = repository.authoringJobs.get(jobId);
    expect(workerResult, persistedJob?.lastError ?? "Authoring worker failed").toBe("completed");
    const reviewed = await app.inject({
      method: "GET",
      url: `/v1/authoring/jobs/${jobId}`,
      headers: { cookie },
    });
    expect(reviewed.json()).toMatchObject({
      job: {
        status: "ready",
        output: {
          provider: "approved-test-provider",
          checkpointSet: { title: "Energy isolation" },
        },
      },
    });
    expect(reviewed.body).not.toContain(source);

    const applied = await app.inject({
      method: "POST",
      url: `/v1/authoring/jobs/${jobId}/apply`,
      headers: { cookie },
      payload: {},
    });
    expect(applied.statusCode).toBe(201);
    expect(applied.json()).toMatchObject({
      quiz: { status: "draft", currentVersionId: null, tags: ["ai-assisted"] },
    });
    expect(repository.audits.map((audit) => audit.action)).toEqual(
      expect.arrayContaining(["authoring.job.create", "authoring.job.apply"]),
    );
  });

  it("accepts a private file request above the global JSON body limit", async () => {
    const repository = new MemoryRepository();
    const built = await buildApp(config(), {
      repository,
      cache: new MemorySessionCache(),
      authoringAssistant: testAssistant(),
    });
    app = built.app;
    const cookie = await signIn(app, "file-authoring@example.com");
    const fakePdf = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(180_000, 32)]);
    const queued = await app.inject({
      method: "POST",
      url: "/v1/authoring/jobs",
      headers: { cookie },
      payload: {
        sourceType: "pdf",
        sourceName: "Large handout.pdf",
        mimeType: "application/pdf",
        encoding: "base64",
        data: fakePdf.toString("base64"),
      },
    });
    expect(queued.statusCode).toBe(202);
  });
});

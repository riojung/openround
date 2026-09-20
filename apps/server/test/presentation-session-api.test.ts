import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRepository, type PresentationSessionRecord } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

let app: FastifyInstance | undefined;
const BETA_WORKSPACE_ID = "10000000-0000-4000-8000-000000000002";

async function signIn(target: FastifyInstance) {
  const magic = await target.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: {
      email: "presentation-host@example.com",
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

describe("live Presentation sessions", () => {
  it("hosts mixed blocks, protects answer keys, reconnects, and produces timeline evidence", async () => {
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        FEATURE_UX_BETA: "true",
        UX_BETA_WORKSPACE_ALLOWLIST: BETA_WORKSPACE_ID,
        FEATURE_PRESENTATIONS: "true",
        LOG_LEVEL: "silent",
      }),
      {
        repository: new MemoryRepository({ initialWorkspaceId: BETA_WORKSPACE_ID }),
        cache: new MemorySessionCache(),
      },
    );
    app = built.app;
    const cookie = await signIn(app);
    const created = await app.inject({
      method: "POST",
      url: "/v1/presentations",
      headers: { cookie },
      payload: { title: "Evidence review", description: "A mixed session" },
    });
    const presentation = created.json<{
      presentation: { id: string; draft: { blocks: Array<{ id: string }> } };
    }>().presentation;
    const answerId = randomUUID();
    const distractorId = randomUUID();
    const recheckAnswerId = randomUUID();
    const recheckDistractorId = randomUUID();
    const diagnosticQuestionId = randomUUID();
    const recheckQuestionId = randomUUID();
    const draft = {
      title: "Evidence review",
      description: "A mixed session",
      experiencePreset: { id: "focus" as const, version: 1 as const },
      schemaVersion: 1,
      blocks: [
        {
          id: presentation.draft.blocks[0]!.id,
          kind: "content",
          layout: "title_body",
          title: "Review the source",
          body: "Observe first, then respond.",
          mediaId: null,
          mediaAlt: null,
          speakerNotes: "Facilitator-only cue",
        },
        {
          id: randomUUID(),
          kind: "question",
          question: {
            id: diagnosticQuestionId,
            type: "single_select",
            prompt: "Which claim is supported?",
            choices: [
              { id: answerId, label: "Observed behaviour", isCorrect: true },
              { id: distractorId, label: "Unverified assumption", isCorrect: false },
            ],
            purpose: "diagnostic",
            confidence: "required",
            delivery: "main",
            conceptKeys: ["evidence"],
            linkedRecheckQuestionId: recheckQuestionId,
            timeLimitSeconds: 30,
            basePoints: 1_000,
            explanation: "The observation is directly supported.",
            mediaId: null,
            mediaAlt: null,
          },
        },
        {
          id: randomUUID(),
          kind: "question",
          question: {
            id: recheckQuestionId,
            type: "single_select",
            prompt: "Which statement remains evidence-based?",
            choices: [
              { id: recheckAnswerId, label: "The directly observed statement", isCorrect: true },
              {
                id: recheckDistractorId,
                label: "The unsupported interpretation",
                isCorrect: false,
              },
            ],
            purpose: "practice",
            confidence: "optional",
            delivery: "recheck",
            conceptKeys: ["evidence"],
            linkedRecheckQuestionId: null,
            timeLimitSeconds: 30,
            basePoints: 1_000,
            explanation: "Direct observations can be independently checked.",
            mediaId: null,
            mediaAlt: null,
          },
        },
      ],
    };
    const saved = await app.inject({
      method: "PUT",
      url: `/v1/presentations/${presentation.id}/draft`,
      headers: { cookie },
      payload: { draft, expectedRevision: 0, mutationId: randomUUID(), schemaVersion: 1 },
    });
    expect(saved.statusCode).toBe(200);
    const published = await app.inject({
      method: "POST",
      url: `/v1/presentations/${presentation.id}/publish`,
      headers: { cookie },
      payload: { expectedDraftRevision: 1 },
    });
    expect(published.statusCode).toBe(200);

    const hosted = await app.inject({
      method: "POST",
      url: "/v1/presentation-sessions",
      headers: { cookie },
      payload: { presentationId: presentation.id },
    });
    expect(hosted.statusCode).toBe(201);
    const lobby = hosted.json<{
      snapshot: { id: string; code: string; revision: number; phase: string };
    }>().snapshot;
    expect(lobby).toMatchObject({ phase: "lobby", revision: 0 });
    expect(lobby.code).toMatch(/^\d{7}$/);

    const joined = await app.inject({
      method: "POST",
      url: "/v1/presentation-sessions/join",
      payload: { code: lobby.code, nickname: "River" },
    });
    expect(joined.statusCode).toBe(201);
    const participantToken = joined.json<{ participantToken: string }>().participantToken;

    const futureFence = await app.inject({
      method: "POST",
      url: `/v1/presentation-sessions/${lobby.id}/advance`,
      headers: { cookie },
      payload: { expectedRevision: 1 },
    });
    expect(futureFence.statusCode).toBe(409);
    expect(futureFence.json()).toMatchObject({
      error: {
        code: "STALE_SESSION",
        details: { expectedRevision: 1, currentRevision: 0 },
      },
    });

    const content = await app.inject({
      method: "POST",
      url: `/v1/presentation-sessions/${lobby.id}/advance`,
      headers: { cookie },
      payload: { expectedRevision: 0 },
    });
    expect(content.json()).toMatchObject({
      snapshot: { phase: "content", currentBlock: { title: "Review the source" } },
    });
    const contentParticipant = await app.inject({
      method: "GET",
      url: `/v1/presentation-sessions/${lobby.id}/participant`,
      headers: { authorization: `Bearer ${participantToken}` },
    });
    expect(contentParticipant.statusCode).toBe(200);
    expect(contentParticipant.json()).not.toHaveProperty("snapshot.currentBlock.speakerNotes");

    const question = await app.inject({
      method: "POST",
      url: `/v1/presentation-sessions/${lobby.id}/advance`,
      headers: { cookie },
      payload: { expectedRevision: 1 },
    });
    expect(question.json()).toMatchObject({
      snapshot: {
        phase: "question_open",
        revision: 2,
        acceptingResponses: true,
        questionClosesAt: expect.any(String),
      },
    });
    const questionParticipant = await app.inject({
      method: "GET",
      url: `/v1/presentation-sessions/${lobby.id}/participant`,
      headers: { authorization: `Bearer ${participantToken}` },
    });
    const participantQuestion = questionParticipant.json<{
      snapshot: { currentBlock: { question: Record<string, unknown> } };
    }>().snapshot.currentBlock.question;
    expect(participantQuestion).not.toHaveProperty("explanation");
    expect(participantQuestion).not.toHaveProperty("conceptKeys");
    expect(JSON.stringify(participantQuestion)).not.toContain("isCorrect");

    const missingRequiredConfidence = await app.inject({
      method: "POST",
      url: `/v1/presentation-sessions/${lobby.id}/responses`,
      payload: {
        participantToken,
        response: { choiceIds: [answerId], confidence: null },
      },
    });
    expect(missingRequiredConfidence.statusCode).toBe(422);
    expect(missingRequiredConfidence.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });

    const answered = await app.inject({
      method: "POST",
      url: `/v1/presentation-sessions/${lobby.id}/responses`,
      payload: {
        participantToken,
        response: { choiceIds: [distractorId], confidence: 3 },
      },
    });
    expect(answered.statusCode, JSON.stringify(answered.json())).toBe(202);

    const openQuestionSnapshot = await app.inject({
      method: "GET",
      url: `/v1/presentation-sessions/${lobby.id}/participant`,
      headers: { authorization: `Bearer ${participantToken}` },
    });
    expect(openQuestionSnapshot.json()).toMatchObject({
      snapshot: { phase: "question_open", standing: null, responseResult: null },
    });

    const duplicate = await app.inject({
      method: "POST",
      url: `/v1/presentation-sessions/${lobby.id}/responses`,
      payload: {
        participantToken,
        response: { choiceIds: [answerId], confidence: 3 },
      },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ error: { code: "ALREADY_RESPONDED" } });

    for (const expectedRevision of [2, 3, 4]) {
      const advanced = await app.inject({
        method: "POST",
        url: `/v1/presentation-sessions/${lobby.id}/advance`,
        headers: { cookie },
        payload: { expectedRevision },
      });
      expect(advanced.statusCode).toBe(200);
    }
    const recheckSnapshot = await app.inject({
      method: "GET",
      url: `/v1/presentation-sessions/${lobby.id}/participant`,
      headers: { authorization: `Bearer ${participantToken}` },
    });
    expect(recheckSnapshot.json()).toMatchObject({
      snapshot: { phase: "question_open", currentBlockIndex: 2 },
    });
    const rechecked = await app.inject({
      method: "POST",
      url: `/v1/presentation-sessions/${lobby.id}/responses`,
      payload: {
        participantToken,
        response: { choiceIds: [recheckAnswerId], confidence: 3 },
      },
    });
    expect(rechecked.statusCode).toBe(202);
    for (const expectedRevision of [5, 6]) {
      const advanced = await app.inject({
        method: "POST",
        url: `/v1/presentation-sessions/${lobby.id}/advance`,
        headers: { cookie },
        payload: { expectedRevision },
      });
      expect(advanced.statusCode).toBe(200);
    }
    const reconnect = await app.inject({
      method: "GET",
      url: `/v1/presentation-sessions/${lobby.id}/participant`,
      headers: { authorization: `Bearer ${participantToken}` },
    });
    expect(reconnect.json()).toMatchObject({ snapshot: { phase: "finished", status: "finished" } });
    const finishedSession = await built.presentationSessions.getSessionById(lobby.id);
    expect(finishedSession?.finishedAt).not.toBeNull();
    expect(
      finishedSession!.retentionExpiresAt.getTime() - finishedSession!.finishedAt!.getTime(),
    ).toBeGreaterThanOrEqual(30 * 24 * 60 * 60 * 1_000 - 1_000);

    const report = await app.inject({
      method: "GET",
      url: `/v1/presentation-sessions/${lobby.id}/report`,
      headers: { cookie },
    });
    expect(report.statusCode).toBe(200);
    expect(report.json()).toMatchObject({
      report: {
        artifactType: "presentation",
        participantCount: 1,
        responseCount: 2,
        evidence: [
          { kind: "content", assessmentStatus: "not_assessed" },
          {
            kind: "question",
            questionTypeLabel: "Single choice",
            respondents: 1,
            correct: 0,
            accuracyPercent: 0,
          },
          { kind: "question", respondents: 1, correct: 1, accuracyPercent: 100 },
        ],
        recovery: [{ eligible: 1, recovered: 1, recoveryPercent: 100 }],
        leaderboard: [{ nickname: "River", rank: 1 }],
        timeline: [
          { type: "content.presented" },
          { type: "question.launched" },
          { type: "question.revealed" },
          { type: "intervention.presented" },
          { type: "question.launched" },
          { type: "question.revealed" },
          { type: "presentation.finished" },
        ],
      },
    });
  });

  it("expires live codes independently and applies the workspace participant entitlement", async () => {
    const repository = new MemoryRepository({
      initialWorkspaceId: BETA_WORKSPACE_ID,
      initialPlan: "free",
    });
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        MAX_SESSION_PARTICIPANTS: 21,
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        FEATURE_UX_BETA: "true",
        UX_BETA_WORKSPACE_ALLOWLIST: BETA_WORKSPACE_ID,
        FEATURE_PRESENTATIONS: "true",
        LOG_LEVEL: "silent",
      }),
      { repository, cache: new MemorySessionCache() },
    );
    app = built.app;
    const cookie = await signIn(app);
    const account = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
    const creator = account.json<{ creator: { userId: string } }>().creator;
    const now = new Date();
    const content: PresentationSessionRecord["content"] = {
      title: "Capacity briefing",
      description: "",
      experiencePreset: { id: "focus", version: 1 },
      schemaVersion: 1,
      blocks: [
        {
          id: randomUUID(),
          kind: "content" as const,
          layout: "title_body" as const,
          title: "Welcome",
          body: "Review together.",
          mediaId: null,
          mediaAlt: null,
          speakerNotes: "",
        },
      ],
    };
    const baseSession = {
      workspaceId: BETA_WORKSPACE_ID,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      title: content.title,
      content,
      status: "active" as const,
      phase: "lobby" as const,
      currentBlockIndex: -1,
      revision: 0,
      createdBy: creator.userId,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      retentionExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
    };
    const entitled = await built.presentationSessions.createSession({
      ...baseSession,
      id: randomUUID(),
      code: "1112233",
      liveExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000),
    });

    const joins = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        app!.inject({
          method: "POST",
          url: "/v1/presentation-sessions/join",
          payload: { code: entitled.code, nickname: `Learner ${index + 1}` },
        }),
      ),
    );
    expect(joins.every((join) => join.statusCode === 201)).toBe(true);
    const overLimit = await app.inject({
      method: "POST",
      url: "/v1/presentation-sessions/join",
      payload: { code: entitled.code, nickname: "Learner 21" },
    });
    expect(overLimit.statusCode).toBe(409);
    expect(overLimit.json()).toMatchObject({ error: { code: "PARTICIPANT_LIMIT" } });

    const expired = await built.presentationSessions.createSession({
      ...baseSession,
      id: randomUUID(),
      code: "9988776",
      liveExpiresAt: new Date(now.getTime() - 1),
    });
    const expiredJoin = await app.inject({
      method: "POST",
      url: "/v1/presentation-sessions/join",
      payload: { code: expired.code, nickname: "Late learner" },
    });
    expect(expiredJoin.statusCode).toBe(404);
    const expiredHost = await app.inject({
      method: "GET",
      url: `/v1/presentation-sessions/${expired.id}`,
      headers: { cookie },
    });
    expect(expiredHost.statusCode).toBe(409);
    expect(expiredHost.json()).toMatchObject({ error: { code: "PHASE_CLOSED" } });
  });
});

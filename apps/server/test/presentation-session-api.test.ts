import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  PresentationReportEnvelopeSchema,
  PresentationRestV1CreateSessionResponseSchema,
  PresentationRestV1HostSnapshotResponseSchema,
  PresentationRestV1JoinSessionResponseSchema,
  PresentationRestV1ParticipantSnapshotResponseSchema,
  PresentationRestV1ResponseAckSchema,
  PresentationRestV1SessionListResponseSchema,
} from "@openround/contracts";
import { MemoryRepository, type PresentationSessionRecord } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

let app: FastifyInstance | undefined;
const BETA_WORKSPACE_ID = "10000000-0000-4000-8000-000000000002";

class RecordingSessionCache extends MemorySessionCache {
  readonly admissionKeys: string[] = [];

  override async consumeRateLimit(key: string, maximum: number, windowMs: number) {
    this.admissionKeys.push(key);
    return super.consumeRateLimit(key, maximum, windowMs);
  }
}

async function waitForLaterWallClockMillisecond(earlierTimestamp: string) {
  const earlierTime = Date.parse(earlierTimestamp);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
    if (Date.now() > earlierTime) return;
  }
  throw new Error(`Wall clock did not advance beyond ${earlierTimestamp}`);
}

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
    const cache = new RecordingSessionCache();
    const repository = new MemoryRepository({ initialWorkspaceId: BETA_WORKSPACE_ID });
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
        FEATURE_PRESENTATION_REALTIME: "true",
        EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: BETA_WORKSPACE_ID,
        LOG_LEVEL: "silent",
      }),
      {
        repository,
        cache,
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
    const diagnosticBlockId = randomUUID();
    const recheckBlockId = randomUUID();
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
          id: diagnosticBlockId,
          kind: "question",
          question: {
            id: diagnosticQuestionId,
            type: "single_select",
            prompt: "Which claim is supported?",
            choices: [
              { id: answerId, label: "Observed behaviour", isCorrect: true },
              {
                id: distractorId,
                label: "Unverified assumption",
                isCorrect: false,
                feedback: "This inference is not directly observed.",
                misconceptionKey: "inference-as-evidence",
              },
            ],
            purpose: "diagnostic",
            confidence: "required",
            delivery: "main",
            conceptKeys: ["evidence"],
            linkedRecheckQuestionId: recheckQuestionId,
            timeLimitSeconds: 30,
            basePoints: 1_000,
            explanation: "The observation is directly supported.",
            sourceCitations: [
              {
                sourceName: "Facilitator guide",
                sourceDigest: "a".repeat(64),
                locator: "p. 2",
                excerpt: "Separate observations from interpretations.",
              },
            ],
            mediaId: null,
            mediaAlt: null,
          },
        },
        {
          id: recheckBlockId,
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
    const hostedBody = PresentationRestV1CreateSessionResponseSchema.parse(hosted.json());
    const lobby = hostedBody.snapshot;
    expect(lobby).toMatchObject({ phase: "lobby", revision: 0 });
    expect(lobby.code).toMatch(/^\d{7}$/);
    expect(hosted.json()).toMatchObject({
      snapshot: { createdAt: expect.any(String), updatedAt: expect.any(String), leaderboard: [] },
    });

    const controlPassResponse = await app.inject({
      method: "POST",
      url: `/v1/presentation-sessions/${lobby.id}/control-pass`,
      headers: { cookie },
    });
    expect(controlPassResponse.statusCode).toBe(201);
    const controlPass = controlPassResponse.json<{
      credentialId: string;
      controlToken: string;
    }>();
    const revokedPass = await app.inject({
      method: "DELETE",
      url: `/v1/presentation-sessions/${lobby.id}/control-passes/${controlPass.credentialId}`,
      headers: { cookie },
    });
    expect(revokedPass.statusCode).toBe(204);
    await expect(
      built.presentationService.sync({
        sessionId: lobby.id,
        projection: "host",
        controlToken: controlPass.controlToken,
        afterSeq: 0,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const joined = await app.inject({
      method: "POST",
      url: "/v1/presentation-sessions/join",
      payload: { code: lobby.code, nickname: "River" },
    });
    expect(joined.statusCode).toBe(201);
    const joinedBody = PresentationRestV1JoinSessionResponseSchema.parse(joined.json());
    const participantToken = joinedBody.participantToken;
    const compatibleHostSnapshot = await app.inject({
      method: "GET",
      url: `/v1/presentation-sessions/${lobby.id}`,
      headers: { cookie },
    });
    const compatibleHostBody = PresentationRestV1HostSnapshotResponseSchema.parse(
      compatibleHostSnapshot.json(),
    );
    expect(compatibleHostBody).toMatchObject({
      snapshot: {
        id: lobby.id,
        eventSeq: 1,
        roomStatus: { joinedCount: 1, connectedCount: 1, notCurrentlyConnectedCount: 0 },
        leaderboard: [{ nickname: "River", joinedAt: expect.any(String), score: 0, rank: 1 }],
      },
    });
    // joinedAt is stored at millisecond precision. Keep this end-to-end expectation focused on
    // join order; equal timestamps exercise the separate nickname tie-break contract instead.
    await waitForLaterWallClockMillisecond(compatibleHostBody.snapshot.leaderboard[0]!.joinedAt);
    const legacyJoin = await app.inject({
      method: "POST",
      url: "/v1/presentation-sessions/join",
      payload: { code: lobby.code, nickname: "Legacy" },
    });
    expect(legacyJoin.statusCode).toBe(201);
    const legacyJoinBody = PresentationRestV1JoinSessionResponseSchema.parse(legacyJoin.json());
    const legacyParticipantToken = legacyJoinBody.participantToken;

    const listed = await app.inject({
      method: "GET",
      url: "/v1/presentation-sessions",
      headers: { cookie },
    });
    const listedBody = PresentationRestV1SessionListResponseSchema.parse(listed.json());
    expect(listedBody.sessions).toEqual([
      expect.objectContaining({
        id: lobby.id,
        participants: expect.arrayContaining([
          expect.objectContaining({ nickname: "River", joinedAt: expect.any(String) }),
          expect.objectContaining({ nickname: "Legacy", joinedAt: expect.any(String) }),
        ]),
        leaderboard: expect.arrayContaining([
          expect.objectContaining({ nickname: "River", joinedAt: expect.any(String) }),
          expect.objectContaining({ nickname: "Legacy", joinedAt: expect.any(String) }),
        ]),
      }),
    ]);

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
    const contentBody = PresentationRestV1HostSnapshotResponseSchema.parse(content.json());
    expect(contentBody).toMatchObject({
      snapshot: { phase: "content", currentBlock: { title: "Review the source" } },
    });
    expect(contentBody.snapshot.leaderboard).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nickname: "River", joinedAt: expect.any(String) }),
        expect.objectContaining({ nickname: "Legacy", joinedAt: expect.any(String) }),
      ]),
    );
    const contentParticipant = await app.inject({
      method: "GET",
      url: `/v1/presentation-sessions/${lobby.id}/participant`,
      headers: { authorization: `Bearer ${participantToken}` },
    });
    expect(contentParticipant.statusCode).toBe(200);
    PresentationRestV1ParticipantSnapshotResponseSchema.parse(contentParticipant.json());
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
    expect(question.json()).toHaveProperty("snapshot.currentBlock.revealedAnswer", null);
    expect(JSON.stringify(question.json().snapshot.currentBlock)).not.toContain("isCorrect");
    expect(JSON.stringify(question.json().snapshot.currentBlock)).not.toContain("explanation");
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
    const serializedParticipantQuestion = JSON.stringify(participantQuestion);
    expect(serializedParticipantQuestion).not.toContain("isCorrect");
    expect(serializedParticipantQuestion).not.toContain("sourceCitations");
    expect(serializedParticipantQuestion).not.toContain("misconceptionKey");
    expect(serializedParticipantQuestion).not.toContain("feedback");
    expect(cache.admissionKeys).toEqual(
      expect.arrayContaining([expect.stringMatching(/^presentation-participant:snapshot:/)]),
    );
    const unavailableParticipantMedia = await app.inject({
      method: "GET",
      url: `/v1/presentation-sessions/${lobby.id}/media/${randomUUID()}`,
      headers: { authorization: `Bearer ${participantToken}` },
    });
    expect(unavailableParticipantMedia.statusCode).toBe(404);
    expect(unavailableParticipantMedia.headers["cache-control"]).toContain("no-store");

    const legacyAnswer = await app.inject({
      method: "POST",
      url: `/v1/presentation-sessions/${lobby.id}/responses`,
      payload: {
        participantToken: legacyParticipantToken,
        response: { choiceIds: [answerId], confidence: 3 },
      },
    });
    expect(legacyAnswer.statusCode, JSON.stringify(legacyAnswer.json())).toBe(202);
    expect(legacyAnswer.json()).toMatchObject({
      accepted: true,
      duplicate: false,
      blockId: diagnosticBlockId,
      revision: 2,
    });
    const legacyRetry = await app.inject({
      method: "POST",
      url: `/v1/presentation-sessions/${lobby.id}/responses`,
      payload: {
        participantToken: legacyParticipantToken,
        response: { choiceIds: [answerId], confidence: 3 },
      },
    });
    expect(legacyRetry.statusCode).toBe(202);
    expect(legacyRetry.json()).toMatchObject({
      accepted: true,
      duplicate: true,
      responseId: legacyAnswer.json<{ responseId: string }>().responseId,
    });

    const participantResponseKeyStart = cache.admissionKeys.length;
    const missingRequiredConfidence = await app.inject({
      method: "POST",
      url: `/v1/presentation-sessions/${lobby.id}/responses`,
      headers: { authorization: "Bearer unrelated-rate-key-a" },
      payload: {
        participantToken,
        blockId: diagnosticBlockId,
        expectedRevision: 2,
        idempotencyKey: randomUUID(),
        response: { choiceIds: [answerId], confidence: null },
      },
    });
    expect(missingRequiredConfidence.statusCode).toBe(422);
    expect(missingRequiredConfidence.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });

    const responseIdempotencyKey = randomUUID();
    const answered = await app.inject({
      method: "POST",
      url: `/v1/presentation-sessions/${lobby.id}/responses`,
      headers: { authorization: "Bearer unrelated-rate-key-b" },
      payload: {
        participantToken,
        blockId: diagnosticBlockId,
        expectedRevision: 2,
        idempotencyKey: responseIdempotencyKey,
        response: { choiceIds: [distractorId], confidence: 3 },
      },
    });
    expect(answered.statusCode, JSON.stringify(answered.json())).toBe(202);
    const participantResponseKeys = cache.admissionKeys
      .slice(participantResponseKeyStart)
      .filter((key) => key.startsWith("presentation-participant:response:"));
    expect(participantResponseKeys).toHaveLength(2);
    expect(new Set(participantResponseKeys).size).toBe(1);
    expect(answered.json()).toMatchObject({
      accepted: true,
      duplicate: false,
      blockId: diagnosticBlockId,
      revision: 2,
      responseId: expect.any(String),
      submittedAt: expect.any(String),
    });
    PresentationRestV1ResponseAckSchema.parse(answered.json());

    const acknowledgedRetry = await app.inject({
      method: "POST",
      url: `/v1/presentation-sessions/${lobby.id}/responses`,
      payload: {
        participantToken,
        blockId: diagnosticBlockId,
        expectedRevision: 2,
        idempotencyKey: responseIdempotencyKey,
        response: { choiceIds: [distractorId], confidence: 3 },
      },
    });
    expect(acknowledgedRetry.statusCode).toBe(202);
    expect(acknowledgedRetry.json()).toMatchObject({
      accepted: true,
      duplicate: true,
      responseId: answered.json<{ responseId: string }>().responseId,
    });
    PresentationRestV1ResponseAckSchema.parse(acknowledgedRetry.json());

    const conflictingRetry = await app.inject({
      method: "POST",
      url: `/v1/presentation-sessions/${lobby.id}/responses`,
      payload: {
        participantToken,
        blockId: diagnosticBlockId,
        expectedRevision: 2,
        idempotencyKey: responseIdempotencyKey,
        response: { choiceIds: [distractorId], confidence: 2 },
      },
    });
    expect(conflictingRetry.statusCode).toBe(409);
    expect(conflictingRetry.json()).toMatchObject({
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });

    const openQuestionSnapshot = await app.inject({
      method: "GET",
      url: `/v1/presentation-sessions/${lobby.id}/participant`,
      headers: { authorization: `Bearer ${participantToken}` },
    });
    expect(openQuestionSnapshot.json()).toMatchObject({
      snapshot: { phase: "question_open", standing: null, responseResult: null },
    });
    const activeReport = await app.inject({
      method: "GET",
      url: `/v1/presentation-sessions/${lobby.id}/report`,
      headers: { cookie },
    });
    expect(activeReport.statusCode).toBe(409);
    expect(activeReport.headers["cache-control"]).toContain("no-store");
    expect(activeReport.json()).toMatchObject({ error: { code: "PHASE_CLOSED" } });

    const duplicate = await app.inject({
      method: "POST",
      url: `/v1/presentation-sessions/${lobby.id}/responses`,
      payload: {
        participantToken,
        blockId: diagnosticBlockId,
        expectedRevision: 2,
        idempotencyKey: randomUUID(),
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
      if (expectedRevision === 2) {
        expect(advanced.json()).toMatchObject({
          snapshot: {
            phase: "question_reveal",
            currentBlock: {
              revealedAnswer: {
                kind: "choice",
                correctChoiceIds: [answerId],
                explanation: expect.any(String),
              },
            },
          },
        });
      }
    }
    const recheckSnapshot = await app.inject({
      method: "GET",
      url: `/v1/presentation-sessions/${lobby.id}/participant`,
      headers: { authorization: `Bearer ${participantToken}` },
    });
    expect(recheckSnapshot.json()).toMatchObject({
      snapshot: { phase: "question_open", currentBlockIndex: 2 },
    });
    const recoveredAcknowledgement = await app.inject({
      method: "POST",
      url: `/v1/presentation-sessions/${lobby.id}/responses`,
      payload: {
        participantToken,
        blockId: diagnosticBlockId,
        expectedRevision: 2,
        idempotencyKey: responseIdempotencyKey,
        response: { choiceIds: [distractorId], confidence: 3 },
      },
    });
    expect(recoveredAcknowledgement.statusCode).toBe(202);
    expect(recoveredAcknowledgement.json()).toMatchObject({
      accepted: true,
      duplicate: true,
      responseId: answered.json<{ responseId: string }>().responseId,
      blockId: diagnosticBlockId,
      revision: 2,
    });
    const delayedOldQuestion = await app.inject({
      method: "POST",
      url: `/v1/presentation-sessions/${lobby.id}/responses`,
      payload: {
        participantToken,
        blockId: diagnosticBlockId,
        expectedRevision: 2,
        idempotencyKey: randomUUID(),
        response: { choiceIds: [answerId], confidence: 3 },
      },
    });
    expect(delayedOldQuestion.statusCode).toBe(409);
    expect(delayedOldQuestion.json()).toMatchObject({
      error: {
        code: "STALE_SESSION",
        details: {
          expectedBlockId: diagnosticBlockId,
          currentBlockId: recheckBlockId,
          expectedRevision: 2,
          currentRevision: 5,
        },
      },
    });
    const rechecked = await app.inject({
      method: "POST",
      url: `/v1/presentation-sessions/${lobby.id}/responses`,
      payload: {
        participantToken,
        blockId: recheckBlockId,
        expectedRevision: 5,
        idempotencyKey: randomUUID(),
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

    const pendingReport = await app.inject({
      method: "GET",
      url: `/v1/presentation-sessions/${lobby.id}/report`,
      headers: { cookie },
    });
    expect(pendingReport.statusCode).toBe(200);
    expect(pendingReport.json()).toMatchObject({
      reportStatus: "pending",
      report: {
        schemaVersion: 1,
        artifactType: "presentation",
        participantCount: 2,
        responseCount: 3,
      },
    });
    PresentationReportEnvelopeSchema.parse(pendingReport.json());
    const pendingProjection = pendingReport.json<{ report: unknown }>().report;
    await expect(built.presentationReportWorker.runUntilIdle()).resolves.toEqual([
      "completed",
      "idle",
    ]);
    const report = await app.inject({
      method: "GET",
      url: `/v1/presentation-sessions/${lobby.id}/report`,
      headers: { cookie },
    });
    expect(report.statusCode).toBe(200);
    expect(report.headers["cache-control"]).toContain("no-store");
    PresentationReportEnvelopeSchema.parse(report.json());
    expect(report.json<{ report: unknown }>().report).toEqual(pendingProjection);
    expect(report.json()).toMatchObject({
      reportStatus: "ready",
      report: {
        schemaVersion: 1,
        artifactType: "presentation",
        participantCount: 2,
        responseCount: 3,
        evidence: [
          { kind: "content", assessmentStatus: "not_assessed" },
          {
            kind: "question",
            questionTypeLabel: "Single choice",
            respondents: 2,
            correct: 1,
            accuracyPercent: 50,
          },
          { kind: "question", respondents: 1, correct: 1, accuracyPercent: 100 },
        ],
        recovery: [{ eligible: 1, recovered: 1, recoveryPercent: 100 }],
        leaderboard: [
          { nickname: "River", rank: 1 },
          { nickname: "Legacy", rank: 2 },
        ],
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
    await built.productEvents.drain();
    const presentationEvents = repository.productEvents.filter(
      (event) => event.dimensions.artifactType === "presentation",
    );
    const eventCount = (name: (typeof presentationEvents)[number]["name"]) =>
      presentationEvents.filter((event) => event.name === name).length;
    expect(eventCount("round_published")).toBe(1);
    expect(eventCount("participant_joined")).toBe(2);
    expect(eventCount("response_saved_acknowledged")).toBe(3);
    expect(eventCount("intervention_started")).toBe(1);
    expect(eventCount("linked_recheck_opened")).toBe(1);
    for (const event of presentationEvents) {
      expect(event.dimensions).toMatchObject({
        artifactType: "presentation",
        betaVersion: "p0-2026",
      });
      for (const forbiddenKey of [
        "presentationId",
        "sessionId",
        "participantId",
        "nickname",
        "code",
        "response",
      ]) {
        expect(event.dimensions).not.toHaveProperty(forbiddenKey);
      }
    }
    const renderedMetrics = await built.metrics.render();
    for (const [stage, count] of [
      ["publish", 1],
      ["join", 2],
      ["answer_acknowledged", 3],
      ["intervention", 1],
      ["linked_recheck", 1],
    ] as const) {
      expect(renderedMetrics).toContain(
        `openround_recovery_funnel_stages_total{stage="${stage}",artifact_type="presentation",segment="workplace"} ${count}`,
      );
    }
  });

  it("never applies delayed numeric or rating payloads to the next question", async () => {
    const repository = new MemoryRepository({ initialWorkspaceId: BETA_WORKSPACE_ID });
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
        FEATURE_PRESENTATION_REALTIME: "true",
        EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: BETA_WORKSPACE_ID,
        LOG_LEVEL: "silent",
      }),
      { repository, cache: new MemorySessionCache() },
    );
    app = built.app;
    const now = new Date();
    const examples = [
      {
        code: "5550001",
        oldQuestion: {
          id: randomUUID(),
          type: "numeric" as const,
          prompt: "How many observations?",
          purpose: "diagnostic" as const,
          confidence: "optional" as const,
          delivery: "main" as const,
          conceptKeys: ["counting"],
          linkedRecheckQuestionId: null,
          timeLimitSeconds: 30,
          basePoints: 1_000,
          explanation: "There are three.",
          mediaId: null,
          mediaAlt: null,
          correctValue: "3",
          tolerance: "0",
          unit: null,
        },
        delayedResponse: { numericValue: "3", confidence: 3 as const },
      },
      {
        code: "5550002",
        oldQuestion: {
          id: randomUUID(),
          type: "rating" as const,
          prompt: "How useful was the example?",
          purpose: "opinion" as const,
          confidence: "off" as const,
          delivery: "main" as const,
          conceptKeys: [],
          linkedRecheckQuestionId: null,
          timeLimitSeconds: 30,
          basePoints: 0,
          explanation: "This is an opinion checkpoint.",
          mediaId: null,
          mediaAlt: null,
          min: 1,
          max: 5,
          minLabel: "Not useful",
          maxLabel: "Very useful",
        },
        delayedResponse: { ratingValue: 4 },
      },
    ];

    for (const example of examples) {
      const oldBlockId = randomUUID();
      const currentBlockId = randomUUID();
      const session = await built.presentationSessions.createSession({
        id: randomUUID(),
        workspaceId: BETA_WORKSPACE_ID,
        presentationId: randomUUID(),
        presentationVersionId: randomUUID(),
        title: "Fenced responses",
        content: {
          title: "Fenced responses",
          description: "",
          experiencePreset: { id: "focus", version: 1 },
          schemaVersion: 1,
          blocks: [
            { id: oldBlockId, kind: "question", question: example.oldQuestion },
            {
              id: currentBlockId,
              kind: "question",
              question: {
                id: randomUUID(),
                type: "numeric",
                prompt: "Current numeric question",
                purpose: "diagnostic",
                confidence: "optional",
                delivery: "main",
                conceptKeys: ["current"],
                linkedRecheckQuestionId: null,
                timeLimitSeconds: 30,
                basePoints: 1_000,
                explanation: "Current answer.",
                mediaId: null,
                mediaAlt: null,
                correctValue: "9",
                tolerance: "0",
                unit: null,
              },
            },
          ],
        },
        code: example.code,
        status: "active",
        phase: "question_open",
        currentBlockIndex: 1,
        revision: 2,
        settings: { timeMode: "timed" },
        trustMode: "learning",
        eventSeq: 2,
        questionOpenedAt: now,
        questionClosesAt: new Date(now.getTime() + 30_000),
        createdBy: randomUUID(),
        createdAt: now,
        updatedAt: now,
        finishedAt: null,
        liveExpiresAt: new Date(now.getTime() + 60_000),
        retentionExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
      });
      const joined = await app.inject({
        method: "POST",
        url: "/v1/presentation-sessions/join",
        payload: { code: session.code, nickname: "Delayed device" },
      });
      expect(joined.statusCode).toBe(201);
      const participantToken = joined.json<{ participantToken: string }>().participantToken;

      const delayed = await app.inject({
        method: "POST",
        url: `/v1/presentation-sessions/${session.id}/responses`,
        payload: {
          participantToken,
          blockId: oldBlockId,
          expectedRevision: 1,
          idempotencyKey: randomUUID(),
          response: example.delayedResponse,
        },
      });
      expect(delayed.statusCode).toBe(409);
      expect(delayed.json()).toMatchObject({ error: { code: "STALE_SESSION" } });
      expect(await built.presentationSessions.listResponses(session.id)).toEqual([]);
    }
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
        FEATURE_PRESENTATION_REALTIME: "true",
        EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: BETA_WORKSPACE_ID,
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

    const listed = await app.inject({
      method: "GET",
      url: "/v1/presentation-sessions",
      headers: { cookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.headers["cache-control"]).toContain("no-store");
    const listedSessions = listed.json<{ sessions: Array<{ id: string; status: string }> }>()
      .sessions;
    expect(listedSessions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: entitled.id, status: "active" })]),
    );
    expect(listedSessions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: expired.id })]),
    );
  });
});

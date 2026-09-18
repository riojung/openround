import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { ReportV3Schema } from "@openround/contracts";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

let app: FastifyInstance | undefined;

async function signIn(target: FastifyInstance, email: string) {
  const magic = await target.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "workplace", acceptPolicies: true },
  });
  const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await target.inject({ method: "GET", url: `/v1/auth/verify?token=${token}` });
  const setCookie = verified.headers["set-cookie"]!;
  const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
  const me = await target.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
  return {
    cookie,
    creator: me.json<{
      creator: { userId: string; workspaceId: string };
      entitlements: { cohosting: boolean };
      productFeatures: { uxBeta: boolean; recoveryRehearsal: boolean };
    }>(),
  };
}

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe("P0 beta creator APIs", () => {
  it("fails closed with an empty workspace allowlist, including session snapshots", async () => {
    const repository = new MemoryRepository();
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        FEATURE_UX_BETA: "true",
        FEATURE_RECOVERY_REHEARSAL: "true",
        LOG_LEVEL: "silent",
      }),
      { repository, cache: new MemorySessionCache() },
    );
    app = built.app;
    const signedIn = await signIn(app, "beta-excluded@example.com");
    expect(signedIn.creator.productFeatures).toMatchObject({
      uxBeta: false,
      recoveryRehearsal: false,
    });
    const starter = await app.inject({
      method: "POST",
      url: "/v1/starters/icebreaker-poll/use",
      headers: { cookie: signedIn.cookie },
    });
    const quizId = starter.json<{ quiz: { id: string } }>().quiz.id;
    await app.inject({
      method: "POST",
      url: `/v1/quizzes/${quizId}/publish`,
      headers: { cookie: signedIn.cookie },
    });
    const session = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { cookie: signedIn.cookie },
      payload: {
        quizId,
        settings: {
          audienceLimit: 20,
          scoringMode: "accuracy",
          resultVisibility: "private",
          allowLateJoin: true,
          nicknamePolicy: "friendly_only",
        },
      },
    });
    expect(session.statusCode).toBe(201);
    expect(session.json<{ snapshot: { uxBeta?: boolean } }>().snapshot.uxBeta).toBe(false);
  });

  it("instantiates immutable starters with fresh IDs and exposes allowlisted features", async () => {
    const workspaceId = randomUUID();
    const repository = new MemoryRepository({ initialWorkspaceId: workspaceId });
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        FEATURE_UX_BETA: "true",
        FEATURE_RECOVERY_REHEARSAL: "true",
        UX_BETA_WORKSPACE_ALLOWLIST: workspaceId,
        LOG_LEVEL: "silent",
      }),
      { repository, cache: new MemorySessionCache() },
    );
    app = built.app;
    const signedIn = await signIn(app, "beta-starters@example.com");

    expect(signedIn.creator.entitlements.cohosting).toBe(false);
    expect(signedIn.creator.productFeatures).toMatchObject({
      uxBeta: true,
      recoveryRehearsal: true,
    });
    const publicFeatures = await app.inject({ method: "GET", url: "/v1/features" });
    expect(publicFeatures.json()).toMatchObject({ uxBeta: true, recoveryRehearsal: true });

    const listed = await app.inject({
      method: "GET",
      url: "/v1/starters",
      headers: { cookie: signedIn.cookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ starters: unknown[] }>().starters).toHaveLength(6);

    const create = () =>
      app!.inject({
        method: "POST",
        url: "/v1/starters/misconception-check/use",
        headers: { cookie: signedIn.cookie },
      });
    const first = await create();
    const second = await create();
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const firstQuiz = first.json<{
      quiz: {
        id: string;
        draft: {
          questions: Array<{
            id: string;
            choices: Array<{ id: string }>;
            linkedRecheckQuestionId: string | null;
          }>;
        };
      };
    }>().quiz;
    const secondQuiz =
      second.json<typeof firstQuiz extends never ? never : { quiz: typeof firstQuiz }>().quiz;
    expect(firstQuiz.id).not.toBe(secondQuiz.id);
    expect(firstQuiz.draft.questions.map((question) => question.id)).not.toEqual(
      secondQuiz.draft.questions.map((question) => question.id),
    );
    expect(
      firstQuiz.draft.questions.flatMap((question) => question.choices.map(({ id }) => id)),
    ).not.toEqual(
      secondQuiz.draft.questions.flatMap((question) => question.choices.map(({ id }) => id)),
    );
    expect(firstQuiz.draft.questions[0]!.linkedRecheckQuestionId).toBe(
      firstQuiz.draft.questions[1]!.id,
    );
  });

  it("paginates histories, resumes securely, accepts bounded telemetry, and creates V3 follow-ups", async () => {
    const allowlistedWorkspaceId = randomUUID();
    const repository = new MemoryRepository({ initialWorkspaceId: allowlistedWorkspaceId });
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        FEATURE_UX_BETA: "true",
        FEATURE_RECOVERY_REHEARSAL: "true",
        UX_BETA_WORKSPACE_ALLOWLIST: allowlistedWorkspaceId,
        LOG_LEVEL: "silent",
      }),
      { repository, cache: new MemorySessionCache() },
    );
    app = built.app;
    const auxiliaryEvents: Array<{
      sessionId: string;
      type: string;
      credentialId?: string;
    }> = [];
    built.sessions.subscribeAuxiliary(async (event) => {
      auxiliaryEvents.push({
        sessionId: event.sessionId,
        type: event.type,
        ...(typeof event.payload.credentialId === "string"
          ? { credentialId: event.payload.credentialId }
          : {}),
      });
    });
    const signedIn = await signIn(app, "beta-history@example.com");
    const { cookie } = signedIn;
    const workspaceId = signedIn.creator.creator.workspaceId;

    const starter = await app.inject({
      method: "POST",
      url: "/v1/starters/misconception-check/use",
      headers: { cookie },
    });
    const quiz = starter.json<{
      quiz: { id: string; title: string; draft: { questions: Array<{ id: string }> } };
    }>().quiz;
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/quizzes/${quiz.id}/publish`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(200);

    const createSession = () =>
      app!.inject({
        method: "POST",
        url: "/v1/sessions",
        headers: { cookie },
        payload: {
          quizId: quiz.id,
          settings: {
            audienceLimit: 20,
            scoringMode: "accuracy",
            resultVisibility: "private",
            allowLateJoin: true,
            nicknamePolicy: "friendly_only",
          },
        },
      });
    const firstSessionResponse = await createSession();
    const secondSessionResponse = await createSession();
    expect(firstSessionResponse.json<{ snapshot: { uxBeta?: boolean } }>().snapshot.uxBeta).toBe(
      true,
    );
    const firstSession = firstSessionResponse.json<{ sessionId: string }>();
    const secondSession = secondSessionResponse.json<{ sessionId: string }>();
    const durableAnswerId = randomUUID();
    const durableChoiceId = randomUUID();
    await repository.persistAnswer(workspaceId, firstSession.sessionId, {
      answerId: durableAnswerId,
      participantId: randomUUID(),
      roundId: randomUUID(),
      response: { kind: "choice", choiceIds: [durableChoiceId] },
      confidence: null,
      choiceId: durableChoiceId,
      acceptedAtMs: Date.now(),
      responseMs: 1_000,
      score: 0,
      correct: false,
      idempotencyKey: randomUUID(),
    });

    const firstPage = await app.inject({
      method: "GET",
      url: "/v1/sessions?limit=1",
      headers: { cookie },
    });
    const firstPageBody = firstPage.json<{
      items: Array<{ id: string; title: string; status: string; questionPosition: number | null }>;
      nextCursor: string | null;
    }>();
    expect(firstPageBody.items).toHaveLength(1);
    expect(firstPageBody.items[0]).toMatchObject({ title: quiz.title, status: "active" });
    expect(firstPageBody.nextCursor).toEqual(expect.any(String));
    const secondPage = await app.inject({
      method: "GET",
      url: `/v1/sessions?limit=1&cursor=${encodeURIComponent(firstPageBody.nextCursor!)}`,
      headers: { cookie },
    });
    expect(secondPage.json<{ items: Array<{ id: string }> }>().items[0]!.id).not.toBe(
      firstPageBody.items[0]!.id,
    );
    const completeHistory = await app.inject({
      method: "GET",
      url: "/v1/sessions?limit=50",
      headers: { cookie },
    });
    expect(
      completeHistory
        .json<{ items: Array<{ id: string; answerCount: number }> }>()
        .items.find((item) => item.id === firstSession.sessionId),
    ).toMatchObject({ answerCount: 1 });
    const malformed = await app.inject({
      method: "GET",
      url: "/v1/sessions?cursor=not-a-cursor",
      headers: { cookie },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    const cohostDenied = await app.inject({
      method: "POST",
      url: `/v1/sessions/${firstSession.sessionId}/staff`,
      headers: { cookie },
      payload: { role: "cohost", label: "Shared host", expiresInMinutes: 60 },
    });
    expect(cohostDenied.statusCode).toBe(402);
    const presenterAllowed = await app.inject({
      method: "POST",
      url: `/v1/sessions/${firstSession.sessionId}/staff`,
      headers: { cookie },
      payload: { role: "presenter", label: "Display", expiresInMinutes: 60 },
    });
    expect(presenterAllowed.statusCode).toBe(201);
    expect(presenterAllowed.json()).toMatchObject({
      credential: { purpose: "collaboration", role: "presenter" },
    });
    const presenterCredential = presenterAllowed.json<{
      credential: { id: string };
    }>().credential;
    const revocationAuditsBefore = repository.audits.filter(
      (event) => event.action === "session.staff.revoke",
    ).length;
    const wrongSessionRevoke = await app.inject({
      method: "DELETE",
      url: `/v1/sessions/${secondSession.sessionId}/staff/${presenterCredential.id}`,
      headers: { cookie },
    });
    expect(wrongSessionRevoke.statusCode).toBe(404);
    expect(
      (await repository.listSessionStaff(workspaceId, firstSession.sessionId)).find(
        (credential) => credential.id === presenterCredential.id,
      ),
    ).toMatchObject({ revokedAt: null });
    expect(
      repository.audits.filter((event) => event.action === "session.staff.revoke"),
    ).toHaveLength(revocationAuditsBefore);
    expect(auxiliaryEvents).toEqual([]);

    const correctSessionRevoke = await app.inject({
      method: "DELETE",
      url: `/v1/sessions/${firstSession.sessionId}/staff/${presenterCredential.id}`,
      headers: { cookie },
    });
    expect(correctSessionRevoke.statusCode).toBe(204);
    expect(auxiliaryEvents).toEqual([
      {
        sessionId: firstSession.sessionId,
        type: "session.staff.revoked",
        credentialId: presenterCredential.id,
      },
    ]);

    const firstPass = await app.inject({
      method: "POST",
      url: `/v1/sessions/${firstSession.sessionId}/control-pass`,
      headers: { cookie },
    });
    const secondPass = await app.inject({
      method: "POST",
      url: `/v1/sessions/${firstSession.sessionId}/control-pass`,
      headers: { cookie },
    });
    expect(firstPass.statusCode).toBe(201);
    expect(secondPass.statusCode).toBe(201);
    expect(secondPass.json()).toMatchObject({
      credential: { role: "cohost", purpose: "creator_resume", label: "Creator resume" },
    });
    const passTimes = secondPass.json<{
      credential: { createdAt: string; expiresAt: string };
    }>().credential;
    expect(
      new Date(passTimes.expiresAt).getTime() - new Date(passTimes.createdAt).getTime(),
    ).toBeLessThanOrEqual(4 * 60 * 60_000);
    expect(secondPass.body).not.toContain(firstPass.json<{ token: string }>().token);
    expect(auxiliaryEvents.at(-1)).toEqual({
      sessionId: firstSession.sessionId,
      type: "session.staff.revoked",
      credentialId: firstPass.json<{ credential: { id: string } }>().credential.id,
    });
    const staff = await repository.listSessionStaff(workspaceId, firstSession.sessionId);
    const resumePasses = staff.filter((credential) => credential.purpose === "creator_resume");
    expect(resumePasses).toHaveLength(2);
    expect(resumePasses.filter((credential) => !credential.revokedAt)).toHaveLength(1);

    const replaceCreatorResumeCredential =
      repository.replaceCreatorResumeCredential.bind(repository);
    const concurrentlyCreatedCredentialId = randomUUID();
    repository.replaceCreatorResumeCredential = async (input) => {
      await repository.createSessionStaffCredential({
        ...input,
        id: concurrentlyCreatedCredentialId,
        tokenHash: `concurrent-${randomUUID()}`,
        createdAt: new Date(input.createdAt.getTime() - 1),
      });
      return replaceCreatorResumeCredential(input);
    };
    const concurrentReplacementEventStart = auxiliaryEvents.length;
    const concurrentPass = await app.inject({
      method: "POST",
      url: `/v1/sessions/${firstSession.sessionId}/control-pass`,
      headers: { cookie },
    });
    expect(concurrentPass.statusCode).toBe(201);
    expect(
      auxiliaryEvents.slice(concurrentReplacementEventStart).map((event) => event.credentialId),
    ).toEqual(
      expect.arrayContaining([
        secondPass.json<{ credential: { id: string } }>().credential.id,
        concurrentlyCreatedCredentialId,
      ]),
    );
    repository.replaceCreatorResumeCredential = replaceCreatorResumeCredential;

    const activeSession = repository.sessions.get(firstSession.sessionId)!;
    const activeExpiry = activeSession.expiresAt;
    repository.replaceCreatorResumeCredential = async (input) => {
      activeSession.expiresAt = new Date(input.createdAt);
      return replaceCreatorResumeCredential(input);
    };
    const racedExpiryPass = await app.inject({
      method: "POST",
      url: `/v1/sessions/${firstSession.sessionId}/control-pass`,
      headers: { cookie },
    });
    expect(racedExpiryPass.statusCode).toBe(409);
    expect(racedExpiryPass.json()).toMatchObject({ error: { code: "CONFLICT" } });
    repository.replaceCreatorResumeCredential = replaceCreatorResumeCredential;
    activeSession.expiresAt = activeExpiry;

    const telemetry = await app.inject({
      method: "POST",
      url: "/v1/product-events",
      headers: { cookie },
      payload: {
        events: [
          {
            name: "creation_started",
            occurredAt: new Date().toISOString(),
            dimensions: { creationPath: "starter" },
          },
        ],
      },
    });
    expect(telemetry.statusCode).toBe(202);
    expect(telemetry.json()).toEqual({ accepted: 1 });
    expect(repository.productEvents[0]).toMatchObject({
      workspaceId,
      name: "creation_started",
      dimensions: {
        creationPath: "starter",
        segment: "workplace",
        betaVersion: "p0-2026",
      },
    });
    expect(JSON.stringify(repository.productEvents[0])).not.toContain(
      signedIn.creator.creator.userId,
    );
    const rejectedTelemetry = await app.inject({
      method: "POST",
      url: "/v1/product-events",
      headers: { cookie },
      payload: {
        events: [
          {
            name: "creation_started",
            occurredAt: new Date().toISOString(),
            dimensions: { objectId: quiz.id },
          },
        ],
      },
    });
    expect(rejectedTelemetry.statusCode).toBe(400);

    const session = await repository.getSessionById(firstSession.sessionId);
    expect(session).not.toBeNull();
    const reportId = randomUUID();
    const report = ReportV3Schema.parse({
      id: reportId,
      sessionId: firstSession.sessionId,
      schemaVersion: 3,
      status: "ready",
      generatedAt: new Date().toISOString(),
      expiresAt: session!.retentionExpiresAt.toISOString(),
      metrics: {
        participantCount: 0,
        completedCount: 0,
        answerCount: 0,
        accuracyPercent: 0,
      },
      questions: [],
      participants: [],
      initialAccuracy: { correct: 0, responses: 0, percent: 0 },
      confidenceMatrix: [],
      misconceptions: [],
      interventions: [],
      recovery: [],
      unresolvedConcepts: [
        { conceptKey: "topic.core-model", initiallyIncorrect: 1, recovered: 0, unresolved: 1 },
      ],
      participation: { participants: 0, respondents: 0, percent: 0 },
      responseTime: { responses: 0, medianMs: null, p95Ms: null },
      qna: { questions: 0, answered: 0, unresolved: 0 },
      participantFeedback: [],
      evidenceNote: "Synthetic API fixture",
      experience: { category: "education", preset: { id: "campus", version: 1 } },
      audiencePulse: {
        uniqueParticipants: 0,
        events: 0,
        bySignal: { got_it: 0, unsure: 0, need_example: 0, too_fast: 0 },
        contexts: [],
      },
      conversation: {
        messages: 0,
        uniqueContributors: 0,
        reactions: 0,
        reports: 0,
        removed: 0,
        moderationActions: 0,
        peakMessagesPerMinute: 0,
        transcriptAvailable: false,
      },
    });
    await repository.saveReport(workspaceId, report);

    const reports = await app.inject({ method: "GET", url: "/v1/reports", headers: { cookie } });
    expect(reports.statusCode).toBe(200);
    expect(reports.json()).toMatchObject({
      items: [
        {
          id: reportId,
          quizId: quiz.id,
          title: quiz.title,
          unresolvedConceptCount: 1,
          followupId: null,
          followupStatus: null,
        },
      ],
      nextCursor: null,
    });
    const reportDetail = await app.inject({
      method: "GET",
      url: `/v1/reports/${reportId}`,
      headers: { cookie },
    });
    expect(reportDetail.json()).toMatchObject({
      context: { quizId: quiz.id, quizTitle: quiz.title },
    });

    await repository.setPlan(workspaceId, "pro");
    const followup = await app.inject({
      method: "POST",
      url: `/v1/reports/${reportId}/followups`,
      headers: { cookie },
      payload: {
        conceptKeys: ["topic.core-model"],
        closesAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      },
    });
    expect(followup.statusCode).toBe(201);
    const followupId = followup.json<{ followup: { id: string } }>().followup.id;
    const reportsWithFollowup = await app.inject({
      method: "GET",
      url: "/v1/reports",
      headers: { cookie },
    });
    expect(reportsWithFollowup.json()).toMatchObject({
      items: [{ id: reportId, followupId, followupStatus: "open" }],
    });
    const followups = await app.inject({
      method: "GET",
      url: "/v1/followups",
      headers: { cookie },
    });
    expect(followups.json()).toMatchObject({
      items: [
        {
          id: followupId,
          sourceReportId: reportId,
          status: "open",
          attemptCount: 0,
          completedAttemptCount: 0,
        },
      ],
      nextCursor: null,
    });

    const outsider = await signIn(app, "outside-history@example.com");
    for (const url of ["/v1/sessions", "/v1/reports", "/v1/followups"]) {
      const response = await app.inject({
        method: "GET",
        url,
        headers: { cookie: outsider.cookie },
      });
      expect(response.json()).toMatchObject({ items: [], nextCursor: null });
    }

    expect(firstSession.sessionId).not.toBe(secondSession.sessionId);
  });
});

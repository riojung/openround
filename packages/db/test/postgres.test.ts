import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { QuizDraft, Report } from "@openround/contracts";
import {
  acceptAnswer,
  addParticipant,
  applyHostCommand,
  createGameState,
} from "@openround/game-engine";
import { PostgresRepository } from "../src/postgres.js";
import { SessionCodeConflictError, SessionVersionConflictError } from "../src/types.js";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const runtimeUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(adminUrl && runtimeUrl);

describe.skipIf(!enabled)("PostgreSQL row-level isolation", () => {
  let repository: PostgresRepository;
  let runtimePool: Pool;

  beforeAll(async () => {
    const adminPool = new Pool({ connectionString: adminUrl });
    await adminPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_runtime') THEN
          CREATE ROLE openround_runtime NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_test_app') THEN
          CREATE ROLE openround_test_app LOGIN PASSWORD 'test-only-runtime';
        END IF;
      END $$;
      GRANT openround_runtime TO openround_test_app;
      GRANT CONNECT ON DATABASE openround TO openround_test_app;
    `);
    await adminPool.end();

    const migrationRepository = new PostgresRepository(adminUrl!);
    await migrationRepository.migrate();
    await migrationRepository.close();

    repository = new PostgresRepository(runtimeUrl!);
    runtimePool = new Pool({ connectionString: runtimeUrl });
    await repository.initialize();
  });

  afterAll(async () => {
    await repository?.close();
    await runtimePool?.end();
  });

  async function creator(label: string) {
    const tokenHash = `test-${label}-${randomUUID()}`;
    await repository.createMagicToken({
      id: randomUUID(),
      email: `${label}-${randomUUID()}@example.com`,
      segment: "education",
      tokenHash,
      policyVersion: "test-v1",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });
    const result = await repository.consumeMagicToken(tokenHash, new Date());
    expect(result).not.toBeNull();
    return result!;
  }

  it("shows only the active workspace and rejects cross-tenant writes", async () => {
    await repository.updateOperationalFeatures(
      { signups: true, sessionCreation: true, mediaUploads: true },
      `features-reset-${randomUUID()}`,
    );
    expect(
      await repository.updateOperationalFeatures(
        { signups: false, mediaUploads: false },
        `features-test-${randomUUID()}`,
      ),
    ).toMatchObject({ signups: false, sessionCreation: true, mediaUploads: false });
    expect(await repository.getOperationalFeatures()).toMatchObject({
      signups: false,
      sessionCreation: true,
      mediaUploads: false,
    });
    await repository.updateOperationalFeatures(
      { signups: true, mediaUploads: true },
      `features-restore-${randomUUID()}`,
    );

    const first = await creator("first");
    const second = await creator("second");
    const theme = {
      organizationName: "First Learning",
      primaryColor: "#0B2239",
      accentColor: "#087375",
    };
    expect(await repository.updateBrandTheme(first.workspaceId, theme)).toEqual(theme);
    expect(await repository.getBrandTheme(first.workspaceId)).toEqual(theme);
    expect(await repository.getBrandTheme(second.workspaceId)).toBeNull();
    const now = new Date();
    const firstQuiz = await repository.createQuiz({
      id: randomUUID(),
      workspaceId: first.workspaceId,
      title: "First workspace quiz",
      description: "",
      status: "draft",
      draft: { title: "First workspace quiz", description: "", questions: [] },
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    const secondQuiz = await repository.createQuiz({
      id: randomUUID(),
      workspaceId: second.workspaceId,
      title: "Second workspace quiz",
      description: "",
      status: "draft",
      draft: { title: "Second workspace quiz", description: "", questions: [] },
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    const mediaId = randomUUID();
    await repository.createMediaAsset({
      id: mediaId,
      workspaceId: first.workspaceId,
      objectKey: `quarantine/${first.workspaceId}/${mediaId}.png`,
      mimeType: "image/png",
      sizeBytes: 128,
      scanStatus: "pending",
      altText: "A labelled map",
      createdAt: now,
    });

    expect((await repository.listQuizzes(first.workspaceId)).map((quiz) => quiz.id)).toEqual([
      firstQuiz.id,
    ]);
    expect((await repository.listQuizzes(second.workspaceId)).map((quiz) => quiz.id)).toEqual([
      secondQuiz.id,
    ]);
    expect(await repository.getMediaAsset(second.workspaceId, mediaId)).toBeNull();
    expect(
      await repository.updateMediaAsset(first.workspaceId, mediaId, {
        scanStatus: "clean",
        objectKey: `media/${first.workspaceId}/${mediaId}.png`,
      }),
    ).toMatchObject({ scanStatus: "clean" });
    expect((await repository.listMediaAssets(first.workspaceId)).map(({ id }) => id)).toEqual([
      mediaId,
    ]);
    expect(await repository.deleteMediaAsset(second.workspaceId, mediaId)).toBe(false);
    const exported = await repository.exportAccount(first.userId);
    expect(exported.consentRecords).toHaveLength(2);
    expect(exported.mediaAssets).toHaveLength(1);
    expect(exported.quizVersions).toHaveLength(0);
    expect(exported.workspaces).toEqual(
      expect.arrayContaining([expect.objectContaining({ brand_theme: theme })]),
    );
    const correctChoiceId = randomUUID();
    const versionContent = {
      title: "First workspace quiz",
      description: "Batch answer persistence fixture",
      questions: [
        {
          id: randomUUID(),
          type: "true_false",
          prompt: "Batch commits are atomic.",
          choices: [
            { id: correctChoiceId, label: "True", isCorrect: true },
            { id: randomUUID(), label: "False", isCorrect: false },
          ],
          timeLimitSeconds: 30,
          basePoints: 1_000,
          explanation: "One transaction stores the answer burst and final state.",
          mediaId: null,
          mediaAlt: null,
        },
      ],
    } satisfies QuizDraft;
    await repository.updateQuiz(first.workspaceId, firstQuiz.id, versionContent);
    const firstVersion = await repository.publishQuiz({
      id: randomUUID(),
      workspaceId: first.workspaceId,
      quizId: firstQuiz.id,
      version: 1,
      content: versionContent,
      contentHash: randomUUID(),
      publishedAt: now,
    });

    const sessionId = randomUUID();
    const firstParticipantId = randomUUID();
    const secondParticipantId = randomUUID();
    let gameState = createGameState({
      sessionId,
      code: String(randomInt(1_000_000, 10_000_000)),
      quiz: versionContent,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    });
    for (const [id, nickname] of [
      [firstParticipantId, "First learner"],
      [secondParticipantId, "Second learner"],
    ] as const) {
      gameState = addParticipant(gameState, {
        id,
        nickname,
        score: 0,
        correctCount: 0,
        acceptedResponseMs: 0,
        connected: true,
        kicked: false,
      }).state;
    }
    const openedAtMs = Date.now();
    gameState = applyHostCommand(gameState, {
      commandId: randomUUID(),
      expectedVersion: gameState.version,
      action: "start",
      nowMs: openedAtMs,
      newRoundId: randomUUID,
    }).state;
    const persistedSession = {
      id: sessionId,
      workspaceId: first.workspaceId,
      quizVersionId: firstVersion.id,
      hostId: first.userId,
      hostTokenHash: randomUUID(),
      state: gameState,
      expiresAt: new Date(Date.now() + 60_000),
      retentionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
      createdAt: now,
      updatedAt: now,
    };
    await repository.createSession(persistedSession);
    const duplicateCodeSession = structuredClone(persistedSession);
    duplicateCodeSession.id = randomUUID();
    duplicateCodeSession.state.sessionId = duplicateCodeSession.id;
    duplicateCodeSession.hostTokenHash = randomUUID();
    await expect(repository.createSession(duplicateCodeSession)).rejects.toBeInstanceOf(
      SessionCodeConflictError,
    );
    await repository.commitParticipants(
      persistedSession,
      [
        {
          id: firstParticipantId,
          sessionId,
          nickname: "First learner",
          tokenHash: randomUUID(),
          status: "active",
          joinedAt: now,
        },
        {
          id: secondParticipantId,
          sessionId,
          nickname: "Second learner",
          tokenHash: randomUUID(),
          status: "active",
          joinedAt: now,
        },
      ],
      gameState.version,
    );
    expect(await repository.getParticipants(sessionId)).toHaveLength(2);
    const firstAccepted = acceptAnswer(gameState, {
      answerId: randomUUID(),
      participantId: firstParticipantId,
      roundId: gameState.roundId!,
      choiceId: correctChoiceId,
      idempotencyKey: randomUUID(),
      nowMs: openedAtMs + 100,
    });
    const secondAccepted = acceptAnswer(firstAccepted.state, {
      answerId: randomUUID(),
      participantId: secondParticipantId,
      roundId: gameState.roundId!,
      choiceId: correctChoiceId,
      idempotencyKey: randomUUID(),
      nowMs: openedAtMs + 200,
    });
    persistedSession.state = secondAccepted.state;
    expect(
      await repository.commitAnswers(
        persistedSession,
        [firstAccepted.answer, secondAccepted.answer],
        gameState.version,
      ),
    ).toHaveLength(2);
    expect((await repository.getSessionById(sessionId))?.state).toMatchObject({
      seq: secondAccepted.state.seq,
      version: secondAccepted.state.version,
      answers: {
        [firstAccepted.answer.answerId]: { score: 1_000 },
        [secondAccepted.answer.answerId]: { score: 1_000 },
      },
    });

    const staleSession = structuredClone(persistedSession);
    const locked = applyHostCommand(persistedSession.state, {
      commandId: randomUUID(),
      expectedVersion: persistedSession.state.version,
      action: "lock",
      nowMs: Date.now(),
      newRoundId: randomUUID,
    });
    persistedSession.state = locked.state;
    await repository.saveSession(persistedSession, staleSession.state.version);
    await expect(
      repository.saveSession(staleSession, staleSession.state.version),
    ).rejects.toBeInstanceOf(SessionVersionConflictError);
    expect((await repository.getSessionById(sessionId))?.state.phase).toBe("question_locked");

    const revealed = applyHostCommand(persistedSession.state, {
      commandId: randomUUID(),
      expectedVersion: persistedSession.state.version,
      action: "reveal",
      nowMs: Date.now(),
      newRoundId: randomUUID,
    });
    const report: Report = {
      id: randomUUID(),
      sessionId,
      status: "ready",
      generatedAt: new Date().toISOString(),
      expiresAt: persistedSession.retentionExpiresAt.toISOString(),
      metrics: {
        participantCount: 2,
        completedCount: 2,
        answerCount: 2,
        accuracyPercent: 100,
      },
      questions: [],
      participants: [],
    };
    const invalidReport = { ...report, status: "invalid" } as unknown as Report;
    const failedFinalization = structuredClone(persistedSession);
    failedFinalization.state = revealed.state;
    await expect(
      repository.saveSession(failedFinalization, persistedSession.state.version, invalidReport),
    ).rejects.toBeDefined();
    expect((await repository.getSessionById(sessionId))?.state.phase).toBe("question_locked");
    expect(await repository.getReportBySession(first.workspaceId, sessionId)).toBeNull();

    persistedSession.state = revealed.state;
    await repository.saveSession(persistedSession, locked.state.version, report);
    expect((await repository.getSessionById(sessionId))?.state.phase).toBe("question_reveal");
    expect(await repository.getReportBySession(first.workspaceId, sessionId)).toMatchObject({
      id: report.id,
      sessionId,
      status: "ready",
    });
    const thirdParticipantId = randomUUID();
    const staleJoin = addParticipant(staleSession.state, {
      id: thirdParticipantId,
      nickname: "Rolled back learner",
      score: 0,
      correctCount: 0,
      acceptedResponseMs: 0,
      connected: true,
      kicked: false,
    });
    staleSession.state = staleJoin.state;
    await expect(
      repository.commitParticipants(
        staleSession,
        [
          {
            id: thirdParticipantId,
            sessionId,
            nickname: "Rolled back learner",
            tokenHash: randomUUID(),
            status: "active",
            joinedAt: now,
          },
        ],
        secondAccepted.state.version,
      ),
    ).rejects.toBeInstanceOf(SessionVersionConflictError);
    expect(await repository.getParticipants(sessionId)).toHaveLength(2);

    const client = await runtimePool.connect();
    try {
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM quizzes")).rows[0]?.count,
      ).toBe(0);
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM users")).rows[0]?.count,
      ).toBe(0);
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM auth_magic_tokens")).rows[0]
          ?.count,
      ).toBe(0);
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM operational_settings")).rows[0]
          ?.count,
      ).toBe(0);
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [first.workspaceId]);
      expect(
        (await client.query("SELECT array_agg(id ORDER BY id) AS ids FROM quizzes")).rows[0]?.ids,
      ).toEqual([firstQuiz.id]);
      await expect(
        client.query(
          `INSERT INTO quizzes (id, workspace_id, title, description, status, draft)
           VALUES ($1, $2, 'Blocked', '', 'draft', $3)`,
          [randomUUID(), second.workspaceId, JSON.stringify({ title: "Blocked", questions: [] })],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("ROLLBACK");

      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [first.workspaceId]);
      await expect(
        client.query("UPDATE quiz_versions SET version = 2 WHERE id = $1", [firstVersion.id]),
      ).rejects.toMatchObject({ code: "55000" });
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }

    const billingCreatedAt = new Date("2026-09-14T12:00:00.000Z");
    const billingEvent = {
      providerEventId: `evt-${randomUUID()}`,
      eventType: "checkout.session.completed",
      providerCreatedAt: billingCreatedAt,
      workspaceId: first.workspaceId,
      plan: "pro" as const,
      status: "active",
      customerId: `cus-${randomUUID()}`,
      subscriptionId: `sub-${randomUUID()}`,
    };
    expect(await repository.applyBillingEvent(billingEvent)).toBe(true);
    expect(await repository.applyBillingEvent(billingEvent)).toBe(false);
    expect(
      await repository.applyBillingEvent({
        providerEventId: `evt-${randomUUID()}`,
        eventType: "customer.subscription.deleted",
        providerCreatedAt: new Date("2026-09-14T11:00:00.000Z"),
        workspaceId: first.workspaceId,
        plan: "free",
        status: "canceled",
      }),
    ).toBe(true);
    expect(await repository.getPlan(first.workspaceId)).toBe("pro");
  });
});

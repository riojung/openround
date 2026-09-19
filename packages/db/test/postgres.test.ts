import { randomInt, randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  ProductEventNameSchema,
  type AuthoringDraft,
  type QuizDraft,
  type Report,
} from "@openround/contracts";
import {
  acceptAnswer,
  addParticipant,
  applyHostCommand,
  createGameState,
} from "@openround/game-engine";
import { PostgresRepository } from "../src/postgres.js";
import {
  SessionCodeConflictError,
  SessionNotActiveError,
  SessionVersionConflictError,
} from "../src/types.js";

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
    await migrationRepository.migrate();
    const migrations = await migrationRepository.pool.query<{
      version: number;
      name: string;
    }>("SELECT version, name FROM _openround_migrations ORDER BY version");
    expect(migrations.rows).toEqual([
      { version: 1, name: "initial" },
      { version: 2, name: "versioned_product_foundation" },
      { version: 3, name: "collaboration_and_qna" },
      { version: 4, name: "library_organization" },
      { version: 5, name: "secure_presenter_embed" },
      { version: 6, name: "self_paced_followups" },
      { version: 7, name: "authoring_assistant" },
      { version: 8, name: "authoring_apply_idempotency" },
      { version: 9, name: "institution_identity_foundation" },
      { version: 10, name: "lti_launch_and_deep_linking" },
      { version: 11, name: "audience_interactions" },
      { version: 12, name: "interaction_feature_flags" },
      { version: 13, name: "close_finished_interactions" },
      { version: 14, name: "ux_beta_foundation" },
      { version: 15, name: "product_event_funnel" },
      { version: 16, name: "round_last_hosted_indexes" },
    ]);

    // An existing P0 database has the full schema but no ledger. Replaying the
    // idempotent baseline must safely bootstrap tracking before later migrations.
    await migrationRepository.pool.query("DROP TABLE _openround_migrations");
    await migrationRepository.migrate();
    const bootstrapped = await migrationRepository.pool.query<{ count: string }>(
      "SELECT count(*) FROM _openround_migrations",
    );
    expect(bootstrapped.rows[0]?.count).toBe("16");

    const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const alteredDirectory = await mkdtemp(join(tmpdir(), "openround-altered-migrations-"));
    try {
      await cp(migrationsDirectory, alteredDirectory, { recursive: true });
      const initialPath = join(alteredDirectory, "001_initial.sql");
      const initial = await readFile(initialPath, "utf8");
      await writeFile(initialPath, `${initial}\n-- modified after application\n`);
      const alteredRepository = new PostgresRepository(adminUrl!, {
        migrationsDirectory: alteredDirectory,
      });
      await expect(alteredRepository.migrate()).rejects.toThrow("Checksum mismatch");
      await alteredRepository.close();
    } finally {
      await rm(alteredDirectory, { recursive: true, force: true });
    }
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

  it("paginates histories without losing PostgreSQL microsecond precision", async () => {
    const owner = await creator("report-cursor");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60_000);
    const content = {
      title: "Cursor precision",
      description: "",
      questions: [],
    } satisfies QuizDraft;
    const quizId = randomUUID();
    await repository.createQuiz({
      id: quizId,
      workspaceId: owner.workspaceId,
      title: content.title,
      description: content.description,
      status: "draft",
      draft: content,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    const version = await repository.publishQuiz({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      quizId,
      version: 1,
      content,
      contentHash: randomUUID(),
      publishedAt: now,
    });
    const sessionIds: string[] = [];
    const reportIds: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const sessionId = randomUUID();
      sessionIds.push(sessionId);
      await repository.createSession({
        id: sessionId,
        workspaceId: owner.workspaceId,
        quizVersionId: version.id,
        hostId: owner.userId,
        hostTokenHash: randomUUID(),
        state: createGameState({
          sessionId,
          code: randomInt(1_000_000, 10_000_000).toString(),
          quiz: content,
          settings: {
            audienceLimit: 20,
            scoringMode: "accuracy",
            resultVisibility: "private",
            allowLateJoin: true,
            nicknamePolicy: "friendly_only",
          },
        }),
        expiresAt,
        retentionExpiresAt: expiresAt,
        createdAt: now,
        updatedAt: now,
      });
      const reportId = randomUUID();
      reportIds.push(reportId);
      await repository.saveReport(owner.workspaceId, {
        id: reportId,
        sessionId,
        status: "ready",
        generatedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        metrics: {
          participantCount: 0,
          completedCount: 0,
          answerCount: 0,
          accuracyPercent: 0,
        },
        questions: [],
        participants: [],
      });
    }

    const client = await runtimePool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [owner.workspaceId]);
      await client.query(
        `UPDATE reports
         SET created_at = CASE id
           WHEN $1::uuid THEN '2026-09-18T12:00:00.000900Z'::timestamptz
           WHEN $2::uuid THEN '2026-09-18T12:00:00.000100Z'::timestamptz
         END
         WHERE id = ANY($3::uuid[])`,
        [reportIds[0], reportIds[1], reportIds],
      );
      await client.query(
        `UPDATE game_sessions
         SET created_at = CASE id
           WHEN $1::uuid THEN '2026-09-18T12:00:00.000900Z'::timestamptz
           WHEN $2::uuid THEN '2026-09-18T12:00:00.000100Z'::timestamptz
         END
         WHERE id = ANY($3::uuid[])`,
        [sessionIds[0], sessionIds[1], sessionIds],
      );
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    const firstPage = await repository.listReportHistory(owner.workspaceId, {
      limit: 1,
      now,
    });
    expect(firstPage).toMatchObject({
      hasMore: true,
      items: [{ id: reportIds[0], cursorCreatedAt: "2026-09-18T12:00:00.000900Z" }],
    });
    const firstItem = firstPage.items[0]!;
    const secondPage = await repository.listReportHistory(owner.workspaceId, {
      limit: 1,
      cursor: {
        createdAt: firstItem.createdAt,
        cursorCreatedAt: firstItem.cursorCreatedAt,
        id: firstItem.id,
      },
      now,
    });
    expect(secondPage.items.map(({ id }) => id)).toEqual([reportIds[1]]);

    const firstSessionPage = await repository.listSessionHistory(owner.workspaceId, {
      limit: 1,
      now,
    });
    expect(firstSessionPage).toMatchObject({
      hasMore: true,
      items: [{ id: sessionIds[0], cursorCreatedAt: "2026-09-18T12:00:00.000900Z" }],
    });
    const firstSession = firstSessionPage.items[0]!;
    const secondSessionPage = await repository.listSessionHistory(owner.workspaceId, {
      limit: 1,
      cursor: {
        createdAt: firstSession.createdAt,
        cursorCreatedAt: firstSession.cursorCreatedAt,
        id: firstSession.id,
      },
      now,
    });
    expect(secondSessionPage.items.map(({ id }) => id)).toEqual([sessionIds[1]]);

    const followupIds = [randomUUID(), randomUUID()];
    const exactFollowupCreatedAts = ["2026-09-18T12:00:00.000900Z", "2026-09-18T12:00:00.000100Z"];
    const followupClient = await runtimePool.connect();
    try {
      await followupClient.query("BEGIN");
      await followupClient.query("SELECT set_config('app.workspace_id', $1, true)", [
        owner.workspaceId,
      ]);
      for (let index = 0; index < followupIds.length; index += 1) {
        await followupClient.query(
          `INSERT INTO followups
             (id, workspace_id, source_session_id, source_report_id, title, content,
              concept_keys, time_mode, generic_token_hash, opens_at, closes_at, expires_at,
              closed_at, created_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [
            followupIds[index],
            owner.workspaceId,
            sessionIds[index],
            reportIds[index],
            `Cursor follow-up ${index + 1}`,
            JSON.stringify(content),
            ["cursor-precision"],
            "flex",
            randomUUID(),
            now,
            expiresAt,
            expiresAt,
            null,
            owner.userId,
            exactFollowupCreatedAts[index],
          ],
        );
      }
      await followupClient.query("COMMIT");
    } catch (error) {
      await followupClient.query("ROLLBACK");
      throw error;
    } finally {
      followupClient.release();
    }

    const firstFollowupPage = await repository.listFollowupHistory(owner.workspaceId, {
      limit: 1,
      now,
    });
    expect(firstFollowupPage).toMatchObject({
      hasMore: true,
      items: [{ id: followupIds[0], cursorCreatedAt: "2026-09-18T12:00:00.000900Z" }],
    });
    const firstFollowup = firstFollowupPage.items[0]!;
    const secondFollowupPage = await repository.listFollowupHistory(owner.workspaceId, {
      limit: 1,
      cursor: {
        createdAt: firstFollowup.createdAt,
        cursorCreatedAt: firstFollowup.cursorCreatedAt,
        id: firstFollowup.id,
      },
      now,
    });
    expect(secondFollowupPage.items.map(({ id }) => id)).toEqual([followupIds[1]]);
  });

  it("shows only the active workspace and rejects cross-tenant writes", async () => {
    await repository.updateOperationalFeatures(
      {
        signups: true,
        sessionCreation: true,
        mediaUploads: true,
        roundExperiences: true,
        audiencePulse: true,
        roomChat: true,
      },
      `features-reset-${randomUUID()}`,
    );
    expect(
      await repository.updateOperationalFeatures(
        {
          signups: false,
          mediaUploads: false,
          roundExperiences: false,
          audiencePulse: false,
          roomChat: false,
        },
        `features-test-${randomUUID()}`,
      ),
    ).toMatchObject({
      signups: false,
      sessionCreation: true,
      mediaUploads: false,
      roundExperiences: false,
      audiencePulse: false,
      roomChat: false,
    });
    expect(await repository.getOperationalFeatures()).toMatchObject({
      signups: false,
      sessionCreation: true,
      mediaUploads: false,
      roundExperiences: false,
      audiencePulse: false,
      roomChat: false,
    });
    await repository.updateOperationalFeatures(
      {
        signups: true,
        mediaUploads: true,
        roundExperiences: true,
        audiencePulse: true,
        roomChat: true,
      },
      `features-restore-${randomUUID()}`,
    );

    const first = await creator("first");
    const second = await creator("second");
    const invitationTokenHash = `invite-${randomUUID()}`;
    const workspaceInvitation = await repository.createWorkspaceInvitation({
      id: randomUUID(),
      workspaceId: first.workspaceId,
      email: second.email,
      role: "editor",
      tokenHash: invitationTokenHash,
      invitedBy: first.userId,
      expiresAt: new Date(Date.now() + 60_000),
      acceptedAt: null,
      revokedAt: null,
      createdAt: new Date(),
    });
    expect(await repository.listWorkspaceInvitations(second.workspaceId)).toEqual([]);
    expect(await repository.listWorkspaceInvitations(first.workspaceId)).toHaveLength(1);
    expect(
      await repository.acceptWorkspaceInvitation(invitationTokenHash, new Date(), "test-v1"),
    ).toMatchObject({ workspaceId: first.workspaceId, userId: second.userId, role: "editor" });
    expect(
      await repository.acceptWorkspaceInvitation(invitationTokenHash, new Date(), "test-v1"),
    ).toBeNull();
    expect((await repository.listWorkspaces(second.userId)).map(({ id }) => id).sort()).toEqual(
      [first.workspaceId, second.workspaceId].sort(),
    );
    const creatorSessionToken = `creator-session-${randomUUID()}`;
    await repository.createCreatorSession({
      id: randomUUID(),
      userId: second.userId,
      tokenHash: creatorSessionToken,
      expiresAt: new Date(Date.now() + 60_000),
      activeWorkspaceId: first.workspaceId,
    });
    expect(await repository.getCreatorBySession(creatorSessionToken, new Date())).toMatchObject({
      workspaceId: first.workspaceId,
      role: "editor",
    });
    expect(
      await repository.updateWorkspaceMemberRole(first.workspaceId, second.userId, "viewer"),
    ).toMatchObject({ role: "viewer" });
    expect(await repository.getCreatorBySession(creatorSessionToken, new Date())).toMatchObject({
      workspaceId: first.workspaceId,
      role: "viewer",
    });
    const viewerExport = await repository.exportAccount(second.userId);
    expect(viewerExport.workspaceMemberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.workspaceId, role: "viewer" }),
        expect.objectContaining({ id: second.workspaceId, role: "owner" }),
      ]),
    );
    expect(
      (viewerExport.workspaces as Array<{ id: string }>).map((workspace) => workspace.id),
    ).toEqual([second.workspaceId]);
    expect(
      await repository.setCreatorSessionWorkspace(
        creatorSessionToken,
        second.userId,
        second.workspaceId,
      ),
    ).toBe(true);
    expect(await repository.getCreatorBySession(creatorSessionToken, new Date())).toMatchObject({
      workspaceId: second.workspaceId,
      role: "owner",
    });
    expect(await repository.removeWorkspaceMember(first.workspaceId, second.userId)).toBe(true);
    expect(
      (await repository.listWorkspaceMembers(first.workspaceId)).map(({ role }) => role),
    ).toEqual(["owner"]);
    expect(
      await repository.revokeWorkspaceInvitation(first.workspaceId, workspaceInvitation.id),
    ).toBe(false);
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
    const tiedFirstQuiz = await repository.createQuiz({
      id: randomUUID(),
      workspaceId: first.workspaceId,
      title: "Tied first workspace quiz",
      description: "",
      status: "draft",
      draft: { title: "Tied first workspace quiz", description: "", questions: [] },
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

    expect((await repository.listQuizzes(first.workspaceId)).map((quiz) => quiz.id)).toEqual(
      [firstQuiz.id, tiedFirstQuiz.id].sort((left, right) => right.localeCompare(left)),
    );
    expect((await repository.listQuizzes(second.workspaceId)).map((quiz) => quiz.id)).toEqual([
      secondQuiz.id,
    ]);
    const firstFolder = await repository.createFolder({
      id: randomUUID(),
      workspaceId: first.workspaceId,
      name: "Core training",
      createdAt: now,
      updatedAt: now,
    });
    await repository.createFolder({
      id: randomUUID(),
      workspaceId: second.workspaceId,
      name: "Core training",
      createdAt: now,
      updatedAt: now,
    });
    expect(
      await repository.organizeQuiz(first.workspaceId, firstQuiz.id, firstFolder.id, ["Safety"]),
    ).toMatchObject({ folderId: firstFolder.id, tags: ["Safety"] });
    expect(
      await repository.organizeQuiz(second.workspaceId, secondQuiz.id, firstFolder.id, []),
    ).toBeNull();
    expect(await repository.listFolders(first.workspaceId)).toEqual([
      expect.objectContaining({ id: firstFolder.id, name: "Core training" }),
    ]);
    expect(
      await repository.renameFolder(first.workspaceId, firstFolder.id, "Required training"),
    ).toMatchObject({ name: "Required training" });
    expect(await repository.deleteFolder(first.workspaceId, firstFolder.id)).toBe(true);
    expect(await repository.getQuiz(first.workspaceId, firstQuiz.id)).toMatchObject({
      folderId: null,
      tags: ["Safety"],
    });
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
    expect(await repository.listQuizzes(first.workspaceId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: firstQuiz.id, lastHostedAt: now }),
        expect.objectContaining({ id: tiedFirstQuiz.id, lastHostedAt: null }),
      ]),
    );
    expect(await repository.listQuizzes(second.workspaceId)).toEqual([
      expect.objectContaining({ id: secondQuiz.id, lastHostedAt: null }),
    ]);
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
    ).toEqual([firstAccepted.answer, secondAccepted.answer]);
    expect(await repository.exportAccount(first.userId)).toMatchObject({
      answers: [
        expect.objectContaining({
          response_payload: { kind: "choice", choiceIds: [correctChoiceId] },
          response_schema_version: 2,
          confidence: null,
        }),
        expect.objectContaining({
          response_payload: { kind: "choice", choiceIds: [correctChoiceId] },
          response_schema_version: 2,
          confidence: null,
        }),
      ],
    });
    expect((await repository.getSessionById(sessionId))?.state).toMatchObject({
      seq: secondAccepted.state.seq,
      version: secondAccepted.state.version,
      answers: {
        [firstAccepted.answer.answerId]: { score: 1_000 },
        [secondAccepted.answer.answerId]: { score: 1_000 },
      },
    });
    expect(await repository.getSessionEvidence(first.workspaceId, sessionId)).toMatchObject({
      answers: [
        { answerId: firstAccepted.answer.answerId },
        { answerId: secondAccepted.answer.answerId },
      ],
      rounds: [
        {
          id: gameState.roundId,
          kind: "main",
          sourceRoundId: null,
          lockedAtMs: null,
        },
      ],
      interventions: [],
      qna: { questions: 0, answered: 0, unresolved: 0 },
    });
    persistedSession.state = { ...persistedSession.state, answers: {} };
    await repository.saveSession(persistedSession, persistedSession.state.version);
    expect(
      await repository.listSessionHistory(first.workspaceId, {
        limit: 25,
        now: new Date(),
      }),
    ).toMatchObject({
      items: [expect.objectContaining({ id: sessionId, answerCount: 2 })],
    });
    expect(
      await repository.listSessionHistory(second.workspaceId, {
        limit: 25,
        now: new Date(),
      }),
    ).toMatchObject({ items: [] });

    const staffTokenHash = `staff-${randomUUID()}`;
    const staffCredential = await repository.createSessionStaffCredential({
      id: randomUUID(),
      workspaceId: first.workspaceId,
      sessionId,
      role: "cohost",
      label: "Teaching assistant",
      tokenHash: staffTokenHash,
      createdBy: first.userId,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      createdAt: now,
    });
    expect(await repository.getSessionStaffByToken(staffTokenHash, now)).toMatchObject({
      id: staffCredential.id,
      role: "cohost",
    });
    expect(await repository.listSessionStaff(second.workspaceId, sessionId)).toEqual([]);

    const firstResumeTokenHash = `creator-resume-${randomUUID()}`;
    const firstResumeReplacement = await repository.replaceCreatorResumeCredential({
      id: randomUUID(),
      workspaceId: first.workspaceId,
      sessionId,
      role: "cohost",
      purpose: "creator_resume",
      label: "Creator resume",
      tokenHash: firstResumeTokenHash,
      embedPolicyKeyHash: null,
      embedAllowedOrigins: [],
      createdBy: first.userId,
      expiresAt: new Date(now.getTime() + 4 * 60 * 60_000),
      revokedAt: null,
      createdAt: now,
    });
    const firstResume = firstResumeReplacement.credential;
    expect(firstResumeReplacement.revokedCredentialIds).toEqual([]);
    const secondResumeTokenHash = `creator-resume-${randomUUID()}`;
    const secondResumeReplacement = await repository.replaceCreatorResumeCredential({
      ...firstResume,
      id: randomUUID(),
      tokenHash: secondResumeTokenHash,
      createdAt: new Date(now.getTime() + 1),
    });
    const secondResume = secondResumeReplacement.credential;
    expect(secondResumeReplacement.revokedCredentialIds).toEqual([firstResume.id]);
    expect(await repository.getSessionStaffByToken(firstResumeTokenHash, now)).toBeNull();
    expect(await repository.getSessionStaffByToken(secondResumeTokenHash, now)).toMatchObject({
      id: secondResume.id,
      purpose: "creator_resume",
    });
    expect(
      (await repository.listSessionStaff(first.workspaceId, sessionId)).filter(
        (credential) => credential.purpose === "creator_resume" && !credential.revokedAt,
      ),
    ).toHaveLength(1);
    const expiryClient = await runtimePool.connect();
    try {
      await expiryClient.query("BEGIN");
      await expiryClient.query("SELECT set_config('app.workspace_id', $1, true)", [
        first.workspaceId,
      ]);
      await expiryClient.query(
        "UPDATE game_sessions SET expires_at = clock_timestamp() - interval '1 second' WHERE id = $1",
        [sessionId],
      );
      await expiryClient.query("COMMIT");
      await expect(
        repository.replaceCreatorResumeCredential({
          ...secondResume,
          id: randomUUID(),
          tokenHash: `creator-resume-${randomUUID()}`,
          createdAt: new Date(),
        }),
      ).rejects.toBeInstanceOf(SessionNotActiveError);
    } finally {
      await expiryClient.query("BEGIN");
      await expiryClient.query("SELECT set_config('app.workspace_id', $1, true)", [
        first.workspaceId,
      ]);
      await expiryClient.query("UPDATE game_sessions SET expires_at = $2 WHERE id = $1", [
        sessionId,
        persistedSession.expiresAt,
      ]);
      await expiryClient.query("COMMIT");
      expiryClient.release();
    }

    expect(
      await repository.saveQnaSettings({
        workspaceId: first.workspaceId,
        sessionId,
        enabled: true,
        displayMode: "anonymous_public",
        moderationMode: "pre",
        participantReplies: false,
        updatedAt: now,
      }),
    ).toMatchObject({ sessionId, moderationMode: "pre" });
    const qnaQuestion = await repository.createQnaQuestion({
      id: randomUUID(),
      workspaceId: first.workspaceId,
      sessionId,
      participantId: firstParticipantId,
      body: "Could you explain why this transaction is atomic?",
      publicAlias: "First learner",
      status: "published",
      label: "clarification",
      voteCount: 0,
      votedByViewer: false,
      createdAt: now,
      updatedAt: now,
    });
    expect(
      await repository.setQnaVote(
        first.workspaceId,
        sessionId,
        qnaQuestion.id,
        secondParticipantId,
        true,
      ),
    ).toBe(1);
    expect(
      await repository.setQnaVote(
        first.workspaceId,
        sessionId,
        qnaQuestion.id,
        secondParticipantId,
        true,
      ),
    ).toBe(1);
    const qnaReply = await repository.createQnaReply({
      id: randomUUID(),
      workspaceId: first.workspaceId,
      sessionId,
      questionId: qnaQuestion.id,
      participantId: null,
      actorId: first.userId,
      staffCredentialId: null,
      body: "The state and answer rows commit in one database transaction.",
      publicAlias: "Facilitator",
      status: "published",
      createdAt: now,
      updatedAt: now,
    });
    expect(await repository.getQnaReply(second.workspaceId, qnaReply.id)).toBeNull();
    expect(
      await repository.updateQnaQuestion(first.workspaceId, qnaQuestion.id, {
        status: "answered",
        label: qnaQuestion.label,
      }),
    ).toMatchObject({ status: "answered", voteCount: 1 });
    expect(await repository.getSessionEvidence(first.workspaceId, sessionId)).toMatchObject({
      qna: { questions: 1, answered: 1, unresolved: 0 },
    });
    expect(await repository.getQnaQuestion(second.workspaceId, qnaQuestion.id)).toBeNull();

    const interactionNow = new Date(now.getTime() + 1_000);
    const settingsEvent = {
      eventId: randomUUID(),
      idempotencyKey: randomUUID(),
      type: "audience.settings.updated",
      payload: { chatEnabled: true },
    };
    const interactionSettings = {
      workspaceId: first.workspaceId,
      sessionId,
      signalsEnabled: true,
      chatEnabled: true,
      chatIdentityMode: "alias_private" as const,
      slowModeSeconds: 0 as const,
      presenterFeedMode: "pinned" as const,
      updatedAt: interactionNow,
    };
    const savedSettings = await repository.saveInteractionSettings(
      interactionSettings,
      settingsEvent,
    );
    expect(savedSettings).toMatchObject({
      duplicate: false,
      record: { chatEnabled: true, audienceSeq: 1 },
      event: { audienceSeq: 1 },
    });
    expect(
      await repository.saveInteractionSettings(interactionSettings, settingsEvent),
    ).toMatchObject({ duplicate: true, event: { audienceSeq: 1 } });
    expect(await repository.getInteractionSettings(second.workspaceId, sessionId)).toBeNull();

    const signalMutation = await repository.setParticipantSignal(
      {
        workspaceId: first.workspaceId,
        sessionId,
        contextKey: `round:${gameState.roundId}`,
        participantId: firstParticipantId,
        signal: "need_example",
        now: new Date(interactionNow.getTime() + 1),
      },
      {
        eventId: randomUUID(),
        idempotencyKey: randomUUID(),
        type: "audience.signal.updated",
        payload: {},
      },
    );
    expect(signalMutation).toMatchObject({
      record: { signal: "need_example" },
      event: { audienceSeq: 2 },
    });

    const messageId = randomUUID();
    const chatIdempotencyKey = randomUUID();
    const chatMutation = await repository.createChatMessage(
      {
        id: messageId,
        workspaceId: first.workspaceId,
        sessionId,
        participantId: firstParticipantId,
        actorId: null,
        staffCredentialId: null,
        replyToId: null,
        body: "Could we see another example?",
        authorAlias: "First learner",
        identityModeAtCreation: "alias_public",
        status: "published",
        pinned: false,
        idempotencyKey: chatIdempotencyKey,
        createdAt: new Date(interactionNow.getTime() + 2),
        updatedAt: new Date(interactionNow.getTime() + 2),
      },
      {
        eventId: randomUUID(),
        idempotencyKey: chatIdempotencyKey,
        type: "chat.message.created",
        payload: {},
      },
    );
    expect(chatMutation).toMatchObject({
      record: { identityModeAtCreation: "alias_private" },
      event: { audienceSeq: 3 },
    });
    expect(
      await repository.setChatReaction(
        {
          workspaceId: first.workspaceId,
          sessionId,
          messageId,
          participantId: secondParticipantId,
          reaction: "insight",
          now: new Date(interactionNow.getTime() + 3),
        },
        {
          eventId: randomUUID(),
          idempotencyKey: randomUUID(),
          type: "chat.reaction.updated",
          payload: {},
        },
      ),
    ).toMatchObject({ record: { counts: { insight: 1 } }, event: { audienceSeq: 4 } });
    expect(
      await repository.reportChatMessage(
        first.workspaceId,
        sessionId,
        messageId,
        secondParticipantId,
        new Date(interactionNow.getTime() + 4),
        {
          eventId: randomUUID(),
          idempotencyKey: randomUUID(),
          type: "chat.message.reported",
          payload: {},
        },
      ),
    ).toMatchObject({ record: 1, event: { audienceSeq: 5 } });
    expect(
      await repository.updateChatMessage(
        first.workspaceId,
        sessionId,
        messageId,
        { pinned: true },
        {
          eventId: randomUUID(),
          idempotencyKey: randomUUID(),
          type: "chat.message.pinned",
          payload: {},
        },
        new Date(interactionNow.getTime() + 5),
      ),
    ).toMatchObject({ record: { pinned: true }, event: { audienceSeq: 6 } });

    const restrictedParticipant = {
      workspaceId: first.workspaceId,
      sessionId,
      participantId: firstParticipantId,
      mutedUntil: null,
      bannedAt: new Date(interactionNow.getTime() + 6),
      actorId: first.userId,
      staffCredentialId: null,
      updatedAt: new Date(interactionNow.getTime() + 6),
    };
    await repository.saveAudienceRestriction(restrictedParticipant, {
      eventId: randomUUID(),
      idempotencyKey: randomUUID(),
      type: "audience.moderation.updated",
      payload: {},
    });
    expect(await repository.isQnaBanned(first.workspaceId, sessionId, firstParticipantId)).toBe(
      true,
    );
    await repository.saveAudienceRestriction(
      {
        ...restrictedParticipant,
        bannedAt: null,
        updatedAt: new Date(interactionNow.getTime() + 7),
      },
      {
        eventId: randomUUID(),
        idempotencyKey: randomUUID(),
        type: "audience.moderation.updated",
        payload: {},
      },
    );
    expect(await repository.isQnaBanned(first.workspaceId, sessionId, firstParticipantId)).toBe(
      false,
    );
    expect(
      await repository.listChatMessages(first.workspaceId, sessionId, {
        limit: 1,
        pinnedOnly: true,
      }),
    ).toEqual([expect.objectContaining({ id: messageId, pinned: true })]);
    expect(await repository.listChatReactions(first.workspaceId, sessionId, [messageId])).toEqual([
      expect.objectContaining({ messageId, reaction: "insight" }),
    ]);
    expect(
      await repository.getChatActivitySummary(
        first.workspaceId,
        sessionId,
        new Date(interactionNow.getTime() - 1),
      ),
    ).toMatchObject({
      messagesLastMinute: 1,
      uniqueContributors: 1,
      removedMessages: 0,
      reportCount: 1,
    });
    expect(await repository.listParticipantChatActivity(first.workspaceId, sessionId)).toEqual([
      expect.objectContaining({ participantId: firstParticipantId, messageCount: 1 }),
    ]);
    expect(await repository.listAudienceRestrictions(first.workspaceId, sessionId)).toEqual([
      expect.objectContaining({ participantId: firstParticipantId, bannedAt: null }),
    ]);
    expect(await repository.getSessionEvidence(first.workspaceId, sessionId)).toMatchObject({
      interactions: {
        signalEvents: [expect.objectContaining({ signal: "need_example" })],
        chatMessages: [expect.objectContaining({ id: messageId, pinned: true })],
        reactions: [expect.objectContaining({ reaction: "insight" })],
        reports: 1,
        moderationActions: 2,
      },
    });
    expect(await repository.getAudienceOutboxStatus()).toMatchObject({
      pending: 8,
      chatEnabledSessions: 1,
    });
    const claimedAudienceEvent = await repository.claimAudienceOutbox(
      new Date(interactionNow.getTime() + 8),
      new Date(0),
    );
    expect(claimedAudienceEvent).toMatchObject({ attempts: 1 });
    expect(
      await repository.completeAudienceOutbox(
        claimedAudienceEvent!.eventId,
        new Date(interactionNow.getTime() + 9),
      ),
    ).toBe(true);
    expect(
      await repository.completeAudienceOutbox(
        claimedAudienceEvent!.eventId,
        new Date(interactionNow.getTime() + 10),
      ),
    ).toBe(false);
    expect(await repository.getAudienceOutboxStatus()).toMatchObject({ pending: 7 });
    const qnaAudienceEvent = {
      eventId: randomUUID(),
      idempotencyKey: randomUUID(),
      type: "qna.question.created",
      payload: { questionId: qnaQuestion.id },
    };
    expect(
      await repository.appendAudienceEvent(
        first.workspaceId,
        sessionId,
        qnaAudienceEvent,
        new Date(interactionNow.getTime() + 11),
      ),
    ).toMatchObject({ duplicate: false, event: { audienceSeq: 9 } });
    expect(
      await repository.appendAudienceEvent(
        first.workspaceId,
        sessionId,
        qnaAudienceEvent,
        new Date(interactionNow.getTime() + 12),
      ),
    ).toMatchObject({ duplicate: true, event: { audienceSeq: 9 } });
    expect(
      await repository.revokeSessionStaff(first.workspaceId, randomUUID(), staffCredential.id),
    ).toBe(false);
    expect(await repository.getSessionStaffByToken(staffTokenHash, now)).not.toBeNull();
    expect(
      await repository.revokeSessionStaff(first.workspaceId, sessionId, staffCredential.id),
    ).toBe(true);
    expect(await repository.getSessionStaffByToken(staffTokenHash, now)).toBeNull();

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
    expect(
      (await repository.getSessionEvidence(first.workspaceId, sessionId)).rounds[0]?.lockedAtMs,
    ).not.toBeNull();

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

    const pendingReport: Report = { ...report, status: "pending", generatedAt: null };
    await repository.saveReport(first.workspaceId, pendingReport);
    const reportJob = await repository.claimReportJob(
      new Date(Date.now() + 1_000),
      new Date(Date.now() + 61_000),
    );
    expect(reportJob).toMatchObject({ reportId: report.id, workspaceId: first.workspaceId });
    await repository.retryReportJob(reportJob!, "terminal report failure", now, true);
    expect(await repository.getReport(first.workspaceId, report.id)).toMatchObject({
      status: "failed",
      generatedAt: null,
    });
    expect(
      await repository.listReportHistory(first.workspaceId, { limit: 10, status: "failed", now }),
    ).toMatchObject({
      items: [expect.objectContaining({ id: report.id, status: "failed", generatedAt: null })],
    });
    expect(
      await repository.listReportHistory(first.workspaceId, { limit: 10, status: "pending", now }),
    ).toMatchObject({ items: [] });

    persistedSession.state = revealed.state;
    await repository.saveSession(persistedSession, locked.state.version, report);
    expect((await repository.getSessionById(sessionId))?.state.phase).toBe("question_reveal");
    expect(await repository.getReportBySession(first.workspaceId, sessionId)).toMatchObject({
      id: report.id,
      sessionId,
      status: "ready",
    });
    const followupId = randomUUID();
    const genericFollowupTokenHash = `generic-${randomUUID()}`;
    const personalFollowupTokenHash = `personal-${randomUUID()}`;
    const followupClosesAt = new Date(Date.now() + 24 * 60 * 60_000);
    await repository.createFollowup(
      {
        id: followupId,
        workspaceId: first.workspaceId,
        sourceSessionId: sessionId,
        sourceReportId: report.id,
        title: "Database follow-up",
        content: versionContent,
        conceptKeys: ["transactions"],
        timeMode: "flex",
        genericTokenHash: genericFollowupTokenHash,
        opensAt: now,
        closesAt: followupClosesAt,
        expiresAt: persistedSession.retentionExpiresAt,
        closedAt: null,
        createdBy: first.userId,
        createdAt: now,
      },
      [
        {
          id: randomUUID(),
          workspaceId: first.workspaceId,
          followupId,
          sourceParticipantId: firstParticipantId,
          kind: "personal",
          label: "First learner",
          tokenHash: personalFollowupTokenHash,
          timeMultiplier: 1,
          expiresAt: followupClosesAt,
          revokedAt: null,
          createdAt: now,
        },
      ],
    );
    expect(await repository.listReportHistory(first.workspaceId, { limit: 10, now })).toMatchObject(
      {
        items: [expect.objectContaining({ followupId, followupStatus: "open" })],
      },
    );
    expect(
      await repository.listFollowupHistory(first.workspaceId, {
        limit: 10,
        status: "open",
        quizId: firstQuiz.id,
        from: new Date(now.getTime() - 1),
        to: new Date(now.getTime() + 1),
        now,
      }),
    ).toMatchObject({
      items: [expect.objectContaining({ id: followupId, quizId: firstQuiz.id, status: "open" })],
    });
    expect(
      await repository.listFollowupHistory(first.workspaceId, {
        limit: 10,
        quizId: tiedFirstQuiz.id,
        now,
      }),
    ).toMatchObject({ items: [] });
    expect(
      await repository.listFollowupHistory(second.workspaceId, {
        limit: 10,
        quizId: firstQuiz.id,
        now,
      }),
    ).toMatchObject({ items: [] });
    expect(await repository.getFollowup(second.workspaceId, followupId)).toBeNull();
    expect(await repository.getFollowupByReport(first.workspaceId, report.id)).toMatchObject({
      id: followupId,
      content: versionContent,
    });
    const personalAccess = await repository.getFollowupAccessByToken(
      followupId,
      personalFollowupTokenHash,
      now,
    );
    expect(personalAccess).toMatchObject({ sourceParticipantId: firstParticipantId });
    expect(
      await repository.getFollowupByGenericToken(followupId, genericFollowupTokenHash, now),
    ).toMatchObject({ id: followupId });
    const attemptTokenHash = personalFollowupTokenHash;
    const attempt = await repository.createOrGetFollowupAttempt({
      id: randomUUID(),
      workspaceId: first.workspaceId,
      followupId,
      accessTokenId: personalAccess!.id,
      sourceParticipantId: firstParticipantId,
      attemptTokenHash,
      status: "in_progress",
      phase: "question_open",
      currentIndex: 0,
      version: 0,
      timeMultiplier: 1,
      questionOpenedAt: now,
      deadlineAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const followupAnswer = {
      id: randomUUID(),
      workspaceId: first.workspaceId,
      followupId,
      attemptId: attempt.id,
      checkpointId: versionContent.questions[0]!.id,
      response: { kind: "choice" as const, choiceIds: [correctChoiceId] },
      confidence: 2 as const,
      correct: true,
      idempotencyKey: randomUUID(),
      acceptedAt: now,
    };
    const revealedAttempt = { ...attempt, phase: "answer_reveal" as const, version: 1 };
    expect(
      await repository.commitFollowupAnswer(revealedAttempt, followupAnswer, attempt.version),
    ).toMatchObject({ correct: true, confidence: 2 });
    expect(
      await repository.commitFollowupAnswer(revealedAttempt, followupAnswer, attempt.version),
    ).toMatchObject({ id: followupAnswer.id });
    const completedAttempt = {
      ...revealedAttempt,
      status: "completed" as const,
      phase: "completed" as const,
      version: 2,
      completedAt: now,
    };
    expect(await repository.advanceFollowupAttempt(completedAttempt, 1)).toBe(true);
    expect(
      await repository.getFollowupAttemptByToken(followupId, attemptTokenHash, now),
    ).toMatchObject({ status: "completed", version: 2 });
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

    const productEventId = randomUUID();
    const productEventExpiry = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
    await repository.recordProductEvents([
      {
        id: productEventId,
        workspaceId: first.workspaceId,
        name: "rehearsal_completed",
        occurredAt: now.toISOString(),
        dimensions: {
          scenario: "split_room",
          segment: "education",
          betaVersion: "p0-2026",
          durationBucket: "1_to_5m",
        },
        expiresAt: productEventExpiry,
        createdAt: now,
      },
    ]);
    expect(await repository.purgeProductEvents(new Date(productEventExpiry.getTime() - 1))).toBe(0);

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
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM qna_questions")).rows[0]?.count,
      ).toBe(0);
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM chat_messages")).rows[0]?.count,
      ).toBe(0);
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM audience_outbox")).rows[0]
          ?.count,
      ).toBe(0);
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM product_events")).rows[0]
          ?.count,
      ).toBe(0);
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [first.workspaceId]);
      expect(
        (await client.query("SELECT array_agg(id ORDER BY id) AS ids FROM quizzes")).rows[0]?.ids,
      ).toEqual([firstQuiz.id, tiedFirstQuiz.id].sort());
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM qna_questions")).rows[0]?.count,
      ).toBe(1);
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM followups")).rows[0]?.count,
      ).toBe(1);
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM chat_messages")).rows[0]?.count,
      ).toBe(1);
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM audience_outbox")).rows[0]
          ?.count,
      ).toBe(9);
      expect(
        (await client.query("SELECT array_agg(id ORDER BY id) AS ids FROM product_events")).rows[0]
          ?.ids,
      ).toEqual([productEventId]);
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

      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [first.workspaceId]);
      await expect(
        client.query("UPDATE followups SET title = 'Changed' WHERE id = $1", [followupId]),
      ).rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    expect(await repository.purgeProductEvents(productEventExpiry)).toBe(1);

    const finishedState = applyHostCommand(persistedSession.state, {
      commandId: randomUUID(),
      expectedVersion: persistedSession.state.version,
      action: "next",
      nowMs: Date.now(),
      newRoundId: randomUUID,
    }).state;
    const beforeFinishVersion = persistedSession.state.version;
    persistedSession.state = finishedState;
    await repository.saveSession(persistedSession, beforeFinishVersion);
    expect(await repository.getInteractionSettings(first.workspaceId, sessionId)).toMatchObject({
      signalsEnabled: false,
      chatEnabled: false,
      closedAt: expect.any(Date),
    });
    await expect(
      repository.setParticipantSignal(
        {
          workspaceId: first.workspaceId,
          sessionId,
          contextKey: `round:${finishedState.roundId}`,
          participantId: firstParticipantId,
          signal: "got_it",
          now: new Date(),
        },
        {
          eventId: randomUUID(),
          idempotencyKey: randomUUID(),
          type: "audience.signal.updated",
          payload: {},
        },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

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

  it("enforces the expanded bounded product-event name allowlist", async () => {
    const owner = await creator("product-event-funnel");
    const now = new Date("2026-09-18T12:00:00.000Z");
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
    await repository.recordProductEvents(
      ProductEventNameSchema.options.map((name) => ({
        id: randomUUID(),
        workspaceId: owner.workspaceId,
        name,
        occurredAt: now.toISOString(),
        dimensions: { betaVersion: "p0-2026" as const },
        expiresAt,
        createdAt: now,
      })),
    );

    const client = await runtimePool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [owner.workspaceId]);
      const stored = await client.query<{ event_name: string }>(
        "SELECT event_name FROM product_events WHERE workspace_id = $1 ORDER BY event_name",
        [owner.workspaceId],
      );
      expect(stored.rows.map((row) => row.event_name)).toEqual(
        [...ProductEventNameSchema.options].sort(),
      );
      await expect(
        client.query(
          `INSERT INTO product_events
             (id, workspace_id, event_name, dimensions, occurred_at, expires_at, created_at)
           VALUES ($1,$2,'content_opened',$3,$4,$5,$4)`,
          [randomUUID(), owner.workspaceId, JSON.stringify({}), now, expiresAt],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("cascades product events when an owner account deletes its workspace", async () => {
    const owner = await creator("delete-product-events");
    const now = new Date();
    await repository.recordProductEvents([
      {
        id: randomUUID(),
        workspaceId: owner.workspaceId,
        name: "creation_completed",
        occurredAt: now.toISOString(),
        dimensions: { creationPath: "blank" },
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
        createdAt: now,
      },
    ]);
    const productEventCount = async () => {
      const client = await runtimePool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [owner.workspaceId]);
        const result = await client.query<{ count: number }>(
          "SELECT count(*)::integer AS count FROM product_events",
        );
        await client.query("COMMIT");
        return result.rows[0]?.count;
      } finally {
        client.release();
      }
    };

    expect(await productEventCount()).toBe(1);
    await repository.deleteAccount(owner.userId);
    expect(await productEventCount()).toBe(0);
  });

  it("isolates authoring sources and claims each background job once", async () => {
    const first = await creator("authoring-first");
    const second = await creator("authoring-second");
    const now = new Date();
    const jobId = randomUUID();
    await repository.createAuthoringJob({
      id: jobId,
      workspaceId: first.workspaceId,
      createdBy: first.userId,
      sourceType: "pasted_text",
      sourceName: "Private source",
      sourceMimeType: null,
      sourceText: "Only the owning workspace and system worker may read this private source.",
      sourceBlob: null,
      sourceDigest: "c".repeat(64),
      status: "pending",
      attempts: 0,
      appliedQuizId: null,
      availableAt: now,
      output: null,
      lastError: null,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
      createdAt: now,
      updatedAt: now,
    });

    expect(await repository.getAuthoringJob(second.workspaceId, jobId)).toBeNull();
    const leaseUntil = new Date(now.getTime() + 60_000);
    const claims = await Promise.all([
      repository.claimAuthoringJob(now, leaseUntil),
      repository.claimAuthoringJob(now, leaseUntil),
    ]);
    expect(claims.filter((claim) => claim?.id === jobId)).toHaveLength(1);
    expect(claims.filter((claim) => claim === null)).toHaveLength(1);

    const checkpointId = randomUUID();
    const output: AuthoringDraft = {
      schemaVersion: 1,
      sourceName: "Private source",
      sourceDigest: "c".repeat(64),
      checkpointSet: {
        title: "Generated review draft",
        description: "",
        category: "general",
        experiencePreset: { id: "focus", version: 1 },
        questions: [
          {
            id: checkpointId,
            type: "single_select",
            prompt: "Who may read a private source?",
            purpose: "diagnostic",
            confidence: "optional",
            delivery: "main",
            conceptKeys: ["privacy"],
            linkedRecheckQuestionId: null,
            choices: [
              { id: randomUUID(), label: "The owning workspace", isCorrect: true },
              { id: randomUUID(), label: "Every workspace", isCorrect: false },
            ],
            timeLimitSeconds: 30,
            basePoints: 1_000,
            explanation: "Workspace isolation protects the source.",
            mediaId: null,
            mediaAlt: null,
          },
        ],
      },
      citations: [
        { checkpointId, locator: "paragraph 1", excerpt: "owning workspace" },
        { checkpointId, locator: "paragraph 1", excerpt: "private source" },
      ],
      generatedAt: now.toISOString(),
      provider: "test-provider",
      model: "test-model",
    };
    expect(await repository.completeAuthoringJob(jobId, 0, output, now)).toBe(false);
    expect(await repository.completeAuthoringJob(jobId, 1, output, now)).toBe(true);
    expect(await repository.getAuthoringJob(first.workspaceId, jobId)).toMatchObject({
      status: "ready",
      attempts: 1,
      sourceText: null,
      sourceBlob: null,
      output: { schemaVersion: 1 },
    });
  });

  it("serializes concurrent authoring quota reservations", async () => {
    const owner = await creator("authoring-quota");
    const now = new Date();
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        repository.createAuthoringJobWithinLimit(
          {
            id: randomUUID(),
            workspaceId: owner.workspaceId,
            createdBy: owner.userId,
            sourceType: "pasted_text",
            sourceName: `Concurrent source ${index}`,
            sourceMimeType: null,
            sourceText: "A private source that should consume exactly one quota reservation.",
            sourceBlob: null,
            sourceDigest: String(index).padStart(64, "0"),
            status: "pending",
            attempts: 0,
            appliedQuizId: null,
            availableAt: now,
            output: null,
            lastError: null,
            expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
            createdAt: now,
            updatedAt: now,
          },
          since,
          2,
        ),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(2);
    expect(await repository.countAuthoringJobsSince(owner.workspaceId, since)).toBe(2);
  });

  it("enforces institution gates and consumes federated state once", async () => {
    const first = await creator("institution-first");
    const second = await creator("institution-second");
    expect(await repository.getInstitutionPolicy(first.workspaceId)).toMatchObject({
      contractStatus: "disabled",
      identityRequirement: "guest",
      capabilities: { oidc: false, lti: false },
      k12Enabled: false,
      updatedAt: null,
    });

    const updatedAt = new Date();
    await repository.updateInstitutionPolicy(
      {
        workspaceId: first.workspaceId,
        contractStatus: "pilot",
        identityRequirement: "optional",
        capabilities: {
          oidc: true,
          managedSso: false,
          scim: false,
          lti: false,
          nrps: false,
          ags: false,
          auditExports: true,
          residencyControls: true,
        },
        k12Enabled: false,
        updatedAt,
      },
      `institution-policy-${randomUUID()}`,
    );
    expect(await repository.getInstitutionPolicy(first.workspaceId)).toMatchObject({
      contractStatus: "pilot",
      identityRequirement: "optional",
      capabilities: { oidc: true },
    });
    expect(await repository.getInstitutionPolicy(second.workspaceId)).toMatchObject({
      contractStatus: "disabled",
      capabilities: { oidc: false },
    });

    await expect(
      repository.updateInstitutionPolicy(
        {
          workspaceId: first.workspaceId,
          contractStatus: "disabled",
          identityRequirement: "institution",
          capabilities: {
            oidc: true,
            managedSso: false,
            scim: false,
            lti: false,
            nrps: false,
            ags: false,
            auditExports: false,
            residencyControls: false,
          },
          k12Enabled: false,
          updatedAt: new Date(),
        },
        `institution-invalid-${randomUUID()}`,
      ),
    ).rejects.toThrow();

    const stateHash = "d".repeat(64);
    await repository.createFederatedAuthTransaction({
      id: randomUUID(),
      workspaceId: first.workspaceId,
      userId: first.userId,
      mode: "link",
      stateHash,
      codeVerifier: "v".repeat(43),
      nonce: "n".repeat(43),
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    });
    expect(await repository.consumeFederatedAuthTransaction(stateHash, new Date())).toMatchObject({
      workspaceId: first.workspaceId,
      mode: "link",
    });
    expect(await repository.consumeFederatedAuthTransaction(stateHash, new Date())).toBeNull();

    const identityId = randomUUID();
    const identity = {
      id: identityId,
      workspaceId: first.workspaceId,
      userId: first.userId,
      provider: "oidc" as const,
      issuer: "https://identity.example.edu",
      subject: `subject-${randomUUID()}`,
      emailHint: first.email,
      linkedAt: new Date(),
      lastUsedAt: null,
    };
    expect(await repository.linkExternalIdentity(identity)).toMatchObject({ id: identityId });
    expect(await repository.listExternalIdentities(second.workspaceId, first.userId)).toEqual([]);
    expect(
      await repository.getExternalIdentity(
        first.workspaceId,
        "oidc",
        identity.issuer,
        identity.subject,
      ),
    ).toMatchObject({ userId: first.userId });
    expect(
      await repository.linkExternalIdentity({
        ...identity,
        id: randomUUID(),
        userId: second.userId,
      }),
    ).toBeNull();
    expect(
      await repository.unlinkExternalIdentity(first.workspaceId, first.userId, identityId),
    ).toBe(true);

    const registrationId = randomUUID();
    expect(
      await repository.upsertLtiRegistration({
        id: registrationId,
        workspaceId: first.workspaceId,
        name: "PostgreSQL test LMS",
        issuer: "https://lms.example.edu",
        clientId: `client-${randomUUID()}`,
        deploymentId: `deployment-${randomUUID()}`,
        authorizationEndpoint: "https://lms.example.edu/oidc/auth",
        tokenEndpoint: "https://lms.example.edu/oauth/token",
        jwksUrl: "https://lms.example.edu/.well-known/jwks.json",
        deepLinkReturnOrigins: ["https://lms.example.edu"],
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).toMatchObject({ id: registrationId, workspaceId: first.workspaceId });
    expect(await repository.listLtiRegistrations(second.workspaceId)).toEqual([]);

    const ltiStateHash = "e".repeat(64);
    await repository.createLtiLoginTransaction({
      id: randomUUID(),
      workspaceId: first.workspaceId,
      registrationId,
      stateHash: ltiStateHash,
      nonce: "n".repeat(43),
      targetLinkUri: "https://api.example.ca/v1/lti/launch",
      ltiMessageHint: "message-hint",
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    });
    expect(await repository.consumeLtiLoginTransaction(ltiStateHash, new Date())).toMatchObject({
      registrationId,
    });
    expect(await repository.consumeLtiLoginTransaction(ltiStateHash, new Date())).toBeNull();

    const quizId = randomUUID();
    const quizNow = new Date();
    await repository.createQuiz({
      id: quizId,
      workspaceId: first.workspaceId,
      title: "LTI selection",
      description: "Deep Linking persistence test",
      status: "draft",
      draft: {
        title: "LTI selection",
        description: "Deep Linking persistence test",
        questions: [],
      },
      currentVersionId: null,
      folderId: null,
      tags: [],
      createdAt: quizNow,
      updatedAt: quizNow,
    });
    const launchId = randomUUID();
    const linkTokenHash = "f".repeat(64);
    await repository.createLtiLaunch({
      id: launchId,
      workspaceId: first.workspaceId,
      registrationId,
      creatorUserId: null,
      subject: `lti-subject-${randomUUID()}`,
      messageType: "LtiDeepLinkingRequest",
      role: "instructor",
      targetLinkUri: "https://api.example.ca/v1/lti/launch",
      quizId: null,
      contextId: "course-1",
      resourceLinkId: null,
      deepLinkReturnUrl: "https://lms.example.edu/deep-links/return",
      deepLinkData: "opaque-data",
      linkTokenHash,
      responseJwt: null,
      completedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    });
    expect(
      await repository.bindLtiLaunch(linkTokenHash, first.userId, randomUUID(), new Date()),
    ).toMatchObject({ id: launchId, creatorUserId: first.userId, linkTokenHash: null });
    expect(
      await repository.bindLtiLaunch(linkTokenHash, first.userId, randomUUID(), new Date()),
    ).toBeNull();
    expect(
      await repository.completeLtiDeepLink(
        first.workspaceId,
        launchId,
        first.userId,
        quizId,
        "signed-response",
        new Date(),
      ),
    ).toMatchObject({ quizId, responseJwt: "signed-response" });

    const retainedRequestId = `audit-retained-${randomUUID()}`;
    const expiredRequestId = `audit-expired-${randomUUID()}`;
    await repository.recordAudit({
      workspaceId: first.workspaceId,
      actorId: first.userId,
      action: "institution.audit.retained",
      targetType: "workspace",
      targetId: first.workspaceId,
      requestId: retainedRequestId,
    });
    await repository.recordAudit({
      workspaceId: first.workspaceId,
      actorId: first.userId,
      action: "institution.audit.expired",
      targetType: "workspace",
      targetId: first.workspaceId,
      requestId: expiredRequestId,
    });
    const adminPool = new Pool({ connectionString: adminUrl });
    try {
      await adminPool.query(
        "UPDATE audit_events SET created_at = now() - interval '366 days' WHERE request_id = $1",
        [expiredRequestId],
      );
    } finally {
      await adminPool.end();
    }
    expect(await repository.purgeAuditEvents(new Date(Date.now() - 365 * 24 * 60 * 60_000))).toBe(
      1,
    );
    expect(await repository.listAuditEvents(first.workspaceId, null, 10_000)).toEqual(
      expect.arrayContaining([expect.objectContaining({ requestId: retainedRequestId })]),
    );
    expect(
      (await repository.listAuditEvents(first.workspaceId, null, 10_000)).some(
        (event) => event.requestId === expiredRequestId,
      ),
    ).toBe(false);
  });
});

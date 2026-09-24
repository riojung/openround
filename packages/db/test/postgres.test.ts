import { createHash, randomInt, randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  ProductEventNameSchema,
  type AuthoringDraft,
  type PresentationDraft,
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
  PresentationMutationConflictError,
  PostgresCollaborationGroupRepository,
  PostgresLibraryMetadataRepository,
  PostgresPresentationRepository,
  PostgresPresentationSessionRepository,
  type PresentationSessionCredentialRecord,
} from "../src/index.js";
import {
  FollowupAccessLimitError,
  QuizDraftRevisionConflictError,
  SessionCodeConflictError,
  SessionNotActiveError,
  SessionVersionConflictError,
} from "../src/types.js";
import { discoverMigrations, runMigrations } from "../src/migrations.js";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const runtimeUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(adminUrl && runtimeUrl);

function publishableRound(title: string): QuizDraft {
  return {
    title,
    description: "",
    questions: [
      {
        id: randomUUID(),
        type: "numeric",
        prompt: "What is one plus one?",
        correctValue: "2",
        tolerance: "0",
        unit: null,
        timeLimitSeconds: 30,
        basePoints: 1_000,
        explanation: "One plus one is two.",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  };
}

describe.skipIf(!adminUrl)("PostgreSQL migration upgrades", () => {
  it("backfills revision metadata on a populated pre-018 schema and restores immutability", async () => {
    const schema = `openround_upgrade_${randomUUID().replaceAll("-", "")}`;
    const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const preRevisionDirectory = await mkdtemp(join(tmpdir(), "openround-pre-revision-"));
    const adminPool = new Pool({ connectionString: adminUrl });
    let isolatedPool: Pool | undefined;

    try {
      const migrations = await discoverMigrations(migrationsDirectory);
      for (const migration of migrations.filter(({ version }) => version <= 17)) {
        await writeFile(join(preRevisionDirectory, migration.fileName), migration.sql);
      }

      await adminPool.query(`CREATE SCHEMA "${schema}"`);
      const isolatedUrl = new URL(adminUrl!);
      isolatedUrl.searchParams.set("options", `-csearch_path=${schema},public`);
      isolatedPool = new Pool({ connectionString: isolatedUrl.toString(), max: 1 });

      await expect(
        isolatedPool.query<{ current_schema: string }>("SELECT current_schema()"),
      ).resolves.toMatchObject({ rows: [{ current_schema: schema }] });
      await runMigrations(isolatedPool, preRevisionDirectory);

      const ownerId = randomUUID();
      const workspaceId = randomUUID();
      const quizId = randomUUID();
      const versionId = randomUUID();
      const draft = publishableRound("Legacy published round");
      const preMigrationClient = await isolatedPool.connect();
      try {
        await preMigrationClient.query("SELECT set_config('app.system_access', 'on', false)");
        await preMigrationClient.query("BEGIN");
        await preMigrationClient.query("INSERT INTO users (id, email) VALUES ($1, $2)", [
          ownerId,
          `upgrade-${ownerId}@example.com`,
        ]);
        await preMigrationClient.query(
          `INSERT INTO workspaces (id, name, segment, owner_id)
           VALUES ($1, 'Upgrade audit', 'workplace', $2)`,
          [workspaceId, ownerId],
        );
        await preMigrationClient.query(
          `INSERT INTO workspace_members (workspace_id, user_id, role)
           VALUES ($1, $2, 'owner')`,
          [workspaceId, ownerId],
        );
        await preMigrationClient.query(
          `INSERT INTO quizzes
             (id, workspace_id, title, description, status, draft, current_version_id)
           VALUES ($1, $2, $3, '', 'draft', $4::jsonb, NULL)`,
          [quizId, workspaceId, draft.title, JSON.stringify(draft)],
        );
        await preMigrationClient.query(
          `INSERT INTO quiz_versions
             (id, workspace_id, quiz_id, version, content, content_hash)
           VALUES ($1, $2, $3, 1, $4::jsonb, 'legacy-content-hash')`,
          [versionId, workspaceId, quizId, JSON.stringify(draft)],
        );
        await preMigrationClient.query(
          `UPDATE quizzes
           SET current_version_id = $1, status = 'published'
           WHERE id = $2`,
          [versionId, quizId],
        );
        await preMigrationClient.query("COMMIT");

        await expect(
          preMigrationClient.query(
            "UPDATE quiz_versions SET content_hash = 'must-remain-blocked' WHERE id = $1",
            [versionId],
          ),
        ).rejects.toMatchObject({ code: "55000" });
      } catch (error) {
        await preMigrationClient.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        preMigrationClient.release();
      }

      await runMigrations(isolatedPool, migrationsDirectory);

      const verificationClient = await isolatedPool.connect();
      try {
        await verificationClient.query("SELECT set_config('app.system_access', 'on', false)");
        await expect(
          verificationClient.query<{
            draft_revision: string;
            published_draft_revision: string;
            source_draft_revision: string;
          }>(
            `SELECT quiz.draft_revision, quiz.published_draft_revision,
                    version.source_draft_revision
             FROM quizzes AS quiz
             JOIN quiz_versions AS version ON version.id = quiz.current_version_id
             WHERE quiz.id = $1`,
            [quizId],
          ),
        ).resolves.toMatchObject({
          rows: [
            {
              draft_revision: "0",
              published_draft_revision: "0",
              source_draft_revision: "0",
            },
          ],
        });

        await expect(
          verificationClient.query<{ tgenabled: string }>(
            `SELECT tgenabled
             FROM pg_trigger
             WHERE tgrelid = 'quiz_versions'::regclass
               AND tgname = 'quiz_versions_immutable'
               AND NOT tgisinternal`,
          ),
        ).resolves.toMatchObject({ rows: [{ tgenabled: "O" }] });
        await expect(
          verificationClient.query(
            "UPDATE quiz_versions SET content_hash = 'still-blocked' WHERE id = $1",
            [versionId],
          ),
        ).rejects.toMatchObject({ code: "55000" });

        await expect(
          verificationClient.query<{ locale_explicit: boolean }>(
            "SELECT locale_explicit FROM users WHERE id = $1",
            [ownerId],
          ),
        ).resolves.toMatchObject({ rows: [{ locale_explicit: false }] });

        await expect(
          verificationClient.query<{ count: string; maximum: number }>(
            "SELECT count(*) AS count, max(version) AS maximum FROM _openround_migrations",
          ),
        ).resolves.toMatchObject({ rows: [{ count: "38", maximum: 38 }] });

        await expect(
          verificationClient.query(
            `INSERT INTO product_events
               (id, workspace_id, event_name, dimensions, occurred_at, expires_at)
             VALUES ($1, $2, 'draft_conflict', $3::jsonb, now(), now() + interval '1 day')`,
            [randomUUID(), workspaceId, JSON.stringify({ artifactType: "presentation" })],
          ),
        ).resolves.toMatchObject({ rowCount: 1 });
        await expect(
          verificationClient.query(
            `INSERT INTO product_events
               (id, workspace_id, event_name, dimensions, occurred_at, expires_at)
             VALUES ($1, $2, 'draft_conflict', $3::jsonb, now(), now() + interval '1 day')`,
            [randomUUID(), workspaceId, JSON.stringify({ artifactType: "unknown" })],
          ),
        ).rejects.toMatchObject({ code: "23514" });
        await expect(
          verificationClient.query(
            `INSERT INTO product_events
               (id, workspace_id, event_name, dimensions, occurred_at, expires_at)
             VALUES ($1, $2, 'draft_conflict', $3::jsonb, now(), now() + interval '1 day')`,
            [randomUUID(), workspaceId, JSON.stringify({ freeForm: "private" })],
          ),
        ).rejects.toMatchObject({ code: "23514" });
      } finally {
        verificationClient.release();
      }
    } finally {
      await isolatedPool?.end();
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminPool.end();
      await rm(preRevisionDirectory, { recursive: true, force: true });
    }
  });
});

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
      { version: 17, name: "round_practice_assignments" },
      { version: 18, name: "round_authoring_revisions" },
      { version: 19, name: "presentations" },
      { version: 20, name: "presentation_live_sessions" },
      { version: 21, name: "collaboration_groups" },
      { version: 22, name: "presentation_session_retention" },
      { version: 23, name: "presentation_live_scoring" },
      { version: 24, name: "media_references" },
      { version: 25, name: "round_draft_history" },
      { version: 26, name: "library_metadata" },
      { version: 27, name: "artifact_schema_versions" },
      { version: 28, name: "authoring_product_events" },
      { version: 29, name: "presentation_live_expiry" },
      { version: 30, name: "presentation_noop_mutations" },
      { version: 31, name: "user_locale_preference" },
      { version: 32, name: "presentation_realtime_foundation" },
      { version: 33, name: "trust_and_session_event_foundation" },
      { version: 34, name: "live_room_code_registry" },
      { version: 35, name: "recovery_funnel_events" },
      { version: 36, name: "presentation_session_reports" },
      { version: 37, name: "backfill_presentation_session_reports" },
      { version: 38, name: "presentation_concurrent_event_sequence" },
    ]);

    // An existing P0 database has the full schema but no ledger. Replaying the
    // idempotent baseline must safely bootstrap tracking before later migrations.
    await migrationRepository.pool.query("DROP TABLE _openround_migrations");
    await migrationRepository.migrate();
    const bootstrapped = await migrationRepository.pool.query<{ count: string }>(
      "SELECT count(*) FROM _openround_migrations",
    );
    expect(bootstrapped.rows[0]?.count).toBe("38");

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

  async function createPublishedRoundFixture(
    owner: Awaited<ReturnType<typeof creator>>,
    label: string,
  ) {
    const now = new Date();
    const content = publishableRound(label);
    const quiz = await repository.createQuiz({
      id: randomUUID(),
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
      quizId: quiz.id,
      version: 1,
      content,
      contentHash: randomUUID(),
      publishedAt: now,
    });
    return { content, version };
  }

  async function createRoundSessionFixture(
    owner: Awaited<ReturnType<typeof creator>>,
    fixture: Awaited<ReturnType<typeof createPublishedRoundFixture>>,
    code: string,
    trustMode: "learning" | "verified" = "learning",
  ) {
    const now = new Date();
    const id = randomUUID();
    const state = createGameState({
      sessionId: id,
      code,
      quiz: fixture.content,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "friendly_only",
        trustMode,
      },
    });
    await repository.createSession({
      id,
      workspaceId: owner.workspaceId,
      quizVersionId: fixture.version.id,
      hostId: owner.userId,
      hostTokenHash: randomUUID(),
      trustMode,
      state,
      expiresAt: new Date(now.getTime() + 60_000),
      retentionExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
      createdAt: now,
      updatedAt: now,
    });
    return { id, state };
  }

  async function createPublishedPresentationFixture(
    owner: Awaited<ReturnType<typeof creator>>,
    label: string,
  ) {
    const now = new Date();
    const content = {
      title: label,
      description: "",
      experiencePreset: { id: "focus", version: 1 },
      schemaVersion: 1,
      blocks: [
        {
          id: randomUUID(),
          kind: "question",
          question: {
            id: randomUUID(),
            type: "numeric",
            prompt: "How many room-code namespaces are authoritative?",
            correctValue: "1",
            tolerance: "0",
            unit: null,
            timeLimitSeconds: 30,
            basePoints: 1_000,
            explanation: "Rounds and Presentations share one namespace.",
            mediaId: null,
            mediaAlt: null,
          },
        },
      ],
    } satisfies PresentationDraft;
    const presentations = new PostgresPresentationRepository(repository);
    const presentation = await presentations.createPresentation({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      title: content.title,
      description: content.description,
      status: "draft",
      draft: content,
      draftRevision: 0,
      draftSchemaVersion: 1,
      currentVersionId: null,
      folderId: null,
      publishedDraftRevision: null,
      lastEditedBy: owner.userId,
      createdAt: now,
      updatedAt: now,
    });
    const version = await presentations.publishPresentation(
      {
        id: randomUUID(),
        workspaceId: owner.workspaceId,
        presentationId: presentation.id,
        version: 1,
        content,
        contentHash: randomUUID(),
        sourceDraftRevision: 0,
        publishedAt: now,
      },
      0,
    );
    return { content, presentation, version };
  }

  async function createPresentationSessionFixture(
    owner: Awaited<ReturnType<typeof creator>>,
    fixture: Awaited<ReturnType<typeof createPublishedPresentationFixture>>,
    code: string,
  ) {
    const now = new Date();
    const sessions = new PostgresPresentationSessionRepository(repository);
    const session = await sessions.createSession({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      presentationId: fixture.presentation.id,
      presentationVersionId: fixture.version.id,
      title: fixture.content.title,
      content: fixture.content,
      code,
      status: "active",
      phase: "lobby",
      currentBlockIndex: -1,
      revision: 0,
      createdBy: owner.userId,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      liveExpiresAt: new Date(now.getTime() + 60_000),
      retentionExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    });
    return { session, sessions };
  }

  it("durably queues, leases, completes, fails, and exports Presentation reports", async () => {
    const owner = await creator("presentation-report-owner");
    const outsider = await creator("presentation-report-outsider");
    const published = await createPublishedPresentationFixture(owner, "Durable report");
    const { session, sessions } = await createPresentationSessionFixture(
      owner,
      published,
      String(randomInt(1_000_000, 10_000_000)),
    );
    const finishedAt = new Date("2000-01-01T00:00:00.000Z");
    await sessions.transitionSession({
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      expectedRevision: 0,
      phase: "finished",
      currentBlockIndex: -1,
      status: "finished",
      occurredAt: finishedAt,
      event: { type: "presentation.finished", blockIndex: null, blockId: null },
    });

    await expect(sessions.getReport(outsider.workspaceId, session.id)).resolves.toBeNull();
    await expect(sessions.getReport(owner.workspaceId, session.id)).resolves.toMatchObject({
      id: session.id,
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      status: "pending",
      schemaVersion: 1,
      payload: null,
      generatedAt: null,
      expiresAt: session.retentionExpiresAt,
    });

    const leaseUntil = new Date(Date.now() + 60_000);
    const job = await sessions.claimReportJob(new Date(), leaseUntil);
    expect(job).toMatchObject({
      reportId: session.id,
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      attempts: 1,
      expiresAt: session.retentionExpiresAt,
    });
    const payload = { artifactType: "presentation", participantCount: 0 };
    const generatedAt = new Date();
    await sessions.completeReportJob(job!, {
      reportId: session.id,
      sessionId: session.id,
      schemaVersion: 1,
      payload,
      generatedAt,
    });
    await expect(sessions.getReport(owner.workspaceId, session.id)).resolves.toMatchObject({
      status: "ready",
      schemaVersion: 1,
      payload,
      generatedAt,
    });
    await expect(repository.exportAccount(owner.userId)).resolves.toMatchObject({
      presentationSessionReports: [
        expect.objectContaining({ id: session.id, status: "ready", payload }),
      ],
    });

    const failedFixture = await createPresentationSessionFixture(
      owner,
      published,
      String(randomInt(1_000_000, 10_000_000)),
    );
    await failedFixture.sessions.transitionSession({
      workspaceId: owner.workspaceId,
      sessionId: failedFixture.session.id,
      expectedRevision: 0,
      phase: "finished",
      currentBlockIndex: -1,
      status: "finished",
      occurredAt: new Date(finishedAt.getTime() + 1),
      event: { type: "presentation.finished", blockIndex: null, blockId: null },
    });
    const failedJob = await sessions.claimReportJob(new Date(), leaseUntil);
    expect(failedJob).toMatchObject({ reportId: failedFixture.session.id, attempts: 1 });
    await sessions.retryReportJob(failedJob!, "terminal failure", new Date(), true);
    await expect(
      sessions.getReport(owner.workspaceId, failedFixture.session.id),
    ).resolves.toMatchObject({ status: "failed", payload: null, generatedAt: null });
  });

  it("fences a reclaimed Presentation report job from its expired PostgreSQL worker", async () => {
    const owner = await creator("presentation-report-fencing-owner");
    const published = await createPublishedPresentationFixture(owner, "Fenced report");
    const { session, sessions } = await createPresentationSessionFixture(
      owner,
      published,
      String(randomInt(1_000_000, 10_000_000)),
    );
    const finishedAt = new Date("1999-01-01T00:00:00.000Z");
    await sessions.transitionSession({
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      expectedRevision: 0,
      phase: "finished",
      currentBlockIndex: -1,
      status: "finished",
      occurredAt: finishedAt,
      event: { type: "presentation.finished", blockIndex: null, blockId: null },
    });

    const firstLeaseUntil = new Date(finishedAt.getTime() + 1_000);
    const firstWorkerJob = await sessions.claimReportJob(finishedAt, firstLeaseUntil);
    const secondClaimAt = new Date(firstLeaseUntil.getTime() + 1);
    const secondLeaseUntil = new Date(secondClaimAt.getTime() + 60_000);
    const secondWorkerJob = await sessions.claimReportJob(secondClaimAt, secondLeaseUntil);

    expect(firstWorkerJob).toMatchObject({ reportId: session.id, attempts: 1 });
    expect(secondWorkerJob).toMatchObject({ reportId: session.id, attempts: 2 });
    expect(secondWorkerJob!.leaseToken).not.toBe(firstWorkerJob!.leaseToken);

    await sessions.retryReportJob(firstWorkerJob!, "stale retry", secondClaimAt, false);
    await sessions.retryReportJob(firstWorkerJob!, "stale terminal failure", secondClaimAt, true);
    await expect(
      sessions.completeReportJob(firstWorkerJob!, {
        reportId: session.id,
        sessionId: session.id,
        schemaVersion: 1,
        payload: { worker: "stale" },
        generatedAt: secondClaimAt,
      }),
    ).rejects.toThrow("no longer pending");
    await expect(sessions.getReport(owner.workspaceId, session.id)).resolves.toMatchObject({
      status: "pending",
      payload: null,
    });
    await expect(sessions.claimReportJob(secondClaimAt, secondLeaseUntil)).resolves.toBeNull();

    const payload = { worker: "current" };
    await sessions.completeReportJob(secondWorkerJob!, {
      reportId: session.id,
      sessionId: session.id,
      schemaVersion: 1,
      payload,
      generatedAt: secondClaimAt,
    });
    await expect(sessions.getReport(owner.workspaceId, session.id)).resolves.toMatchObject({
      status: "ready",
      payload,
    });
  });

  it("defaults legacy report trust mode in account exports", async () => {
    const owner = await creator("legacy-report-export");
    const fixture = await createPublishedRoundFixture(owner, "Legacy report export");
    const session = await createRoundSessionFixture(
      owner,
      fixture,
      String(randomInt(1_000_000, 10_000_000)),
    );
    const now = new Date();
    const legacyReport: Report = {
      id: randomUUID(),
      sessionId: session.id,
      status: "ready",
      generatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000).toISOString(),
      metrics: {
        participantCount: 0,
        completedCount: 0,
        answerCount: 0,
        accuracyPercent: 0,
      },
      questions: [],
      participants: [],
    };
    await repository.saveReport(owner.workspaceId, legacyReport);

    const stored = await runtimePool.connect();
    try {
      await stored.query("BEGIN");
      await stored.query("SELECT set_config('app.workspace_id', $1, true)", [owner.workspaceId]);
      await expect(
        stored.query<{ has_trust_mode: boolean }>(
          `SELECT metrics ? 'trustMode' AS has_trust_mode FROM reports WHERE id = $1`,
          [legacyReport.id],
        ),
      ).resolves.toMatchObject({ rows: [{ has_trust_mode: false }] });
      await stored.query("ROLLBACK");
    } finally {
      stored.release();
    }

    const exported = await repository.exportAccount(owner.userId);
    expect(exported.reports).toEqual([
      expect.objectContaining({
        id: legacyReport.id,
        metrics: expect.objectContaining({ trustMode: "learning" }),
      }),
    ]);
  });

  it("derives legacy report trust mode from its source session in account exports", async () => {
    const owner = await creator("legacy-verified-report-export");
    const fixture = await createPublishedRoundFixture(owner, "Legacy verified report export");
    const session = await createRoundSessionFixture(
      owner,
      fixture,
      String(randomInt(1_000_000, 10_000_000)),
      "verified",
    );
    const now = new Date();
    const legacyReport: Report = {
      id: randomUUID(),
      sessionId: session.id,
      status: "ready",
      generatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000).toISOString(),
      metrics: {
        participantCount: 0,
        completedCount: 0,
        answerCount: 0,
        accuracyPercent: 0,
      },
      questions: [],
      participants: [],
    };
    await repository.saveReport(owner.workspaceId, legacyReport);

    const exported = await repository.exportAccount(owner.userId);
    expect(exported.reports).toEqual([
      expect.objectContaining({
        id: legacyReport.id,
        metrics: expect.objectContaining({ trustMode: "verified" }),
      }),
    ]);
  });

  it("reclaims released room codes across workspaces and removes claims with their source", async () => {
    const first = await creator("room-registry-first");
    const second = await creator("room-registry-second");
    const [firstRound, secondRound, secondPresentation] = await Promise.all([
      createPublishedRoundFixture(first, "First room registry source"),
      createPublishedRoundFixture(second, "Second room registry source"),
      createPublishedPresentationFixture(second, "Presentation room registry source"),
    ]);
    const code = String(randomInt(1_000_000, 10_000_000));
    const firstSession = await createRoundSessionFixture(first, firstRound, code);

    await expect(
      createPresentationSessionFixture(second, secondPresentation, code),
    ).rejects.toMatchObject({ code: "23505", constraint: "live_room_codes_pkey" });

    const firstClient = await runtimePool.connect();
    try {
      await firstClient.query("BEGIN");
      await firstClient.query("SELECT set_config('app.workspace_id', $1, true)", [
        first.workspaceId,
      ]);
      await firstClient.query("SAVEPOINT immutable_code");
      await expect(
        firstClient.query("UPDATE game_sessions SET code = $2 WHERE id = $1", [
          firstSession.id,
          String(randomInt(1_000_000, 10_000_000)),
        ]),
      ).rejects.toMatchObject({ code: "23514" });
      await firstClient.query("ROLLBACK TO SAVEPOINT immutable_code");
      await firstClient.query(
        `UPDATE game_sessions
         SET ended_at = now(), updated_at = now()
         WHERE id = $1`,
        [firstSession.id],
      );
      await firstClient.query("COMMIT");
    } catch (error) {
      await firstClient.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      firstClient.release();
    }

    const { session: presentationSession, sessions: presentationSessions } =
      await createPresentationSessionFixture(second, secondPresentation, code);
    await expect(createRoundSessionFixture(second, secondRound, code)).rejects.toBeInstanceOf(
      SessionCodeConflictError,
    );
    await expect(repository.getLiveRoomCode(code)).resolves.toMatchObject({
      workspaceId: second.workspaceId,
      artifactType: "presentation",
      artifactId: presentationSession.id,
    });

    await presentationSessions.transitionSession({
      workspaceId: second.workspaceId,
      sessionId: presentationSession.id,
      expectedRevision: presentationSession.revision,
      phase: "finished",
      currentBlockIndex: presentationSession.currentBlockIndex,
      status: "finished",
      event: {
        type: "presentation.finished",
        blockIndex: null,
        blockId: null,
      },
    });
    const secondSession = await createRoundSessionFixture(second, secondRound, code);
    const claimPrivilege = await runtimePool.query<{ can_execute: boolean }>(
      `SELECT has_function_privilege(current_user, procedure.oid, 'EXECUTE') AS can_execute
       FROM pg_proc AS procedure
       JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'public' AND procedure.proname = 'claim_live_room_code'`,
    );
    expect(claimPrivilege.rows).toEqual([{ can_execute: false }]);
    const inspector = await runtimePool.connect();
    try {
      await inspector.query("BEGIN");
      await inspector.query("SELECT set_config('app.system_access', 'on', true)");
      await expect(
        inspector.query<{
          workspace_id: string;
          artifact_type: string;
          artifact_id: string;
        }>(
          `SELECT workspace_id, artifact_type, artifact_id
           FROM live_room_codes WHERE code = $1`,
          [code],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            workspace_id: second.workspaceId,
            artifact_type: "round",
            artifact_id: secondSession.id,
          },
        ],
      });
      await inspector.query("ROLLBACK");
    } finally {
      inspector.release();
    }

    const secondClient = await runtimePool.connect();
    try {
      await secondClient.query("BEGIN");
      await secondClient.query("SELECT set_config('app.workspace_id', $1, true)", [
        second.workspaceId,
      ]);
      await secondClient.query("DELETE FROM game_sessions WHERE id = $1", [secondSession.id]);
      await secondClient.query("COMMIT");
    } catch (error) {
      await secondClient.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      secondClient.release();
    }

    const afterDelete = await runtimePool.connect();
    try {
      await afterDelete.query("BEGIN");
      await afterDelete.query("SELECT set_config('app.system_access', 'on', true)");
      await expect(
        afterDelete.query<{ count: string }>(
          "SELECT count(*) FROM live_room_codes WHERE code = $1",
          [code],
        ),
      ).resolves.toMatchObject({ rows: [{ count: "0" }] });
      await afterDelete.query("ROLLBACK");
    } finally {
      afterDelete.release();
    }
  });

  it("binds session events to the parent workspace and permits ordered command journals", async () => {
    const first = await creator("session-event-first");
    const second = await creator("session-event-second");
    const [firstRound, secondRound] = await Promise.all([
      createPublishedRoundFixture(first, "First event source"),
      createPublishedRoundFixture(second, "Second event source"),
    ]);
    const firstSession = await createRoundSessionFixture(
      first,
      firstRound,
      String(randomInt(1_000_000, 10_000_000)),
    );
    const secondSession = await createRoundSessionFixture(
      second,
      secondRound,
      String(randomInt(1_000_000, 10_000_000)),
    );
    const commandId = `command-${randomUUID()}`;
    const expiresAt = new Date(Date.now() + 60_000);
    const eventIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];

    const firstClient = await runtimePool.connect();
    try {
      await firstClient.query("BEGIN");
      await firstClient.query("SELECT set_config('app.workspace_id', $1, true)", [
        first.workspaceId,
      ]);
      await firstClient.query("SAVEPOINT cross_tenant_event");
      await expect(
        firstClient.query(
          `INSERT INTO session_events
             (id, workspace_id, session_id, seq, type, payload, command_id, event_ordinal,
              expires_at)
           VALUES ($1,$2,$3,1,'test.event','{}'::jsonb,$4,0,$5)`,
          [randomUUID(), first.workspaceId, secondSession.id, commandId, expiresAt],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await firstClient.query("ROLLBACK TO SAVEPOINT cross_tenant_event");
      await firstClient.query("SAVEPOINT mismatched_parent_fk");
      await firstClient.query("SELECT set_config('app.system_access', 'on', true)");
      await expect(
        firstClient.query(
          `INSERT INTO session_events
             (id, workspace_id, session_id, seq, type, payload, command_id, event_ordinal,
              expires_at)
           VALUES ($1,$2,$3,1,'test.event','{}'::jsonb,$4,0,$5)`,
          [randomUUID(), first.workspaceId, secondSession.id, commandId, expiresAt],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await firstClient.query("ROLLBACK TO SAVEPOINT mismatched_parent_fk");

      for (let index = 0; index < eventIds.length; index += 1) {
        await firstClient.query(
          `INSERT INTO session_events
             (id, workspace_id, session_id, seq, type, payload, command_id, event_ordinal,
              expires_at)
           VALUES ($1,$2,$3,$4,'test.event',$5::jsonb,$6,$7,$8)`,
          [
            eventIds[index],
            first.workspaceId,
            firstSession.id,
            index + 1,
            JSON.stringify({ index }),
            index < 2 ? commandId : null,
            index < 2 ? index : 0,
            expiresAt,
          ],
        );
      }
      await expect(
        firstClient.query<{ count: string }>("SELECT count(*) FROM session_events"),
      ).resolves.toMatchObject({ rows: [{ count: "4" }] });
      await firstClient.query("COMMIT");
    } catch (error) {
      await firstClient.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      firstClient.release();
    }

    const secondClient = await runtimePool.connect();
    try {
      await secondClient.query("BEGIN");
      await secondClient.query("SELECT set_config('app.workspace_id', $1, true)", [
        second.workspaceId,
      ]);
      await expect(
        secondClient.query<{ count: string }>("SELECT count(*) FROM session_events"),
      ).resolves.toMatchObject({ rows: [{ count: "0" }] });
      await secondClient.query("ROLLBACK");
    } finally {
      secondClient.release();
    }
  });

  it("persists an idempotent locale preference for only the selected user", async () => {
    const first = await creator("locale-first");
    const second = await creator("locale-second");

    expect(first.locale).toBe("en-CA");
    expect(first.localePreferenceSet).toBe(false);
    expect(second.locale).toBe("en-CA");
    expect(second.localePreferenceSet).toBe(false);
    await expect(repository.updateUserLocale(first.userId, "zh-TW")).resolves.toBe("zh-TW");
    await expect(repository.updateUserLocale(first.userId, "zh-TW")).resolves.toBe("zh-TW");

    await expect(
      repository.getCreatorByUserId(first.userId, first.workspaceId),
    ).resolves.toMatchObject({ locale: "zh-TW", localePreferenceSet: true });
    await expect(
      repository.getCreatorByUserId(second.userId, second.workspaceId),
    ).resolves.toMatchObject({ locale: "en-CA", localePreferenceSet: false });

    const returningTokenHash = `test-locale-returning-${randomUUID()}`;
    await repository.createMagicToken({
      id: randomUUID(),
      email: first.email,
      segment: "education",
      tokenHash: returningTokenHash,
      policyVersion: "test-v1",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });
    await expect(
      repository.consumeMagicToken(returningTokenHash, new Date()),
    ).resolves.toMatchObject({ locale: "zh-TW", localePreferenceSet: true });
    const localeSessionTokenHash = `test-locale-session-${randomUUID()}`;
    await repository.createCreatorSession({
      id: randomUUID(),
      userId: first.userId,
      tokenHash: localeSessionTokenHash,
      expiresAt: new Date(Date.now() + 60_000),
      activeWorkspaceId: first.workspaceId,
    });
    await expect(
      repository.getCreatorBySession(localeSessionTokenHash, new Date()),
    ).resolves.toMatchObject({ locale: "zh-TW", localePreferenceSet: true });
    await expect(repository.exportAccount(first.userId)).resolves.toMatchObject({
      profile: { locale: "zh-TW", localePreferenceSet: true },
    });
    await expect(repository.updateUserLocale(randomUUID(), "de-DE")).resolves.toBeNull();
  });

  it("atomically fences draft replacements and revision-bound publishing", async () => {
    const owner = await creator("draft-revision");
    const now = new Date();
    const quizId = randomUUID();
    const original = publishableRound("Original");
    const created = await repository.createQuiz({
      id: quizId,
      workspaceId: owner.workspaceId,
      title: original.title,
      description: original.description,
      status: "draft",
      draft: original,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    expect(created.draftRevision).toBe(0);

    const next = { ...original, title: "Saved" };
    const mutationId = randomUUID();
    const mutation = {
      workspaceId: owner.workspaceId,
      quizId,
      draft: next,
      expectedRevision: 0,
      mutationId,
      editorId: owner.userId,
      schemaVersion: 1,
      draftHash: "saved-draft",
    };
    await expect(repository.updateQuizDraft(mutation)).resolves.toMatchObject({
      draftRevision: 1,
      lastEditedBy: owner.userId,
    });
    await expect(repository.updateQuizDraft(mutation)).resolves.toMatchObject({
      draftRevision: 1,
    });
    await expect(
      repository.updateQuizDraft({
        ...mutation,
        draft: original,
        mutationId: randomUUID(),
        draftHash: "stale-draft",
      }),
    ).rejects.toEqual(expect.objectContaining({ expectedRevision: 0, currentRevision: 1 }));
    await expect(repository.listQuizDraftHistory(owner.workspaceId, quizId)).resolves.toEqual([
      expect.objectContaining({ revision: 1, savedBy: owner.userId }),
      expect.objectContaining({ revision: 0 }),
    ]);

    const publication = {
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      quizId,
      version: 1,
      content: next,
      contentHash: randomUUID(),
      publishedAt: now,
    };
    await expect(repository.publishQuiz(publication, null, 0)).rejects.toBeInstanceOf(
      QuizDraftRevisionConflictError,
    );
    const version = await repository.publishQuiz(publication, null, 1);
    expect(version.sourceDraftRevision).toBe(1);
    await expect(repository.getQuiz(owner.workspaceId, quizId)).resolves.toMatchObject({
      currentVersionId: version.id,
      draftRevision: 1,
      publishedDraftRevision: 1,
    });

    await repository.updateQuizDraft({
      ...mutation,
      draft: { ...next, title: "Intervening PostgreSQL save" },
      expectedRevision: 1,
      mutationId: randomUUID(),
      editorId: owner.userId,
      draftHash: "intervening-postgres-save",
    });
    await expect(repository.updateQuizDraft(mutation)).resolves.toMatchObject({
      draftRevision: 1,
      draft: { title: "Saved" },
    });
    await expect(repository.getQuiz(owner.workspaceId, quizId)).resolves.toMatchObject({
      draftRevision: 2,
      draft: { title: "Intervening PostgreSQL save" },
    });

    const restoreMutationId = randomUUID();
    const restoreInput = {
      workspaceId: owner.workspaceId,
      quizId,
      historyRevision: 1,
      expectedRevision: 2,
      mutationId: restoreMutationId,
      editorId: owner.userId,
    };
    await repository.restoreQuizDraftHistory(restoreInput);
    await repository.updateQuizDraft({
      ...mutation,
      draft: { ...next, title: "After PostgreSQL restore" },
      expectedRevision: 3,
      mutationId: randomUUID(),
      draftHash: "after-postgres-restore",
    });
    await expect(repository.restoreQuizDraftHistory(restoreInput)).resolves.toMatchObject({
      draftRevision: 3,
      draft: { title: "Saved" },
    });
    await expect(repository.getQuiz(owner.workspaceId, quizId)).resolves.toMatchObject({
      draftRevision: 4,
      draft: { title: "After PostgreSQL restore" },
    });
  });

  it("tracks media usage through database triggers and protects referenced assets", async () => {
    const owner = await creator("media-reference-owner");
    const outsider = await creator("media-reference-outsider");
    const now = new Date();
    const mediaId = randomUUID();
    const orphanId = randomUUID();
    for (const id of [mediaId, orphanId]) {
      await repository.createMediaAsset({
        id,
        workspaceId: owner.workspaceId,
        objectKey: `media/${owner.workspaceId}/${id}.png`,
        mimeType: "image/png",
        sizeBytes: 128,
        scanStatus: "clean",
        altText: "File description",
        createdAt: new Date(now.getTime() - 8 * 86_400_000),
      });
    }
    const quizId = randomUUID();
    const draft = {
      title: "Media reference",
      description: "",
      category: "education",
      experiencePreset: { id: "focus", version: 1 },
      questions: [
        {
          id: randomUUID(),
          type: "single_select",
          prompt: "Which option is supported?",
          purpose: "diagnostic",
          confidence: "optional",
          delivery: "main",
          conceptKeys: ["evidence"],
          linkedRecheckQuestionId: null,
          choices: [
            { id: randomUUID(), label: "A", isCorrect: true },
            { id: randomUUID(), label: "B", isCorrect: false },
          ],
          timeLimitSeconds: 20,
          basePoints: 1_000,
          explanation: "A is supported.",
          mediaId,
          mediaAlt: "Placement description",
        },
      ],
    } satisfies QuizDraft;
    await repository.createQuiz({
      id: quizId,
      workspaceId: owner.workspaceId,
      title: draft.title,
      description: draft.description,
      status: "draft",
      draft,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });

    await expect(repository.deleteMediaAsset(owner.workspaceId, mediaId)).resolves.toBe(false);
    await expect(repository.listMediaReferences(outsider.workspaceId, mediaId)).resolves.toEqual(
      [],
    );
    const unattached = await repository.listUnattachedMedia(now, 1_000);
    expect(unattached).toEqual(expect.arrayContaining([expect.objectContaining({ id: orphanId })]));
    expect(unattached).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: mediaId })]),
    );
    await expect(repository.listMediaReferences(owner.workspaceId, mediaId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ownerType: "quiz_draft", ownerId: quizId }),
        expect.objectContaining({ ownerType: "quiz_history" }),
      ]),
    );

    const version = await repository.publishQuiz({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      quizId,
      version: 1,
      content: draft,
      contentHash: randomUUID(),
      publishedAt: now,
    });
    await expect(repository.listMediaReferences(owner.workspaceId, mediaId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ownerType: "quiz_draft", ownerId: quizId }),
        expect.objectContaining({ ownerType: "quiz_version", ownerId: version.id }),
      ]),
    );
    await expect(repository.exportAccount(owner.userId)).resolves.toMatchObject({
      mediaReferences: expect.arrayContaining([
        expect.objectContaining({ media_id: mediaId, owner_type: "quiz_draft" }),
        expect.objectContaining({ media_id: mediaId, owner_type: "quiz_version" }),
      ]),
    });
    await repository.deleteAccount(owner.userId);
    await expect(repository.listMediaReferences(owner.workspaceId)).resolves.toEqual([]);
    await expect(repository.listMediaAssets(owner.workspaceId)).resolves.toEqual([]);
  });

  it("isolates presentation children and serializes idempotent draft mutations", async () => {
    const owner = await creator("presentation-owner");
    const outsider = await creator("presentation-outsider");
    const presentations = new PostgresPresentationRepository(repository);
    const libraryMetadata = new PostgresLibraryMetadataRepository(repository);
    const now = new Date();
    const draft = {
      title: "Secure presentation",
      description: "",
      experiencePreset: { id: "focus", version: 1 },
      schemaVersion: 1,
      blocks: [
        {
          id: randomUUID(),
          kind: "content",
          layout: "title_body",
          title: "Opening",
          body: "",
          mediaId: null,
          mediaAlt: null,
          speakerNotes: "",
        },
      ],
    } satisfies PresentationDraft;
    const presentation = await presentations.createPresentation({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      title: draft.title,
      description: draft.description,
      status: "draft",
      draft,
      draftRevision: 0,
      draftSchemaVersion: 1,
      currentVersionId: null,
      folderId: null,
      publishedDraftRevision: null,
      lastEditedBy: owner.userId,
      createdAt: now,
      updatedAt: now,
    });
    await expect(
      presentations.getPresentation(outsider.workspaceId, presentation.id),
    ).resolves.toBeNull();

    const folder = await repository.createFolder({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      name: `Briefings ${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
    });
    await expect(
      presentations.organizePresentation(owner.workspaceId, presentation.id, folder.id),
    ).resolves.toMatchObject({ folderId: folder.id });
    await libraryMetadata.setFavorite({
      workspaceId: owner.workspaceId,
      userId: owner.userId,
      artifactType: "presentation",
      artifactId: presentation.id,
      favorite: true,
      now,
    });
    await expect(
      libraryMetadata.listFavorites(owner.workspaceId, owner.userId),
    ).resolves.toMatchObject([{ artifactId: presentation.id, userId: owner.userId }]);

    const noOpMutation = {
      workspaceId: owner.workspaceId,
      presentationId: presentation.id,
      draft,
      expectedRevision: 0,
      mutationId: randomUUID(),
      editorId: owner.userId,
      draftHash: "unchanged-presentation",
    };
    await expect(presentations.updatePresentationDraft(noOpMutation)).resolves.toMatchObject({
      draftRevision: 0,
    });
    await expect(presentations.updatePresentationDraft(noOpMutation)).resolves.toMatchObject({
      draftRevision: 0,
    });
    await expect(
      presentations.listPresentationHistory(owner.workspaceId, presentation.id, 20),
    ).resolves.toHaveLength(1);

    const mutationId = randomUUID();
    const update = {
      workspaceId: owner.workspaceId,
      presentationId: presentation.id,
      draft: { ...draft, title: "Saved once" },
      expectedRevision: 0,
      mutationId,
      editorId: owner.userId,
      draftHash: "same-request",
    };
    const retried = await Promise.all([
      presentations.updatePresentationDraft(update),
      presentations.updatePresentationDraft(update),
    ]);
    expect(retried).toEqual([
      expect.objectContaining({ draftRevision: 1 }),
      expect.objectContaining({ draftRevision: 1 }),
    ]);
    await expect(
      presentations.updatePresentationDraft({ ...update, draftHash: "different-request" }),
    ).rejects.toBeInstanceOf(PresentationMutationConflictError);

    await presentations.updatePresentationDraft({
      ...update,
      draft: { ...draft, title: "Intervening PostgreSQL presentation save" },
      expectedRevision: 1,
      mutationId: randomUUID(),
      editorId: outsider.userId,
      draftHash: "intervening-presentation-save",
    });
    await expect(presentations.updatePresentationDraft(update)).resolves.toMatchObject({
      draftRevision: 1,
      draft: { title: "Saved once" },
      lastEditedBy: owner.userId,
    });
    await expect(
      presentations.getPresentation(owner.workspaceId, presentation.id),
    ).resolves.toMatchObject({
      draftRevision: 2,
      draft: { title: "Intervening PostgreSQL presentation save" },
    });

    const restoreMutationId = randomUUID();
    const restoreInput = {
      workspaceId: owner.workspaceId,
      presentationId: presentation.id,
      historyRevision: 1,
      expectedRevision: 2,
      mutationId: restoreMutationId,
      editorId: owner.userId,
    };
    await presentations.restorePresentationHistory(restoreInput);
    await presentations.updatePresentationDraft({
      ...update,
      draft: { ...draft, title: "After PostgreSQL presentation restore" },
      expectedRevision: 3,
      mutationId: randomUUID(),
      draftHash: "after-presentation-restore",
    });
    await expect(presentations.restorePresentationHistory(restoreInput)).resolves.toMatchObject({
      draftRevision: 3,
      draft: { title: "Saved once" },
      lastEditedBy: owner.userId,
    });
    await expect(
      presentations.getPresentation(owner.workspaceId, presentation.id),
    ).resolves.toMatchObject({
      draftRevision: 4,
      draft: { title: "After PostgreSQL presentation restore" },
    });

    const crossTenant = await runtimePool.connect();
    try {
      await crossTenant.query("BEGIN");
      await crossTenant.query("SELECT set_config('app.workspace_id', $1, true)", [
        owner.workspaceId,
      ]);
      await crossTenant.query("SELECT set_config('app.user_id', $1, true)", [outsider.userId]);
      const hiddenFavorites = await crossTenant.query(
        "SELECT artifact_id FROM library_favorites WHERE artifact_id = $1",
        [presentation.id],
      );
      expect(hiddenFavorites.rows).toEqual([]);
      await crossTenant.query("SELECT set_config('app.workspace_id', $1, true)", [
        outsider.workspaceId,
      ]);
      await expect(
        crossTenant.query(
          `INSERT INTO presentation_draft_history
             (id, workspace_id, presentation_id, revision, draft, saved_by)
           VALUES ($1,$2,$3,99,$4,$5)`,
          [
            randomUUID(),
            outsider.workspaceId,
            presentation.id,
            JSON.stringify(draft),
            outsider.userId,
          ],
        ),
      ).rejects.toThrow();
    } finally {
      await crossTenant.query("ROLLBACK");
      crossTenant.release();
    }

    const privileges = await runtimePool.query<{
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
    }>(`SELECT
          has_table_privilege(current_user, 'presentation_versions', 'INSERT') AS can_insert,
          has_table_privilege(current_user, 'presentation_versions', 'UPDATE') AS can_update,
          has_table_privilege(current_user, 'presentation_versions', 'DELETE') AS can_delete`);
    expect(privileges.rows[0]).toEqual({
      can_insert: true,
      can_update: false,
      can_delete: false,
    });
  });

  it("creates a Presentation room and initial credential atomically", async () => {
    const owner = await creator("presentation-atomic-credential");
    const published = await createPublishedPresentationFixture(owner, "Atomic Presentation");
    const sessions = new PostgresPresentationSessionRepository(repository);
    const now = new Date();
    const sessionInput = (id: string, code: string) => ({
      id,
      workspaceId: owner.workspaceId,
      presentationId: published.presentation.id,
      presentationVersionId: published.version.id,
      title: published.content.title,
      content: published.content,
      code,
      status: "active" as const,
      phase: "lobby" as const,
      currentBlockIndex: -1,
      revision: 0,
      createdBy: owner.userId,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      liveExpiresAt: new Date(now.getTime() + 60_000),
      retentionExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    });
    const sharedTokenHash = "d".repeat(64);
    const firstId = randomUUID();
    await expect(
      sessions.createSessionWithCredential(
        sessionInput(firstId, String(randomInt(1_000_000, 10_000_000))),
        {
          id: randomUUID(),
          workspaceId: owner.workspaceId,
          sessionId: firstId,
          role: "host",
          tokenHash: sharedTokenHash,
          createdAt: now,
          expiresAt: new Date(now.getTime() + 60_000),
          revokedAt: null,
        },
      ),
    ).resolves.toMatchObject({
      session: { id: firstId },
      credential: { sessionId: firstId, role: "host" },
    });

    const failedId = randomUUID();
    const reusableCode = String(randomInt(1_000_000, 10_000_000));
    await expect(
      sessions.createSessionWithCredential(sessionInput(failedId, reusableCode), {
        id: randomUUID(),
        workspaceId: owner.workspaceId,
        sessionId: failedId,
        role: "host",
        tokenHash: sharedTokenHash,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
        revokedAt: null,
      }),
    ).rejects.toThrow();
    await expect(sessions.getSessionById(failedId)).resolves.toBeNull();
    await expect(repository.getLiveRoomCode(reusableCode)).resolves.toBeNull();
    await expect(
      sessions.createSession(sessionInput(failedId, reusableCode)),
    ).resolves.toMatchObject({ id: failedId });
  });

  it("serializes concurrent Presentation credential rotations", async () => {
    const owner = await creator("presentation-concurrent-credential-rotation");
    const published = await createPublishedPresentationFixture(
      owner,
      "Concurrent credential rotation",
    );
    const { session, sessions } = await createPresentationSessionFixture(
      owner,
      published,
      String(randomInt(1_000_000, 10_000_000)),
    );
    const now = new Date();
    const original = await sessions.createCredential({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      role: "host",
      tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      revokedAt: null,
    });
    const rotationAt = new Date(now.getTime() + 1);
    const rotationInputs = ["first", "second"].map(
      (label): PresentationSessionCredentialRecord => ({
        id: randomUUID(),
        workspaceId: owner.workspaceId,
        sessionId: session.id,
        role: "host",
        tokenHash: createHash("sha256").update(`${label}-${randomUUID()}`).digest("hex"),
        createdAt: rotationAt,
        expiresAt: new Date(rotationAt.getTime() + 60_000),
        revokedAt: null,
      }),
    );

    const blocker = await runtimePool.connect();
    let pendingRotations: Promise<PresentationSessionCredentialRecord[]> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT set_config('app.workspace_id', $1, true)", [owner.workspaceId]);
      await blocker.query(
        `SELECT id FROM presentation_live_sessions
         WHERE workspace_id = $1 AND id = $2
         FOR UPDATE`,
        [owner.workspaceId, session.id],
      );

      pendingRotations = Promise.all(
        rotationInputs.map((input) => sessions.rotateCredential(input)),
      );
      const waitDeadline = Date.now() + 5_000;
      let waitingRotations = 0;
      while (Date.now() < waitDeadline) {
        const waiting = await runtimePool.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM pg_stat_activity
           WHERE datname = current_database()
             AND state = 'active'
             AND wait_event_type = 'Lock'
             AND query LIKE $1`,
          ["%rotate_presentation_session_credential%"],
        );
        waitingRotations = Number(waiting.rows[0]?.count ?? 0);
        if (waitingRotations >= rotationInputs.length) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waitingRotations).toBe(rotationInputs.length);

      await blocker.query("COMMIT");
      const rotated = await pendingRotations;
      pendingRotations = undefined;
      const validAt = new Date(rotationAt.getTime() + 1);
      const activeRotations = await Promise.all(
        rotated.map((credential) =>
          sessions.findValidCredential(session.id, credential.tokenHash, "host", validAt),
        ),
      );
      expect(activeRotations.filter((credential) => credential !== null)).toHaveLength(1);
      await expect(
        sessions.findValidCredential(session.id, original.tokenHash, "host", validAt),
      ).resolves.toBeNull();
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      await pendingRotations?.catch(() => undefined);
    }
  });

  it("keeps Presentation fences monotonic for legacy writers and aggregate inserts", async () => {
    const owner = await creator("presentation-legacy-compat");
    const presentations = new PostgresPresentationRepository(repository);
    const sessions = new PostgresPresentationSessionRepository(repository);
    const now = new Date();
    const questionBlockId = randomUUID();
    const questionId = randomUUID();
    const draft = {
      title: "Legacy realtime compatibility",
      description: "Migration compatibility coverage",
      experiencePreset: { id: "focus", version: 1 },
      schemaVersion: 1,
      blocks: [
        {
          id: questionBlockId,
          kind: "question",
          question: {
            id: questionId,
            type: "numeric",
            prompt: "How many durable mutations occurred?",
            correctValue: "3",
            tolerance: "0",
            unit: null,
            timeLimitSeconds: 30,
            basePoints: 1_000,
            explanation: "The sequence includes join, command, and response.",
            mediaId: null,
            mediaAlt: null,
          },
        },
      ],
    } satisfies PresentationDraft;
    const presentation = await presentations.createPresentation({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      title: draft.title,
      description: draft.description,
      status: "draft",
      draft,
      draftRevision: 0,
      draftSchemaVersion: 1,
      currentVersionId: null,
      folderId: null,
      publishedDraftRevision: null,
      lastEditedBy: owner.userId,
      createdAt: now,
      updatedAt: now,
    });
    const version = await presentations.publishPresentation(
      {
        id: randomUUID(),
        workspaceId: owner.workspaceId,
        presentationId: presentation.id,
        version: 1,
        content: draft,
        contentHash: randomUUID(),
        sourceDraftRevision: 0,
        publishedAt: now,
      },
      0,
    );
    const session = await sessions.createSession({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      presentationId: presentation.id,
      presentationVersionId: version.id,
      title: draft.title,
      content: draft,
      code: String(randomInt(1_000_000, 10_000_000)),
      status: "active",
      phase: "lobby",
      currentBlockIndex: -1,
      revision: 0,
      settings: { timeMode: "timed" },
      trustMode: "learning",
      eventSeq: 0,
      questionOpenedAt: null,
      questionClosesAt: null,
      createdBy: owner.userId,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      liveExpiresAt: new Date(now.getTime() + 60_000),
      retentionExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    });

    for (const invalidSettings of [{}, { timeMode: null }]) {
      const invalidClient = await runtimePool.connect();
      try {
        await invalidClient.query("BEGIN");
        await invalidClient.query("SELECT set_config('app.workspace_id', $1, true)", [
          owner.workspaceId,
        ]);
        await expect(
          invalidClient.query(
            `INSERT INTO presentation_live_sessions
               (id, workspace_id, presentation_id, presentation_version_id, title,
                content_snapshot, join_code, status, phase, current_block_index, revision,
                settings, trust_mode, event_seq, created_by, created_at, updated_at,
                live_expires_at, retention_expires_at)
             SELECT $2, workspace_id, presentation_id, presentation_version_id, title,
                    content_snapshot, $3, 'active', 'lobby', -1, 0, $4::jsonb, 'learning', 0,
                    created_by, $5, $5, $6, $7
             FROM presentation_live_sessions
             WHERE workspace_id = $1 AND id = $8`,
            [
              owner.workspaceId,
              randomUUID(),
              String(randomInt(1_000_000, 10_000_000)),
              JSON.stringify(invalidSettings),
              now,
              new Date(now.getTime() + 60_000),
              new Date(now.getTime() + 30 * 24 * 60 * 60_000),
              session.id,
            ],
          ),
        ).rejects.toMatchObject({ code: "23514" });
        await invalidClient.query("ROLLBACK");
      } finally {
        invalidClient.release();
      }
    }

    const participant = await sessions.addParticipant({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      nickname: "Legacy participant",
      tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
      joinedAt: now,
      lastSeenAt: now,
    });
    await expect(
      sessions.getSessionForWorkspace(owner.workspaceId, session.id),
    ).resolves.toMatchObject({ eventSeq: 1 });

    const openedAt = new Date(now.getTime() + 1_000);
    const legacyClient = await runtimePool.connect();
    try {
      await legacyClient.query("BEGIN");
      await legacyClient.query("SELECT set_config('app.workspace_id', $1, true)", [
        owner.workspaceId,
      ]);
      await legacyClient.query("SAVEPOINT immutable_presentation_code");
      await expect(
        legacyClient.query(
          "UPDATE presentation_live_sessions SET join_code = $3 WHERE workspace_id = $1 AND id = $2",
          [owner.workspaceId, session.id, String(randomInt(1_000_000, 10_000_000))],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await legacyClient.query("ROLLBACK TO SAVEPOINT immutable_presentation_code");

      const opened = await legacyClient.query<{
        event_seq: string;
        question_opened_at: Date;
        question_closes_at: Date;
      }>(
        `UPDATE presentation_live_sessions
         SET phase = 'question_open', current_block_index = 0, revision = revision + 1,
             updated_at = $3
         WHERE workspace_id = $1 AND id = $2
         RETURNING event_seq, question_opened_at, question_closes_at`,
        [owner.workspaceId, session.id, openedAt],
      );
      expect(opened.rows[0]).toEqual({
        event_seq: "2",
        question_opened_at: openedAt,
        question_closes_at: new Date(openedAt.getTime() + 30_000),
      });
      const launched = await legacyClient.query<{ sequence: string }>(
        `INSERT INTO presentation_session_timeline
           (id, workspace_id, session_id, sequence, event_type, block_index, block_id,
            occurred_at)
         SELECT $1, $2, $3, COALESCE(MAX(sequence), 0) + 1, 'question.launched', 0, $4, $5
         FROM presentation_session_timeline
         WHERE session_id = $3
         RETURNING sequence`,
        [randomUUID(), owner.workspaceId, session.id, questionBlockId, openedAt],
      );
      expect(launched.rows[0]?.sequence).toBe("2");
      await legacyClient.query("COMMIT");
    } catch (error) {
      await legacyClient.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      legacyClient.release();
    }

    const responseIdempotencyKey = randomUUID();
    const responseHash = "a".repeat(64);
    const responseInput = {
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      participantId: participant.id,
      blockId: questionBlockId,
      questionId,
      response: { numericValue: "3" },
      correct: true,
      score: 1_000,
      responseMs: 1_000,
      submittedAt: new Date(openedAt.getTime() + 1_000),
      idempotencyKey: responseIdempotencyKey,
      requestHash: responseHash,
    };
    const accepted = await sessions.acceptResponse(responseInput, 1);
    expect(accepted).toMatchObject({
      status: "accepted",
      response: { requestHash: responseHash },
      acknowledgement: {
        session: { phase: "question_open", eventSeq: 3 },
        projection: { participantCount: 1, standing: null },
      },
    });
    await expect(
      sessions.acceptResponse({ ...responseInput, id: randomUUID() }, 1),
    ).resolves.toMatchObject({ status: "duplicate" });
    await expect(
      sessions.acceptResponse(
        { ...responseInput, id: randomUUID(), requestHash: "b".repeat(64) },
        1,
      ),
    ).resolves.toMatchObject({ status: "idempotency_conflict" });
    await expect(
      sessions.getSessionForWorkspace(owner.workspaceId, session.id),
    ).resolves.toMatchObject({ eventSeq: 3 });

    const concurrentParticipant = await sessions.addParticipant({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      nickname: "Concurrent retry",
      tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
      joinedAt: openedAt,
      lastSeenAt: openedAt,
    });
    const concurrentKey = randomUUID();
    const concurrentHash = "c".repeat(64);
    const firstWriter = await runtimePool.connect();
    try {
      await firstWriter.query("BEGIN");
      await firstWriter.query("SELECT set_config('app.workspace_id', $1, true)", [
        owner.workspaceId,
      ]);
      await firstWriter.query(
        `INSERT INTO presentation_live_responses
          (id, workspace_id, session_id, participant_id, block_id, question_id, response,
           correct, score, response_ms, submitted_at, idempotency_key, request_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true,1000,1000,$8,$9,$10)`,
        [
          randomUUID(),
          owner.workspaceId,
          session.id,
          concurrentParticipant.id,
          questionBlockId,
          questionId,
          JSON.stringify({ numericValue: "3" }),
          new Date(openedAt.getTime() + 1_000),
          concurrentKey,
          concurrentHash,
        ],
      );

      let retrySettled = false;
      const retry = sessions
        .acceptResponse(
          {
            ...responseInput,
            id: randomUUID(),
            participantId: concurrentParticipant.id,
            idempotencyKey: concurrentKey,
            requestHash: concurrentHash,
          },
          999,
        )
        .finally(() => {
          retrySettled = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(retrySettled).toBe(false);

      await firstWriter.query("COMMIT");
      await expect(retry).resolves.toMatchObject({ status: "duplicate" });
      await expect(
        sessions.acceptResponse(
          {
            ...responseInput,
            id: randomUUID(),
            participantId: concurrentParticipant.id,
            idempotencyKey: concurrentKey,
            requestHash: "d".repeat(64),
          },
          999,
        ),
      ).resolves.toMatchObject({ status: "idempotency_conflict" });
    } catch (error) {
      await firstWriter.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      firstWriter.release();
    }
    await expect(
      sessions.getSessionForWorkspace(owner.workspaceId, session.id),
    ).resolves.toMatchObject({ eventSeq: 5 });

    const revealedAt = new Date(openedAt.getTime() + 2_000);
    const revealClient = await runtimePool.connect();
    try {
      await revealClient.query("BEGIN");
      await revealClient.query("SELECT set_config('app.workspace_id', $1, true)", [
        owner.workspaceId,
      ]);
      const revealed = await revealClient.query<{
        event_seq: string;
        question_opened_at: Date | null;
        question_closes_at: Date | null;
      }>(
        `UPDATE presentation_live_sessions
         SET phase = 'question_reveal', revision = revision + 1, updated_at = $3
         WHERE workspace_id = $1 AND id = $2
         RETURNING event_seq, question_opened_at, question_closes_at`,
        [owner.workspaceId, session.id, revealedAt],
      );
      expect(revealed.rows[0]).toEqual({
        event_seq: "6",
        question_opened_at: null,
        question_closes_at: null,
      });
      const revealedEvent = await revealClient.query<{ sequence: string }>(
        `INSERT INTO presentation_session_timeline
           (id, workspace_id, session_id, sequence, event_type, block_index, block_id,
            occurred_at)
         SELECT $1, $2, $3, COALESCE(MAX(sequence), 0) + 1, 'question.revealed', 0, $4, $5
         FROM presentation_session_timeline
         WHERE session_id = $3
         RETURNING sequence`,
        [randomUUID(), owner.workspaceId, session.id, questionBlockId, revealedAt],
      );
      expect(revealedEvent.rows[0]?.sequence).toBe("6");
      await revealClient.query("COMMIT");
    } catch (error) {
      await revealClient.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      revealClient.release();
    }

    await expect(
      sessions.acceptResponse({ ...responseInput, id: randomUUID() }, 1),
    ).resolves.toMatchObject({
      status: "duplicate",
      acknowledgement: {
        session: { phase: "question_reveal", eventSeq: 6 },
        projection: { participantCount: 2, standing: { rank: 1, score: 1_000 } },
      },
    });

    await expect(sessions.listTimeline(session.id)).resolves.toEqual([
      expect.objectContaining({ sequence: 2, type: "question.launched" }),
      expect.objectContaining({ sequence: 6, type: "question.revealed" }),
    ]);
  });

  it("exports and cascade-deletes Presentation sessions and collaboration groups", async () => {
    const owner = await creator("new-lifecycle-owner");
    const presentations = new PostgresPresentationRepository(repository);
    const presentationSessions = new PostgresPresentationSessionRepository(repository);
    const groups = new PostgresCollaborationGroupRepository(repository);
    const now = new Date();
    const blockId = randomUUID();
    const draft = {
      title: "Portable briefing",
      description: "Lifecycle coverage",
      experiencePreset: { id: "focus", version: 1 },
      schemaVersion: 1,
      blocks: [
        {
          id: blockId,
          kind: "content",
          layout: "title_body",
          title: "Opening",
          body: "Review together.",
          mediaId: null,
          mediaAlt: null,
          speakerNotes: "Private facilitator note",
        },
        {
          id: randomUUID(),
          kind: "question",
          question: {
            id: randomUUID(),
            type: "numeric",
            prompt: "How many evidence sources were reviewed?",
            correctValue: "1",
            tolerance: "0",
            unit: null,
            timeLimitSeconds: 30,
            basePoints: 1_000,
            explanation: "One source was reviewed.",
            mediaId: null,
            mediaAlt: null,
          },
        },
      ],
    } satisfies PresentationDraft;
    const presentation = await presentations.createPresentation({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      title: draft.title,
      description: draft.description,
      status: "draft",
      draft,
      draftRevision: 0,
      draftSchemaVersion: 1,
      currentVersionId: null,
      folderId: null,
      publishedDraftRevision: null,
      lastEditedBy: owner.userId,
      createdAt: now,
      updatedAt: now,
    });
    const version = await presentations.publishPresentation(
      {
        id: randomUUID(),
        workspaceId: owner.workspaceId,
        presentationId: presentation.id,
        version: 1,
        content: draft,
        contentHash: randomUUID(),
        sourceDraftRevision: 0,
        publishedAt: now,
      },
      0,
    );
    const session = await presentationSessions.createSession({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      presentationId: presentation.id,
      presentationVersionId: version.id,
      title: draft.title,
      content: draft,
      code: String(randomInt(0, 10_000_000)).padStart(7, "0"),
      status: "active",
      phase: "lobby",
      currentBlockIndex: -1,
      revision: 0,
      createdBy: owner.userId,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      liveExpiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
      retentionExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    });
    const participant = await presentationSessions.addParticipant({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      nickname: "River",
      tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
      joinedAt: now,
      lastSeenAt: now,
    });
    const companionCredential = await presentationSessions.createCredential({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      role: "companion",
      tokenHash: createHash("sha256").update("postgres-companion-token").digest("hex"),
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      revokedAt: null,
    });
    await expect(
      presentationSessions.findValidCredential(
        session.id,
        companionCredential.tokenHash,
        "companion",
        now,
      ),
    ).resolves.toMatchObject({ id: companionCredential.id });
    const commandId = randomUUID();
    await expect(
      presentationSessions.transitionSessionCommand({
        workspaceId: owner.workspaceId,
        sessionId: session.id,
        commandId,
        expectedRevision: 0,
        phase: "content",
        currentBlockIndex: 0,
        status: "active",
        occurredAt: new Date(now.getTime() + 1),
        event: { type: "content.presented", blockIndex: 0, blockId },
      }),
    ).resolves.toMatchObject({ status: "accepted", session: { eventSeq: 2, revision: 1 } });
    await expect(
      presentationSessions.transitionSessionCommand({
        workspaceId: owner.workspaceId,
        sessionId: session.id,
        commandId,
        expectedRevision: 0,
        phase: "content",
        currentBlockIndex: 0,
        status: "active",
        event: { type: "content.presented", blockIndex: 0, blockId },
      }),
    ).resolves.toMatchObject({ status: "duplicate", session: { eventSeq: 2, revision: 1 } });
    await expect(
      presentationSessions.transitionSessionCommand({
        workspaceId: owner.workspaceId,
        sessionId: session.id,
        commandId,
        expectedRevision: 1,
        phase: "question_open",
        currentBlockIndex: 1,
        status: "active",
        event: { type: "question.launched", blockIndex: 1, blockId: draft.blocks[1]!.id },
      }),
    ).resolves.toMatchObject({ status: "idempotency_conflict", session: { revision: 1 } });

    const firstHostCredential = await presentationSessions.createCredential({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      role: "host",
      tokenHash: createHash("sha256").update("first-host-pass").digest("hex"),
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      revokedAt: null,
    });
    const rotatedHostCredential = await presentationSessions.rotateCredential({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      role: "host",
      tokenHash: createHash("sha256").update("rotated-host-pass").digest("hex"),
      createdAt: new Date(now.getTime() + 1),
      expiresAt: new Date(now.getTime() + 60_000),
      revokedAt: null,
    });
    await expect(
      presentationSessions.findValidCredential(
        session.id,
        firstHostCredential.tokenHash,
        "host",
        new Date(now.getTime() + 2),
      ),
    ).resolves.toBeNull();
    await expect(
      presentationSessions.findValidCredential(
        session.id,
        rotatedHostCredential.tokenHash,
        "host",
        new Date(now.getTime() + 2),
      ),
    ).resolves.toMatchObject({ id: rotatedHostCredential.id });
    await presentationSessions.revokeCredential(
      owner.workspaceId,
      session.id,
      companionCredential.id,
      new Date(now.getTime() + 2),
    );
    await expect(
      presentationSessions.findValidCredential(
        session.id,
        companionCredential.tokenHash,
        "companion",
        new Date(now.getTime() + 3),
      ),
    ).resolves.toBeNull();
    const questionBlock = draft.blocks[1];
    if (!questionBlock || questionBlock.kind !== "question") {
      throw new Error("Expected the account export fixture to include a question block");
    }
    await presentationSessions.saveResponse({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      participantId: participant.id,
      blockId: questionBlock.id,
      questionId: questionBlock.question.id,
      response: { numericValue: "1" },
      correct: true,
      score: 875,
      responseMs: 2_500,
      submittedAt: now,
    });
    const groupId = randomUUID();
    const group = await groups.createGroup(
      {
        id: groupId,
        workspaceId: owner.workspaceId,
        name: "Facilitators",
        description: "Review group",
        createdBy: owner.userId,
        createdAt: now,
        updatedAt: now,
      },
      {
        workspaceId: owner.workspaceId,
        groupId,
        userId: owner.userId,
        role: "owner",
        joinedAt: now,
      },
    );
    await groups.addMessage({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      groupId: group.id,
      authorId: owner.userId,
      body: "Review before hosting.",
      createdAt: now,
    });

    const exported = await repository.exportAccount(owner.userId);
    expect(exported).toMatchObject({
      presentations: [{ id: presentation.id }],
      presentationVersions: [{ id: version.id }],
      presentationSessions: [{ id: session.id }],
      presentationSessionParticipants: [{ id: participant.id, nickname: "River" }],
      presentationSessionResponses: [expect.objectContaining({ score: 875, response_ms: 2_500 })],
      collaborationGroups: [{ id: group.id }],
      collaborationGroupMessages: [{ body: "Review before hosting." }],
    });
    expect(exported.presentationSessionParticipants).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ token_hash: expect.anything() })]),
    );

    await repository.updateUserLocale(owner.userId, "ko-KR");
    await repository.deleteAccount(owner.userId);
    const system = await runtimePool.connect();
    try {
      await system.query("BEGIN");
      await system.query("SELECT set_config('app.system_access', 'on', true)");
      for (const table of [
        "presentations",
        "presentation_versions",
        "presentation_live_sessions",
        "presentation_live_participants",
        "presentation_session_reports",
        "collaboration_groups",
        "collaboration_group_members",
        "collaboration_group_messages",
      ]) {
        const result = await system.query<{ count: string }>(
          `SELECT count(*) FROM ${table} WHERE workspace_id = $1`,
          [owner.workspaceId],
        );
        expect(result.rows[0]?.count, table).toBe("0");
      }
      const deletedProfile = await system.query<{
        locale: string;
        locale_explicit: boolean;
      }>("SELECT locale, locale_explicit FROM users WHERE id = $1", [owner.userId]);
      expect(deletedProfile.rows[0]).toEqual({ locale: "en-CA", locale_explicit: false });
      await system.query("ROLLBACK");
    } finally {
      system.release();
    }
  });

  it("transfers Group ownership before deleting a collaborator account", async () => {
    const workspaceOwner = await creator("group-workspace-owner");
    const departingOwner = await creator("group-departing-owner");
    const groups = new PostgresCollaborationGroupRepository(repository);
    const now = new Date();
    const membershipClient = await runtimePool.connect();
    try {
      await membershipClient.query("BEGIN");
      await membershipClient.query("SELECT set_config('app.system_access', 'on', true)");
      await membershipClient.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1,$2,'editor')`,
        [workspaceOwner.workspaceId, departingOwner.userId],
      );
      await membershipClient.query("COMMIT");
    } catch (error) {
      await membershipClient.query("ROLLBACK");
      throw error;
    } finally {
      membershipClient.release();
    }

    const retainedGroupId = randomUUID();
    await groups.createGroup(
      {
        id: retainedGroupId,
        workspaceId: workspaceOwner.workspaceId,
        name: "Retained facilitators",
        description: "Has a successor",
        createdBy: departingOwner.userId,
        createdAt: now,
        updatedAt: now,
      },
      {
        workspaceId: workspaceOwner.workspaceId,
        groupId: retainedGroupId,
        userId: departingOwner.userId,
        role: "owner",
        joinedAt: now,
      },
    );
    await groups.addMember({
      workspaceId: workspaceOwner.workspaceId,
      groupId: retainedGroupId,
      userId: workspaceOwner.userId,
      role: "member",
      joinedAt: new Date(now.getTime() + 1),
    });

    const emptyGroupId = randomUUID();
    await groups.createGroup(
      {
        id: emptyGroupId,
        workspaceId: workspaceOwner.workspaceId,
        name: "Deleted facilitators",
        description: "No successor",
        createdBy: departingOwner.userId,
        createdAt: now,
        updatedAt: now,
      },
      {
        workspaceId: workspaceOwner.workspaceId,
        groupId: emptyGroupId,
        userId: departingOwner.userId,
        role: "owner",
        joinedAt: now,
      },
    );

    await repository.deleteAccount(departingOwner.userId);

    await expect(groups.listMembers(retainedGroupId)).resolves.toEqual([
      expect.objectContaining({ userId: workspaceOwner.userId, role: "owner" }),
    ]);
    await expect(
      groups.listGroups(workspaceOwner.workspaceId, workspaceOwner.userId),
    ).resolves.toEqual([expect.objectContaining({ id: retainedGroupId })]);
    await expect(groups.getGroup(workspaceOwner.workspaceId, emptyGroupId)).resolves.toBeNull();
  });

  it("paginates histories without losing PostgreSQL microsecond precision", async () => {
    const owner = await creator("report-cursor");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60_000);
    const content = publishableRound("Cursor precision");
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
             (id, workspace_id, purpose, source_quiz_version_id, source_session_id,
              source_report_id, title, content, concept_keys, time_mode, generic_token_hash,
              opens_at, closes_at, expires_at, closed_at, created_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [
            followupIds[index],
            owner.workspaceId,
            "recovery",
            version.id,
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
    await repository.updateQuiz(second.workspaceId, secondQuiz.id, versionContent);
    const secondVersion = await repository.publishQuiz({
      id: randomUUID(),
      workspaceId: second.workspaceId,
      quizId: secondQuiz.id,
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
    const mismatchedTrust = structuredClone(persistedSession);
    mismatchedTrust.state.settings.trustMode = "verified";
    await expect(
      repository.saveSession(mismatchedTrust, persistedSession.state.version),
    ).rejects.toBeInstanceOf(SessionVersionConflictError);
    await expect(repository.getSessionById(persistedSession.id)).resolves.toMatchObject({
      trustMode: "learning",
      state: { settings: { trustMode: "learning" } },
    });
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
    const legacyFollowupId = randomUUID();
    const legacyClient = await runtimePool.connect();
    try {
      await legacyClient.query("BEGIN");
      await legacyClient.query("SELECT set_config('app.workspace_id', $1, true)", [
        first.workspaceId,
      ]);
      const sourceVersionColumn = await legacyClient.query(
        `SELECT is_nullable
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'followups'
           AND column_name = 'source_quiz_version_id'`,
      );
      expect(sourceVersionColumn.rows[0]?.is_nullable).toBe("YES");
      const legacyInsert = await legacyClient.query(
        `INSERT INTO followups
           (id, workspace_id, source_session_id, source_report_id, title, content,
            concept_keys, time_mode, generic_token_hash, opens_at, closes_at, expires_at,
            closed_at, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING purpose, source_quiz_version_id`,
        [
          legacyFollowupId,
          first.workspaceId,
          sessionId,
          report.id,
          "Legacy recovery follow-up",
          JSON.stringify(versionContent),
          ["transactions"],
          "flex",
          randomUUID(),
          now,
          followupClosesAt,
          persistedSession.retentionExpiresAt,
          null,
          first.userId,
          now,
        ],
      );
      expect(legacyInsert.rows[0]).toMatchObject({
        purpose: "recovery",
        source_quiz_version_id: firstVersion.id,
      });
      await legacyClient.query("DELETE FROM followups WHERE id = $1", [legacyFollowupId]);
      await legacyClient.query("COMMIT");
    } catch (error) {
      await legacyClient.query("ROLLBACK");
      throw error;
    } finally {
      legacyClient.release();
    }
    await repository.createFollowup(
      {
        id: followupId,
        workspaceId: first.workspaceId,
        purpose: "recovery",
        sourceQuizVersionId: firstVersion.id,
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
    await expect(
      repository.createFollowupAccess({
        id: randomUUID(),
        workspaceId: first.workspaceId,
        followupId,
        sourceParticipantId: null,
        kind: "assignment_personal",
        label: "Wrong purpose",
        tokenHash: randomUUID(),
        timeMultiplier: 1,
        expiresAt: followupClosesAt,
        revokedAt: null,
        createdAt: now,
      }),
    ).rejects.toMatchObject({ code: "23514" });
    const assignmentExpiresAt = new Date(now.getTime() + 2 * 24 * 60 * 60_000);
    const assignmentClosesAt = new Date(now.getTime() + 24 * 60 * 60_000);
    const assignmentIds = [randomUUID(), randomUUID()];
    const assignmentPersonalTokenHash = randomUUID();
    for (const [index, assignmentId] of assignmentIds.entries()) {
      await expect(
        repository.createPracticeAssignment(
          firstQuiz.id,
          {
            id: assignmentId,
            workspaceId: first.workspaceId,
            purpose: "assignment",
            sourceQuizVersionId: firstVersion.id,
            sourceSessionId: null,
            sourceReportId: null,
            title: `Database assignment ${index + 1}`,
            content: versionContent,
            conceptKeys: [],
            timeMode: "flex",
            genericTokenHash: randomUUID(),
            opensAt: now,
            closesAt: assignmentClosesAt,
            expiresAt: assignmentExpiresAt,
            closedAt: null,
            createdBy: first.userId,
            createdAt: new Date(now.getTime() + index + 1),
          },
          index === 0
            ? [
                {
                  id: randomUUID(),
                  workspaceId: first.workspaceId,
                  followupId: assignmentId,
                  sourceParticipantId: null,
                  kind: "assignment_personal",
                  label: "Independent learner",
                  tokenHash: assignmentPersonalTokenHash,
                  timeMultiplier: 1,
                  expiresAt: assignmentClosesAt,
                  revokedAt: null,
                  createdAt: now,
                },
              ]
            : [],
        ),
      ).resolves.toBe(true);
    }
    expect(
      await repository.listFollowupHistory(first.workspaceId, {
        limit: 10,
        quizId: firstQuiz.id,
        now,
      }),
    ).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          id: assignmentIds[0],
          purpose: "assignment",
          sourceQuizVersionId: firstVersion.id,
          sourceSessionId: null,
          sourceReportId: null,
        }),
        expect.objectContaining({ id: assignmentIds[1], purpose: "assignment" }),
      ]),
    });
    expect(
      await repository.listFollowupHistory(first.workspaceId, {
        limit: 1,
        purpose: "assignment",
        quizId: firstQuiz.id,
        now,
      }),
    ).toMatchObject({
      hasMore: true,
      items: [expect.objectContaining({ id: assignmentIds[1], purpose: "assignment" })],
    });
    expect(
      await repository.listFollowupHistory(first.workspaceId, {
        limit: 1,
        purpose: "recovery",
        quizId: firstQuiz.id,
        now,
      }),
    ).toMatchObject({
      hasMore: false,
      items: [expect.objectContaining({ id: followupId, purpose: "recovery" })],
    });
    expect(
      await repository.getFollowupAccessByToken(
        assignmentIds[0]!,
        assignmentPersonalTokenHash,
        now,
      ),
    ).toMatchObject({ kind: "assignment_personal", sourceParticipantId: null });
    await repository.createOrGetFollowupAttempt({
      id: randomUUID(),
      workspaceId: first.workspaceId,
      followupId: assignmentIds[0]!,
      accessTokenId: null,
      sourceParticipantId: null,
      attemptTokenHash: randomUUID(),
      status: "completed",
      phase: "completed",
      currentIndex: 0,
      version: 1,
      timeMultiplier: 1,
      questionOpenedAt: now,
      deadlineAt: null,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    expect(await repository.getFollowupProgress(first.workspaceId, assignmentIds[0]!)).toEqual({
      attemptCount: 1,
      completedAttemptCount: 1,
    });
    expect(await repository.getFollowupProgress(second.workspaceId, assignmentIds[0]!)).toBeNull();
    const createdAssignmentAccess = {
      id: randomUUID(),
      workspaceId: first.workspaceId,
      followupId: assignmentIds[1]!,
      sourceParticipantId: null,
      kind: "assignment_personal" as const,
      label: "Post-creation learner",
      tokenHash: randomUUID(),
      timeMultiplier: 1 as const,
      expiresAt: assignmentClosesAt,
      revokedAt: null,
      createdAt: now,
    };
    await expect(
      repository.createAssignmentPersonalAccess(
        { ...createdAssignmentAccess, kind: "accommodation", timeMultiplier: 1.5 },
        1,
      ),
    ).rejects.toThrow(TypeError);
    await expect(
      repository.createAssignmentPersonalAccess(createdAssignmentAccess, 1),
    ).resolves.toMatchObject({ id: createdAssignmentAccess.id });
    expect(
      await repository.revokeFollowupAccess(
        first.workspaceId,
        assignmentIds[1]!,
        createdAssignmentAccess.id,
        now,
      ),
    ).toBe(true);
    await expect(
      repository.createAssignmentPersonalAccess(
        {
          ...createdAssignmentAccess,
          id: randomUUID(),
          tokenHash: randomUUID(),
          revokedAt: null,
        },
        1,
      ),
    ).rejects.toBeInstanceOf(FollowupAccessLimitError);
    await expect(
      repository.createAssignmentPersonalAccess(
        {
          ...createdAssignmentAccess,
          workspaceId: second.workspaceId,
          id: randomUUID(),
          tokenHash: randomUUID(),
        },
        1,
      ),
    ).resolves.toBeNull();
    await expect(
      repository.createAssignmentPersonalAccess(
        {
          ...createdAssignmentAccess,
          followupId,
          id: randomUUID(),
          tokenHash: randomUUID(),
        },
        1,
      ),
    ).resolves.toBeNull();
    let accessWhileClosing:
      ReturnType<typeof repository.createAssignmentPersonalAccess> | undefined;
    const closingClient = await runtimePool.connect();
    try {
      await closingClient.query("BEGIN");
      const closingPid = Number(
        (await closingClient.query("SELECT pg_backend_pid() AS pid")).rows[0]?.pid,
      );
      await closingClient.query("SELECT set_config('app.workspace_id', $1, true)", [
        first.workspaceId,
      ]);
      await closingClient.query(
        `UPDATE followups SET closed_at = $3
         WHERE workspace_id = $1 AND id = $2`,
        [first.workspaceId, assignmentIds[1], new Date()],
      );
      accessWhileClosing = repository.createAssignmentPersonalAccess(
        {
          ...createdAssignmentAccess,
          id: randomUUID(),
          tokenHash: randomUUID(),
          label: "Closing race learner",
        },
        100,
      );

      let waitingOnClose = false;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const activity = await closingClient.query(
          `SELECT EXISTS (
             SELECT 1
             FROM pg_stat_activity
             WHERE pid <> pg_backend_pid()
               AND wait_event_type = 'Lock'
               AND $1::integer = ANY(pg_blocking_pids(pid))
           ) AS waiting`,
          [closingPid],
        );
        waitingOnClose = activity.rows[0]?.waiting === true;
        if (waitingOnClose) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waitingOnClose).toBe(true);
      await closingClient.query("COMMIT");
    } catch (error) {
      await closingClient.query("ROLLBACK");
      throw error;
    } finally {
      closingClient.release();
    }
    await expect(accessWhileClosing!).resolves.toBeNull();
    const elapsedAssignmentId = randomUUID();
    const elapsedClosesAt = new Date(now.getTime() + 1);
    const elapsedAssignment = {
      id: elapsedAssignmentId,
      workspaceId: first.workspaceId,
      purpose: "assignment" as const,
      sourceQuizVersionId: firstVersion.id,
      sourceSessionId: null,
      sourceReportId: null,
      title: "Elapsed assignment",
      content: versionContent,
      conceptKeys: [],
      timeMode: "flex" as const,
      genericTokenHash: randomUUID(),
      opensAt: now,
      closesAt: elapsedClosesAt,
      expiresAt: assignmentExpiresAt,
      closedAt: null,
      createdBy: first.userId,
      createdAt: now,
    };
    await expect(
      repository.createPracticeAssignment(firstQuiz.id, elapsedAssignment, []),
    ).resolves.toBe(true);
    await expect(repository.createFollowup(elapsedAssignment, [])).rejects.toThrow(
      "require atomic source validation",
    );
    await expect(
      repository.createAssignmentPersonalAccess(
        {
          ...createdAssignmentAccess,
          followupId: elapsedAssignmentId,
          id: randomUUID(),
          tokenHash: randomUUID(),
          expiresAt: elapsedClosesAt,
        },
        100,
      ),
    ).resolves.toBeNull();
    await expect(
      repository.createPracticeAssignment(
        firstQuiz.id,
        {
          id: randomUUID(),
          workspaceId: first.workspaceId,
          purpose: "assignment",
          sourceQuizVersionId: secondVersion.id,
          sourceSessionId: null,
          sourceReportId: null,
          title: "Cross-tenant source",
          content: versionContent,
          conceptKeys: [],
          timeMode: "flex",
          genericTokenHash: randomUUID(),
          opensAt: now,
          closesAt: assignmentClosesAt,
          expiresAt: assignmentExpiresAt,
          closedAt: null,
          createdBy: first.userId,
          createdAt: now,
        },
        [],
      ),
    ).resolves.toBe(false);
    await expect(
      repository.createPracticeAssignment(
        firstQuiz.id,
        {
          id: randomUUID(),
          workspaceId: first.workspaceId,
          purpose: "assignment",
          sourceQuizVersionId: firstVersion.id,
          sourceSessionId: null,
          sourceReportId: null,
          title: "Invalid assignment concepts",
          content: versionContent,
          conceptKeys: ["recovery-only"],
          timeMode: "flex",
          genericTokenHash: randomUUID(),
          opensAt: now,
          closesAt: assignmentClosesAt,
          expiresAt: assignmentExpiresAt,
          closedAt: null,
          createdBy: first.userId,
          createdAt: now,
        },
        [],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect(
      await repository.purgeExpiredPracticeAssignments(new Date(assignmentExpiresAt.getTime() - 1)),
    ).toBe(0);
    expect(await repository.purgeExpiredPracticeAssignments(assignmentExpiresAt)).toBe(3);
    expect(await repository.getFollowup(first.workspaceId, assignmentIds[0]!)).toBeNull();
    expect(
      await repository.getFollowupAccessByToken(
        assignmentIds[0]!,
        assignmentPersonalTokenHash,
        now,
      ),
    ).toBeNull();
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

  it("rejects assignment creation when an in-flight archive wins the source Round lock", async () => {
    const owner = await creator("assignment-source-race");
    const now = new Date("2026-09-19T12:00:00.000Z");
    const content = publishableRound("Atomic assignment source");
    const quiz = await repository.createQuiz({
      id: randomUUID(),
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
      quizId: quiz.id,
      version: 1,
      content,
      contentHash: randomUUID(),
      publishedAt: now,
    });
    const followupId = randomUUID();
    const assignment = {
      id: followupId,
      workspaceId: owner.workspaceId,
      purpose: "assignment" as const,
      sourceQuizVersionId: version.id,
      sourceSessionId: null,
      sourceReportId: null,
      title: content.title,
      content,
      conceptKeys: [],
      timeMode: "flex" as const,
      genericTokenHash: randomUUID(),
      opensAt: now,
      closesAt: new Date(now.getTime() + 24 * 60 * 60_000),
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
      closedAt: null,
      createdBy: owner.userId,
      createdAt: now,
    };
    const raceRepository = new PostgresRepository(runtimeUrl!);
    await raceRepository.initialize();

    let createWhileArchiving:
      ReturnType<typeof raceRepository.createPracticeAssignment> | undefined;
    const archivingClient = await runtimePool.connect();
    try {
      await archivingClient.query("BEGIN");
      const archivingPid = Number(
        (await archivingClient.query("SELECT pg_backend_pid() AS pid")).rows[0]?.pid,
      );
      await archivingClient.query("SELECT set_config('app.workspace_id', $1, true)", [
        owner.workspaceId,
      ]);
      await archivingClient.query(
        `UPDATE quizzes
         SET status = 'archived', archived_at = now(), updated_at = now()
         WHERE workspace_id = $1 AND id = $2`,
        [owner.workspaceId, quiz.id],
      );
      createWhileArchiving = raceRepository.createPracticeAssignment(quiz.id, assignment, []);

      let waitingOnSource = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await archivingClient.query(
          `SELECT EXISTS (
             SELECT 1
             FROM pg_stat_activity
             WHERE pid <> pg_backend_pid()
               AND wait_event_type = 'Lock'
               AND $1::integer = ANY(pg_blocking_pids(pid))
           ) AS waiting`,
          [archivingPid],
        );
        waitingOnSource = activity.rows[0]?.waiting === true;
        if (waitingOnSource) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waitingOnSource).toBe(true);
      await archivingClient.query("COMMIT");
    } catch (error) {
      await archivingClient.query("ROLLBACK");
      await raceRepository.close();
      throw error;
    } finally {
      archivingClient.release();
    }

    await expect(createWhileArchiving!).resolves.toBe(false);
    expect(await repository.getFollowup(owner.workspaceId, followupId)).toBeNull();
    await raceRepository.close();
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
        dimensions: {
          betaVersion: "p0-2026" as const,
          ...((name === "linked_recheck_opened" || name === "report_reconciled") && {
            artifactType: "round" as const,
          }),
        },
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
      await client.query("SAVEPOINT invalid_recovery_event");
      await expect(
        client.query(
          `INSERT INTO product_events
             (id, workspace_id, event_name, dimensions, occurred_at, expires_at, created_at)
           VALUES ($1,$2,'report_reconciled',$3,$4,$5,$4)`,
          [
            randomUUID(),
            owner.workspaceId,
            JSON.stringify({ betaVersion: "p0-2026" }),
            now,
            expiresAt,
          ],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK TO SAVEPOINT invalid_recovery_event");
      await client.query("SAVEPOINT null_recovery_artifact");
      await expect(
        client.query(
          `INSERT INTO product_events
             (id, workspace_id, event_name, dimensions, occurred_at, expires_at, created_at)
           VALUES ($1,$2,'report_reconciled',$3,$4,$5,$4)`,
          [randomUUID(), owner.workspaceId, JSON.stringify({ artifactType: null }), now, expiresAt],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK TO SAVEPOINT null_recovery_artifact");
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

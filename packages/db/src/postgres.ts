import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type { EngineAnswer, GameState } from "@openround/game-engine";
import type { BrandTheme, QuizDraft, Report } from "@openround/contracts";
import {
  PublishedQuizLimitError,
  SessionCodeConflictError,
  SessionVersionConflictError,
} from "./types.js";
import type {
  AuditInput,
  BillingEventInput,
  CreatorContext,
  MagicTokenRecord,
  MediaAssetRecord,
  MediaScanStatus,
  OperationalFeaturesRecord,
  OperationalFeaturesUpdate,
  ParticipantRecord,
  Plan,
  QuizRecord,
  QuizVersionRecord,
  Repository,
  Segment,
  StoredSession,
} from "./types.js";

function date(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function mapQuiz(row: QueryResultRow): QuizRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    description: row.description,
    status: row.status,
    draft: row.draft,
    currentVersionId: row.current_version_id,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}

function mapVersion(row: QueryResultRow): QuizVersionRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    quizId: row.quiz_id,
    version: row.version,
    content: row.content,
    contentHash: row.content_hash,
    publishedAt: date(row.published_at),
  };
}

function mapSession(row: QueryResultRow): StoredSession {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    quizVersionId: row.quiz_version_id,
    hostId: row.host_id,
    hostTokenHash: row.host_token_hash,
    state: row.state_snapshot as GameState,
    expiresAt: date(row.expires_at),
    retentionExpiresAt: date(row.retention_expires_at),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}

function mapMediaAsset(row: QueryResultRow): MediaAssetRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    objectKey: row.object_key,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    scanStatus: row.scan_status,
    altText: row.alt_text,
    createdAt: date(row.created_at),
  };
}

function mapOperationalFeatures(row: QueryResultRow | undefined): OperationalFeaturesRecord {
  return row
    ? {
        signups: row.signups_enabled,
        sessionCreation: row.session_creation_enabled,
        mediaUploads: row.media_uploads_enabled,
        updatedAt: date(row.updated_at),
      }
    : {
        signups: true,
        sessionCreation: true,
        mediaUploads: true,
        updatedAt: null,
      };
}

export class PostgresRepository implements Repository {
  readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 15, statement_timeout: 10_000 });
  }

  async initialize() {
    await this.pool.query("SELECT 1");
  }

  async migrate() {
    const here = dirname(fileURLToPath(import.meta.url));
    const migrationFile =
      process.env.OPENROUND_MIGRATION_FILE ?? join(here, "../migrations/001_initial.sql");
    const sql = await readFile(migrationFile, "utf8");
    await this.pool.query(sql);
  }

  async close() {
    await this.pool.end();
  }

  async getOperationalFeatures() {
    const result = await this.systemQuery("SELECT * FROM operational_settings WHERE id = 'global'");
    return mapOperationalFeatures(result.rows[0]);
  }

  async updateOperationalFeatures(input: OperationalFeaturesUpdate, requestId: string) {
    return this.transaction(
      async (client) => {
        const beforeResult = await client.query(
          "SELECT * FROM operational_settings WHERE id = 'global' FOR UPDATE",
        );
        const before = mapOperationalFeatures(beforeResult.rows[0]);
        const updatedAt = new Date();
        const result = await client.query(
          `INSERT INTO operational_settings
             (id, signups_enabled, session_creation_enabled, media_uploads_enabled, updated_at)
           VALUES ('global', COALESCE($1::boolean, true), COALESCE($2::boolean, true),
                   COALESCE($3::boolean, true), $4)
           ON CONFLICT (id) DO UPDATE SET
             signups_enabled = COALESCE($1::boolean, operational_settings.signups_enabled),
             session_creation_enabled = COALESCE(
               $2::boolean, operational_settings.session_creation_enabled
             ),
             media_uploads_enabled = COALESCE(
               $3::boolean, operational_settings.media_uploads_enabled
             ),
             updated_at = $4
           RETURNING *`,
          [
            input.signups ?? null,
            input.sessionCreation ?? null,
            input.mediaUploads ?? null,
            updatedAt,
          ],
        );
        const after = mapOperationalFeatures(result.rows[0]);
        await client.query(
          `INSERT INTO audit_events
             (id, workspace_id, actor_id, action, target_type, target_id, request_id, metadata)
           VALUES ($1, NULL, NULL, 'operations.features.update', 'operational_features',
                   'global', $2, $3)`,
          [randomUUID(), requestId, JSON.stringify({ before, after })],
        );
        return after;
      },
      { system: true },
    );
  }

  private async transaction<T>(
    work: (client: PoolClient) => Promise<T>,
    access: { workspaceId?: string; system?: boolean } = {},
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (access.system) {
        await client.query("SELECT set_config('app.system_access', 'on', true)");
      } else if (access.workspaceId) {
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [access.workspaceId]);
      }
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async workspaceQuery(workspaceId: string, sql: string, values: unknown[] = []) {
    return this.transaction((client) => client.query(sql, values), { workspaceId });
  }

  private async systemQuery(sql: string, values: unknown[] = []) {
    return this.transaction((client) => client.query(sql, values), { system: true });
  }

  async createMagicToken(input: MagicTokenRecord) {
    await this.systemQuery(
      `INSERT INTO auth_magic_tokens (id, email, segment, token_hash, policy_version, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.id, input.email, input.segment, input.tokenHash, input.policyVersion, input.expiresAt],
    );
  }

  async consumeMagicToken(tokenHash: string, now: Date): Promise<CreatorContext | null> {
    return this.transaction(
      async (client) => {
        const tokenResult = await client.query(
          `UPDATE auth_magic_tokens SET consumed_at = $2
         WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > $2
         RETURNING email, segment, policy_version`,
          [tokenHash, now],
        );
        const token = tokenResult.rows[0] as
          { email: string; segment: Segment; policy_version: string } | undefined;
        if (!token) return null;

        let userResult = await client.query(
          "SELECT id, email FROM users WHERE email = $1 AND deleted_at IS NULL",
          [token.email],
        );
        let user = userResult.rows[0] as { id: string; email: string } | undefined;
        if (!user) {
          user = { id: randomUUID(), email: token.email };
          await client.query("INSERT INTO users (id, email) VALUES ($1, $2)", [
            user.id,
            user.email,
          ]);
          const workspaceId = randomUUID();
          await client.query(
            `INSERT INTO workspaces (id, name, segment, owner_id, retention_days)
           VALUES ($1, $2, $3, $4, 30)`,
            [workspaceId, `${token.email.split("@")[0]}'s workspace`, token.segment, user.id],
          );
          await client.query(
            "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
            [workspaceId, user.id],
          );
          await client.query("INSERT INTO subscriptions (workspace_id) VALUES ($1)", [workspaceId]);
        }

        userResult = await client.query(
          `SELECT u.id AS user_id, u.email, w.id AS workspace_id, w.segment, wm.role,
                COALESCE(s.plan, 'free') AS plan
         FROM users u
         JOIN workspace_members wm ON wm.user_id = u.id
         JOIN workspaces w ON w.id = wm.workspace_id
         LEFT JOIN subscriptions s ON s.workspace_id = w.id
         WHERE u.id = $1 AND u.deleted_at IS NULL
         ORDER BY w.created_at LIMIT 1`,
          [user.id],
        );
        const row = userResult.rows[0];
        if (row) {
          for (const documentType of ["terms", "privacy"]) {
            await client.query(
              `INSERT INTO consent_records
                 (id, workspace_id, user_id, document_type, document_version, accepted_at)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (workspace_id, user_id, document_type, document_version) DO NOTHING`,
              [
                randomUUID(),
                row.workspace_id,
                row.user_id,
                documentType,
                token.policy_version,
                now,
              ],
            );
          }
        }
        return row
          ? {
              userId: row.user_id,
              workspaceId: row.workspace_id,
              email: row.email,
              segment: row.segment,
              role: row.role,
              plan: row.plan,
            }
          : null;
      },
      { system: true },
    );
  }

  async createCreatorSession(input: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }) {
    await this.systemQuery(
      "INSERT INTO creator_sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
      [input.id, input.userId, input.tokenHash, input.expiresAt],
    );
  }

  async getCreatorBySession(tokenHash: string, now: Date): Promise<CreatorContext | null> {
    const result = await this.systemQuery(
      `SELECT u.id AS user_id, u.email, w.id AS workspace_id, w.segment, wm.role,
              COALESCE(s.plan, 'free') AS plan
       FROM creator_sessions cs
       JOIN users u ON u.id = cs.user_id
       JOIN workspace_members wm ON wm.user_id = u.id
       JOIN workspaces w ON w.id = wm.workspace_id
       LEFT JOIN subscriptions s ON s.workspace_id = w.id
       WHERE cs.token_hash = $1 AND cs.revoked_at IS NULL AND cs.expires_at > $2
         AND u.deleted_at IS NULL
       ORDER BY w.created_at LIMIT 1`,
      [tokenHash, now],
    );
    const row = result.rows[0];
    return row
      ? {
          userId: row.user_id,
          workspaceId: row.workspace_id,
          email: row.email,
          segment: row.segment,
          role: row.role,
          plan: row.plan,
        }
      : null;
  }

  async revokeCreatorSession(tokenHash: string) {
    await this.systemQuery("UPDATE creator_sessions SET revoked_at = now() WHERE token_hash = $1", [
      tokenHash,
    ]);
  }

  async listQuizzes(workspaceId: string, includeArchived = false) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT * FROM quizzes WHERE workspace_id = $1 AND ($2 OR status <> 'archived') ORDER BY updated_at DESC`,
      [workspaceId, includeArchived],
    );
    return result.rows.map(mapQuiz);
  }

  async createQuiz(input: QuizRecord) {
    const result = await this.workspaceQuery(
      input.workspaceId,
      `INSERT INTO quizzes (id, workspace_id, title, description, status, draft, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        input.id,
        input.workspaceId,
        input.title,
        input.description,
        input.status,
        JSON.stringify(input.draft),
        input.createdAt,
        input.updatedAt,
      ],
    );
    return mapQuiz(result.rows[0]!);
  }

  async getQuiz(workspaceId: string, quizId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      "SELECT * FROM quizzes WHERE workspace_id = $1 AND id = $2",
      [workspaceId, quizId],
    );
    return result.rows[0] ? mapQuiz(result.rows[0]) : null;
  }

  async updateQuiz(workspaceId: string, quizId: string, draft: QuizDraft) {
    const result = await this.workspaceQuery(
      workspaceId,
      `UPDATE quizzes SET title = $3, description = $4, draft = $5, updated_at = now()
       WHERE workspace_id = $1 AND id = $2 AND status <> 'archived' RETURNING *`,
      [workspaceId, quizId, draft.title, draft.description, JSON.stringify(draft)],
    );
    return result.rows[0] ? mapQuiz(result.rows[0]) : null;
  }

  async archiveQuiz(
    workspaceId: string,
    quizId: string,
    archived: boolean,
    maxPublishedQuizzes: number | null = null,
  ) {
    return this.transaction(
      async (client) => {
        await client.query("SELECT id FROM workspaces WHERE id = $1 FOR UPDATE", [workspaceId]);
        const current = await client.query(
          "SELECT * FROM quizzes WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
          [workspaceId, quizId],
        );
        const quiz = current.rows[0];
        if (!quiz) return null;
        const restoresPublishedQuiz =
          !archived && quiz.status === "archived" && quiz.current_version_id !== null;
        if (restoresPublishedQuiz && maxPublishedQuizzes !== null) {
          const count = await client.query(
            "SELECT count(*)::integer AS count FROM quizzes WHERE workspace_id = $1 AND status = 'published'",
            [workspaceId],
          );
          if (Number(count.rows[0]?.count ?? 0) >= maxPublishedQuizzes) {
            throw new PublishedQuizLimitError(maxPublishedQuizzes);
          }
        }
        const result = await client.query(
          `UPDATE quizzes SET status = CASE WHEN $3 THEN 'archived'
            WHEN current_version_id IS NULL THEN 'draft' ELSE 'published' END,
            archived_at = CASE WHEN $3 THEN now() ELSE NULL END, updated_at = now()
           WHERE workspace_id = $1 AND id = $2 RETURNING *`,
          [workspaceId, quizId, archived],
        );
        return result.rows[0] ? mapQuiz(result.rows[0]) : null;
      },
      { workspaceId },
    );
  }

  async duplicateQuiz(input: QuizRecord) {
    return this.createQuiz(input);
  }

  async publishQuiz(input: QuizVersionRecord, maxPublishedQuizzes: number | null = null) {
    return this.transaction(
      async (client) => {
        await client.query("SELECT id FROM workspaces WHERE id = $1 FOR UPDATE", [
          input.workspaceId,
        ]);
        const current = await client.query(
          "SELECT status FROM quizzes WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
          [input.workspaceId, input.quizId],
        );
        if (!current.rows[0]) throw new Error("Quiz not found");
        if (current.rows[0].status !== "published" && maxPublishedQuizzes !== null) {
          const count = await client.query(
            "SELECT count(*)::integer AS count FROM quizzes WHERE workspace_id = $1 AND status = 'published'",
            [input.workspaceId],
          );
          if (Number(count.rows[0]?.count ?? 0) >= maxPublishedQuizzes) {
            throw new PublishedQuizLimitError(maxPublishedQuizzes);
          }
        }
        const result = await client.query(
          `INSERT INTO quiz_versions (id, workspace_id, quiz_id, version, content, content_hash, published_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (quiz_id, content_hash) DO UPDATE SET content_hash = EXCLUDED.content_hash
         RETURNING *`,
          [
            input.id,
            input.workspaceId,
            input.quizId,
            input.version,
            JSON.stringify(input.content),
            input.contentHash,
            input.publishedAt,
          ],
        );
        const version = mapVersion(result.rows[0]!);
        await client.query(
          "UPDATE quizzes SET current_version_id = $3, status = 'published', updated_at = now() WHERE workspace_id = $1 AND id = $2",
          [input.workspaceId, input.quizId, version.id],
        );
        return version;
      },
      { workspaceId: input.workspaceId },
    );
  }

  async getQuizVersion(workspaceId: string, versionId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      "SELECT * FROM quiz_versions WHERE workspace_id = $1 AND id = $2",
      [workspaceId, versionId],
    );
    return result.rows[0] ? mapVersion(result.rows[0]) : null;
  }

  async countPublishedQuizzes(workspaceId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      "SELECT count(*)::integer AS count FROM quizzes WHERE workspace_id = $1 AND status = 'published'",
      [workspaceId],
    );
    return result.rows[0]?.count ?? 0;
  }

  async getBrandTheme(workspaceId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      "SELECT brand_theme FROM workspaces WHERE id = $1",
      [workspaceId],
    );
    return (result.rows[0]?.brand_theme as BrandTheme | null | undefined) ?? null;
  }

  async updateBrandTheme(workspaceId: string, theme: BrandTheme | null) {
    const result = await this.workspaceQuery(
      workspaceId,
      "UPDATE workspaces SET brand_theme = $2 WHERE id = $1 RETURNING brand_theme",
      [workspaceId, theme ? JSON.stringify(theme) : null],
    );
    return (result.rows[0]?.brand_theme as BrandTheme | null | undefined) ?? null;
  }

  async createSession(input: StoredSession) {
    const state = input.state;
    try {
      await this.workspaceQuery(
        input.workspaceId,
        `INSERT INTO game_sessions
         (id, workspace_id, quiz_version_id, host_id, code, state, version, seq, deadline,
          settings, state_snapshot, host_token_hash, expires_at, retention_expires_at, created_at,
          updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          input.id,
          input.workspaceId,
          input.quizVersionId,
          input.hostId,
          state.code,
          state.phase,
          state.version,
          state.seq,
          state.deadlineMs ? new Date(state.deadlineMs) : null,
          JSON.stringify(state.settings),
          JSON.stringify(state),
          input.hostTokenHash,
          input.expiresAt,
          input.retentionExpiresAt,
          input.createdAt,
          input.updatedAt,
        ],
      );
    } catch (error) {
      const postgresError = error as { code?: string; constraint?: string };
      if (
        postgresError.code === "23505" &&
        postgresError.constraint === "game_sessions_active_code_uq"
      ) {
        throw new SessionCodeConflictError(state.code);
      }
      throw error;
    }
  }

  async getSessionById(sessionId: string) {
    const result = await this.systemQuery(
      "SELECT * FROM game_sessions WHERE id = $1 AND deleted_at IS NULL",
      [sessionId],
    );
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async getSessionByCode(code: string) {
    const result = await this.systemQuery(
      `SELECT * FROM game_sessions
       WHERE code = $1 AND ended_at IS NULL AND deleted_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [code],
    );
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async listSessionIds(workspaceId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      "SELECT id FROM game_sessions WHERE workspace_id = $1 ORDER BY id",
      [workspaceId],
    );
    return result.rows.map((row) => String(row.id));
  }

  async saveSession(input: StoredSession, expectedVersion: number, report?: Report) {
    const state = input.state;
    if (report && report.sessionId !== input.id) throw new Error("Report session does not match");
    await this.transaction(
      async (client) => {
        const result = await client.query(
          `UPDATE game_sessions SET state = $2, version = $3, seq = $4, deadline = $5,
           state_snapshot = $6,
           ended_at = CASE WHEN $2 = 'finished' THEN COALESCE(ended_at, now()) ELSE ended_at END,
           retention_expires_at = $7, updated_at = now() WHERE id = $1 AND version = $8`,
          [
            input.id,
            state.phase,
            state.version,
            state.seq,
            state.deadlineMs ? new Date(state.deadlineMs) : null,
            JSON.stringify(state),
            input.retentionExpiresAt,
            expectedVersion,
          ],
        );
        if (result.rowCount !== 1) {
          throw new SessionVersionConflictError(input.id, expectedVersion);
        }
        if (report) {
          await client.query(
            `INSERT INTO reports (id, workspace_id, session_id, status, metrics, generated_at)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (session_id) DO UPDATE SET id = EXCLUDED.id, status = EXCLUDED.status,
             metrics = EXCLUDED.metrics, generated_at = EXCLUDED.generated_at`,
            [
              report.id,
              input.workspaceId,
              report.sessionId,
              report.status,
              JSON.stringify(report),
              report.generatedAt,
            ],
          );
        }
      },
      { workspaceId: input.workspaceId },
    );
  }

  async deleteSession(workspaceId: string, sessionId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      "DELETE FROM game_sessions WHERE workspace_id = $1 AND id = $2 RETURNING id",
      [workspaceId, sessionId],
    );
    return result.rowCount === 1;
  }

  async createParticipant(input: ParticipantRecord) {
    await this.systemQuery(
      `INSERT INTO participants (id, session_id, nickname, token_hash, status, joined_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (token_hash) DO UPDATE SET last_seen_at = now(), status = 'active'`,
      [input.id, input.sessionId, input.nickname, input.tokenHash, input.status, input.joinedAt],
    );
  }

  async commitParticipants(
    session: StoredSession,
    participants: ParticipantRecord[],
    expectedVersion: number,
  ) {
    if (participants.length === 0) return;
    await this.transaction(
      async (client) => {
        const inserted = await client.query(
          `INSERT INTO participants (id, session_id, nickname, token_hash, status, joined_at)
           SELECT id, session_id, nickname, token_hash, status, joined_at
           FROM jsonb_to_recordset($1::jsonb) AS input(
             id uuid, session_id uuid, nickname text, token_hash text,
             status text, joined_at timestamptz
           )`,
          [
            JSON.stringify(
              participants.map((participant) => ({
                id: participant.id,
                session_id: participant.sessionId,
                nickname: participant.nickname,
                token_hash: participant.tokenHash,
                status: participant.status,
                joined_at: participant.joinedAt.toISOString(),
              })),
            ),
          ],
        );
        if (inserted.rowCount !== participants.length) {
          throw new Error("Not every participant was committed");
        }
        const state = session.state;
        const saved = await client.query(
          `UPDATE game_sessions SET state = $2, version = $3, seq = $4, deadline = $5,
           state_snapshot = $6, updated_at = now() WHERE id = $1 AND version = $7`,
          [
            session.id,
            state.phase,
            state.version,
            state.seq,
            state.deadlineMs ? new Date(state.deadlineMs) : null,
            JSON.stringify(state),
            expectedVersion,
          ],
        );
        if (saved.rowCount !== 1) {
          throw new SessionVersionConflictError(session.id, expectedVersion);
        }
      },
      { workspaceId: session.workspaceId },
    );
  }

  async getParticipantByToken(tokenHash: string) {
    const result = await this.systemQuery("SELECT * FROM participants WHERE token_hash = $1", [
      tokenHash,
    ]);
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          sessionId: row.session_id,
          nickname: row.nickname,
          tokenHash: row.token_hash,
          status: row.status,
          joinedAt: date(row.joined_at),
        }
      : null;
  }

  async getParticipants(sessionId: string) {
    const result = await this.systemQuery("SELECT * FROM participants WHERE session_id = $1", [
      sessionId,
    ]);
    return result.rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      nickname: row.nickname,
      tokenHash: row.token_hash,
      status: row.status,
      joinedAt: date(row.joined_at),
    }));
  }

  async createMediaAsset(input: MediaAssetRecord) {
    const result = await this.workspaceQuery(
      input.workspaceId,
      `INSERT INTO media_assets
       (id, workspace_id, object_key, mime_type, size_bytes, scan_status, alt_text, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        input.id,
        input.workspaceId,
        input.objectKey,
        input.mimeType,
        input.sizeBytes,
        input.scanStatus,
        input.altText,
        input.createdAt,
      ],
    );
    return mapMediaAsset(result.rows[0]!);
  }

  async getMediaAsset(workspaceId: string, mediaId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      "SELECT * FROM media_assets WHERE workspace_id = $1 AND id = $2",
      [workspaceId, mediaId],
    );
    return result.rows[0] ? mapMediaAsset(result.rows[0]) : null;
  }

  async listMediaAssets(workspaceId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      "SELECT * FROM media_assets WHERE workspace_id = $1 ORDER BY created_at, id",
      [workspaceId],
    );
    return result.rows.map(mapMediaAsset);
  }

  async listStaleMedia(cutoff: Date, limit = 100) {
    const result = await this.systemQuery(
      `SELECT * FROM media_assets
       WHERE scan_status <> 'clean' AND created_at <= $1
       ORDER BY created_at, id LIMIT $2`,
      [cutoff, limit],
    );
    return result.rows.map(mapMediaAsset);
  }

  async updateMediaAsset(
    workspaceId: string,
    mediaId: string,
    update: { objectKey?: string; scanStatus: MediaScanStatus },
  ) {
    const result = await this.workspaceQuery(
      workspaceId,
      `UPDATE media_assets SET scan_status = $3, object_key = COALESCE($4, object_key)
       WHERE workspace_id = $1 AND id = $2 RETURNING *`,
      [workspaceId, mediaId, update.scanStatus, update.objectKey ?? null],
    );
    return result.rows[0] ? mapMediaAsset(result.rows[0]) : null;
  }

  async deleteMediaAsset(workspaceId: string, mediaId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      "DELETE FROM media_assets WHERE workspace_id = $1 AND id = $2 RETURNING id",
      [workspaceId, mediaId],
    );
    return result.rowCount === 1;
  }

  async persistAnswer(workspaceId: string, sessionId: string, answer: EngineAnswer) {
    const result = await this.workspaceQuery(
      workspaceId,
      `INSERT INTO answers
       (id, workspace_id, session_id, round_id, participant_id, choice_id, accepted_at,
        response_ms, score, correct, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (session_id, idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
       RETURNING *`,
      [
        answer.answerId,
        workspaceId,
        sessionId,
        answer.roundId,
        answer.participantId,
        answer.choiceId,
        new Date(answer.acceptedAtMs),
        answer.responseMs,
        answer.score,
        answer.correct,
        answer.idempotencyKey,
      ],
    );
    const row = result.rows[0]!;
    return {
      answerId: row.id,
      participantId: row.participant_id,
      roundId: row.round_id,
      choiceId: row.choice_id,
      acceptedAtMs: date(row.accepted_at).getTime(),
      responseMs: row.response_ms,
      score: row.score,
      correct: row.correct,
      idempotencyKey: row.idempotency_key,
    };
  }

  async commitAnswer(session: StoredSession, answer: EngineAnswer, expectedVersion: number) {
    return (await this.commitAnswers(session, [answer], expectedVersion))[0]!;
  }

  async commitAnswers(session: StoredSession, answers: EngineAnswer[], expectedVersion: number) {
    if (answers.length === 0) return [];
    return this.transaction(
      async (client) => {
        const result = await client.query(
          `WITH answer_input AS (
             SELECT * FROM jsonb_to_recordset($1::jsonb) AS input(
               id uuid, round_id uuid, participant_id uuid, choice_id uuid,
               accepted_at timestamptz, response_ms integer, score integer,
               correct boolean, idempotency_key text
             )
           ),
           persisted_answers AS (
             INSERT INTO answers
               (id, workspace_id, session_id, round_id, participant_id, choice_id, accepted_at,
                response_ms, score, correct, idempotency_key)
             SELECT id, $2, $3, round_id, participant_id, choice_id, accepted_at,
                    response_ms, score, correct, idempotency_key
             FROM answer_input
             ON CONFLICT (session_id, idempotency_key) DO UPDATE
               SET idempotency_key = EXCLUDED.idempotency_key
             RETURNING *
           ),
           session_update AS (
             UPDATE game_sessions SET state = $4, version = $5, seq = $6, deadline = $7,
               state_snapshot = $8, updated_at = now()
             WHERE id = $3 AND version = $10
             RETURNING id
           ),
           participant_input AS (
             SELECT * FROM jsonb_to_recordset($9::jsonb) AS input(
               id uuid, score integer, correct_count integer, accepted_response_ms bigint
             )
           ),
           participant_update AS (
             UPDATE participants AS participant SET
               score = input.score,
               correct_count = input.correct_count,
               accepted_response_ms = input.accepted_response_ms,
               last_seen_at = now()
             FROM participant_input AS input
             WHERE participant.id = input.id
             RETURNING participant.id
           )
           SELECT persisted_answers.*,
             (SELECT count(*) FROM session_update) AS session_updates,
             (SELECT count(*) FROM participant_update) AS participant_updates
           FROM persisted_answers`,
          [
            JSON.stringify(
              answers.map((answer) => ({
                id: answer.answerId,
                round_id: answer.roundId,
                participant_id: answer.participantId,
                choice_id: answer.choiceId,
                accepted_at: new Date(answer.acceptedAtMs).toISOString(),
                response_ms: answer.responseMs,
                score: answer.score,
                correct: answer.correct,
                idempotency_key: answer.idempotencyKey,
              })),
            ),
            session.workspaceId,
            session.id,
            session.state.phase,
            session.state.version,
            session.state.seq,
            session.state.deadlineMs ? new Date(session.state.deadlineMs) : null,
            JSON.stringify(session.state),
            JSON.stringify(
              [...new Set(answers.map((answer) => answer.participantId))].map((participantId) => {
                const participant = session.state.participants[participantId];
                return {
                  id: participantId,
                  score: participant?.score ?? 0,
                  correct_count: participant?.correctCount ?? 0,
                  accepted_response_ms: participant?.acceptedResponseMs ?? 0,
                };
              }),
            ),
            expectedVersion,
          ],
        );
        if (Number(result.rows[0]?.session_updates ?? 0) !== 1) {
          throw new SessionVersionConflictError(session.id, expectedVersion);
        }
        const expectedParticipantUpdates = new Set(answers.map((answer) => answer.participantId))
          .size;
        if (Number(result.rows[0]?.participant_updates ?? 0) !== expectedParticipantUpdates) {
          throw new Error("Not every answer participant was updated");
        }
        const byIdempotencyKey = new Map(
          result.rows.map((row) => [
            String(row.idempotency_key),
            {
              answerId: row.id,
              participantId: row.participant_id,
              roundId: row.round_id,
              choiceId: row.choice_id,
              acceptedAtMs: date(row.accepted_at).getTime(),
              responseMs: row.response_ms,
              score: row.score,
              correct: row.correct,
              idempotencyKey: row.idempotency_key,
            } satisfies EngineAnswer,
          ]),
        );
        const persisted = answers.map((answer) => {
          const persisted = byIdempotencyKey.get(answer.idempotencyKey);
          if (!persisted) throw new Error("A committed answer was not returned by PostgreSQL");
          return persisted;
        });
        if (persisted.some((answer, index) => answer.answerId !== answers[index]?.answerId)) {
          throw new Error("Answer state changed during persistence");
        }
        return persisted;
      },
      { workspaceId: session.workspaceId },
    );
  }

  async saveReport(workspaceId: string, report: Report) {
    await this.workspaceQuery(
      workspaceId,
      `INSERT INTO reports (id, workspace_id, session_id, status, metrics, generated_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (session_id) DO UPDATE SET id = EXCLUDED.id, status = EXCLUDED.status,
       metrics = EXCLUDED.metrics, generated_at = EXCLUDED.generated_at`,
      [
        report.id,
        workspaceId,
        report.sessionId,
        report.status,
        JSON.stringify(report),
        report.generatedAt,
      ],
    );
  }

  private mapReport(row: QueryResultRow): Report {
    return {
      ...(row.metrics as Report),
      expiresAt: date(row.retention_expires_at).toISOString(),
    };
  }

  async getReport(workspaceId: string, reportId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT reports.*, game_sessions.retention_expires_at
       FROM reports JOIN game_sessions ON game_sessions.id = reports.session_id
       WHERE reports.workspace_id = $1 AND reports.id = $2`,
      [workspaceId, reportId],
    );
    return result.rows[0] ? this.mapReport(result.rows[0]) : null;
  }

  async getReportBySession(workspaceId: string, sessionId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT reports.*, game_sessions.retention_expires_at
       FROM reports JOIN game_sessions ON game_sessions.id = reports.session_id
       WHERE reports.workspace_id = $1 AND reports.session_id = $2`,
      [workspaceId, sessionId],
    );
    return result.rows[0] ? this.mapReport(result.rows[0]) : null;
  }

  async getPlan(workspaceId: string): Promise<Plan> {
    const result = await this.workspaceQuery(
      workspaceId,
      "SELECT plan FROM subscriptions WHERE workspace_id = $1",
      [workspaceId],
    );
    return (result.rows[0]?.plan as Plan | undefined) ?? "free";
  }

  async getBillingProfile(workspaceId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT plan, status, provider_customer_id, provider_subscription_id
       FROM subscriptions WHERE workspace_id = $1`,
      [workspaceId],
    );
    const row = result.rows[0];
    return {
      plan: (row?.plan as Plan | undefined) ?? "free",
      status: row?.status ?? "free",
      customerId: row?.provider_customer_id ?? null,
      subscriptionId: row?.provider_subscription_id ?? null,
    };
  }

  async setPlan(
    workspaceId: string,
    plan: Plan,
    provider: { customerId?: string; subscriptionId?: string; status?: string } = {},
  ) {
    await this.workspaceQuery(
      workspaceId,
      `INSERT INTO subscriptions
       (workspace_id, plan, status, provider_customer_id, provider_subscription_id, updated_at)
       VALUES ($1,$2,$3,$4,$5,now())
       ON CONFLICT (workspace_id) DO UPDATE SET plan = EXCLUDED.plan, status = EXCLUDED.status,
       provider_customer_id = COALESCE(EXCLUDED.provider_customer_id, subscriptions.provider_customer_id),
       provider_subscription_id = COALESCE(EXCLUDED.provider_subscription_id, subscriptions.provider_subscription_id),
       updated_at = now()`,
      [
        workspaceId,
        plan,
        provider.status ?? (plan === "free" ? "free" : "active"),
        provider.customerId,
        provider.subscriptionId,
      ],
    );
  }

  async recordBillingEvent(providerEventId: string, eventType: string) {
    const result = await this.systemQuery(
      `INSERT INTO billing_events (provider_event_id, event_type) VALUES ($1,$2)
       ON CONFLICT DO NOTHING RETURNING provider_event_id`,
      [providerEventId, eventType],
    );
    return result.rowCount === 1;
  }

  async applyBillingEvent(input: BillingEventInput) {
    return this.transaction(
      async (client) => {
        const recorded = await client.query(
          `INSERT INTO billing_events (provider_event_id, event_type, provider_created_at)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING provider_event_id`,
          [input.providerEventId, input.eventType, input.providerCreatedAt],
        );
        if (recorded.rowCount !== 1) return false;
        if (!input.workspaceId || !input.plan) return true;

        await client.query(
          `INSERT INTO subscriptions
           (workspace_id, plan, status, provider_customer_id, provider_subscription_id,
            last_event_created_at, updated_at)
           SELECT $1,$2,$3,$4,$5,$6,now()
           WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = $1)
           ON CONFLICT (workspace_id) DO UPDATE SET
             plan = EXCLUDED.plan,
             status = EXCLUDED.status,
             provider_customer_id = COALESCE(EXCLUDED.provider_customer_id,
               subscriptions.provider_customer_id),
             provider_subscription_id = COALESCE(EXCLUDED.provider_subscription_id,
               subscriptions.provider_subscription_id),
             last_event_created_at = EXCLUDED.last_event_created_at,
             updated_at = now()
           WHERE subscriptions.last_event_created_at IS NULL
              OR EXCLUDED.last_event_created_at >= subscriptions.last_event_created_at`,
          [
            input.workspaceId,
            input.plan,
            input.status ?? (input.plan === "free" ? "free" : "active"),
            input.customerId,
            input.subscriptionId,
            input.providerCreatedAt,
          ],
        );
        return true;
      },
      { system: true },
    );
  }

  async recordAudit(input: AuditInput) {
    const sql = `INSERT INTO audit_events
       (id, workspace_id, actor_id, action, target_type, target_id, request_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`;
    const values = [
      randomUUID(),
      input.workspaceId,
      input.actorId,
      input.action,
      input.targetType,
      input.targetId,
      input.requestId,
      JSON.stringify(input.metadata ?? {}),
    ];
    if (input.workspaceId) await this.workspaceQuery(input.workspaceId, sql, values);
    else await this.systemQuery(sql, values);
  }

  async exportAccount(userId: string) {
    return this.transaction(
      async (client) => {
        const userResult = await client.query(
          "SELECT id, email, locale, created_at FROM users WHERE id = $1 AND deleted_at IS NULL",
          [userId],
        );
        const workspaceResult = await client.query(
          `SELECT w.* FROM workspaces w JOIN workspace_members wm ON wm.workspace_id = w.id
         WHERE wm.user_id = $1`,
          [userId],
        );
        const workspaceIds = workspaceResult.rows.map((row) => row.id);
        const queryWorkspaceData = async (sql: string) =>
          workspaceIds.length ? client.query(sql, [workspaceIds]) : { rows: [] };
        const quizzes = await queryWorkspaceData(
          `SELECT id, workspace_id, title, description, status, draft, current_version_id,
                  created_at, updated_at
           FROM quizzes WHERE workspace_id = ANY($1::uuid[]) ORDER BY created_at, id`,
        );
        const quizVersions = await queryWorkspaceData(
          `SELECT id, workspace_id, quiz_id, version, content, content_hash, published_at
           FROM quiz_versions WHERE workspace_id = ANY($1::uuid[])
           ORDER BY quiz_id, version`,
        );
        const mediaAssets = await queryWorkspaceData(
          `SELECT id, workspace_id, object_key, mime_type, size_bytes, scan_status, alt_text,
                  created_at
           FROM media_assets WHERE workspace_id = ANY($1::uuid[]) ORDER BY created_at, id`,
        );
        const sessions = await queryWorkspaceData(
          `SELECT id, workspace_id, quiz_version_id, host_id, code, state, version, seq,
                  deadline, settings, state_snapshot, ended_at, deleted_at, expires_at,
                  retention_expires_at, created_at, updated_at
           FROM game_sessions WHERE workspace_id = ANY($1::uuid[]) ORDER BY created_at, id`,
        );
        const sessionIds = sessions.rows.map((row) => row.id);
        const participants = sessionIds.length
          ? await client.query(
              `SELECT id, session_id, nickname, status, score, correct_count,
                      accepted_response_ms, joined_at, last_seen_at
               FROM participants WHERE session_id = ANY($1::uuid[]) ORDER BY joined_at, id`,
              [sessionIds],
            )
          : { rows: [] };
        const answers = await queryWorkspaceData(
          `SELECT id, workspace_id, session_id, round_id, participant_id, choice_id,
                  accepted_at, response_ms, score, correct, idempotency_key
           FROM answers WHERE workspace_id = ANY($1::uuid[]) ORDER BY accepted_at, id`,
        );
        const reports = await queryWorkspaceData(
          `SELECT id, workspace_id, session_id, status, metrics, generated_at, created_at
           FROM reports WHERE workspace_id = ANY($1::uuid[]) ORDER BY created_at, id`,
        );
        const subscriptions = await queryWorkspaceData(
          `SELECT workspace_id, provider_customer_id, provider_subscription_id, status, plan,
                  current_period_end, updated_at
           FROM subscriptions WHERE workspace_id = ANY($1::uuid[]) ORDER BY workspace_id`,
        );
        const auditEvents = await queryWorkspaceData(
          `SELECT id, workspace_id, actor_id, action, target_type, target_id, request_id,
                  metadata, created_at
           FROM audit_events WHERE workspace_id = ANY($1::uuid[]) ORDER BY created_at, id`,
        );
        const consentRecords = await client.query(
          `SELECT document_type, document_version, accepted_at
           FROM consent_records WHERE user_id = $1 ORDER BY accepted_at`,
          [userId],
        );
        return {
          profile: userResult.rows[0] ?? null,
          workspaces: workspaceResult.rows,
          quizzes: quizzes.rows,
          quizVersions: quizVersions.rows,
          mediaAssets: mediaAssets.rows,
          sessions: sessions.rows,
          participants: participants.rows,
          answers: answers.rows,
          reports: reports.rows,
          billing: subscriptions.rows,
          consentRecords: consentRecords.rows,
          auditEvents: auditEvents.rows,
        };
      },
      { system: true },
    );
  }

  async deleteAccount(userId: string) {
    await this.transaction(
      async (client) => {
        const workspaceResult = await client.query(
          "SELECT workspace_id FROM workspace_members WHERE user_id = $1 AND role = 'owner'",
          [userId],
        );
        for (const row of workspaceResult.rows) {
          await client.query("DELETE FROM workspaces WHERE id = $1", [row.workspace_id]);
        }
        await client.query("UPDATE users SET email = $2, deleted_at = now() WHERE id = $1", [
          userId,
          `deleted-${createHash("sha256").update(userId).digest("hex").slice(0, 16)}@invalid.local`,
        ]);
        await client.query("UPDATE creator_sessions SET revoked_at = now() WHERE user_id = $1", [
          userId,
        ]);
      },
      { system: true },
    );
  }

  async expireLiveSessions(now: Date) {
    const result = await this.systemQuery(
      `UPDATE game_sessions SET ended_at = COALESCE(ended_at, $1), updated_at = now()
       WHERE expires_at <= $1 AND ended_at IS NULL AND deleted_at IS NULL
       RETURNING id`,
      [now],
    );
    return result.rows.map((row) => String(row.id));
  }

  async purgeExpired(now: Date) {
    return this.transaction(
      async (client) => {
        const result = await client.query(
          "DELETE FROM game_sessions WHERE retention_expires_at <= $1 RETURNING id",
          [now],
        );
        await client.query("DELETE FROM auth_magic_tokens WHERE expires_at <= $1", [now]);
        await client.query("DELETE FROM creator_sessions WHERE expires_at <= $1", [now]);
        return result.rows.map((row) => String(row.id));
      },
      { system: true },
    );
  }
}

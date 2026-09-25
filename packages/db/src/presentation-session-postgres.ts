import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { PostgresRepository } from "./postgres.js";
import {
  PRESENTATION_EFFECTIVE_EVENT_SEQ_SQL,
  mapCredential,
  mapParticipant,
  mapReport,
  mapResponse,
  mapSession,
  mapTimeline,
} from "./presentation-session-postgres-support.js";
import {
  normalizeSession,
  responseWindowOpen,
  transitionWindow,
} from "./presentation-session-rules.js";
import {
  PresentationSessionConflictError,
  type PresentationParticipantJoin,
  type PresentationParticipantSnapshotProjection,
  type PresentationResponseAcceptance,
  type PresentationResponseAcknowledgementState,
  type PresentationResponseContext,
  type PresentationSessionCommandInput,
  type PresentationSessionCreateInput,
  type PresentationSessionCredentialRecord,
  type PresentationSessionCredentialRole,
  type PresentationSessionParticipantRecord,
  type PresentationSessionRecord,
  type PresentationSessionReportCompletion,
  type PresentationSessionReportJob,
  type PresentationSessionRepository,
  type PresentationSessionResponseRecord,
  type PresentationSessionTransitionInput,
  type PresentationTransitionAcceptance,
} from "./presentation-session-types.js";

export class PostgresPresentationSessionRepository implements PresentationSessionRepository {
  constructor(
    private readonly repository: PostgresRepository,
    private readonly options: { concurrentResponseWrites?: boolean } = {},
  ) {}

  private async transaction<T>(
    workspaceId: string | null,
    work: (client: PoolClient) => Promise<T>,
  ) {
    const client = await this.repository.pool.connect();
    try {
      await client.query("BEGIN");
      if (workspaceId) {
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
      } else {
        await client.query("SELECT set_config('app.system_access', 'on', true)");
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

  private async responseAcknowledgementState(
    client: PoolClient,
    workspaceId: string,
    sessionId: string,
    participantId: string,
  ): Promise<PresentationResponseAcknowledgementState> {
    const parameters = [workspaceId, sessionId, participantId];
    const openQuestionResult = await client.query(
      `SELECT to_jsonb(session) || jsonb_build_object(
                'event_seq', session.event_seq_offset
                  + session.revision
                  + participant_totals.participant_count
                  + response_totals.response_count
              ) AS response_session,
              participant_totals.participant_count::integer AS participant_count,
              (SELECT row_to_json(current_response)
                 FROM presentation_live_responses current_response
                WHERE current_response.session_id = session.id
                  AND current_response.participant_id = $3
                  AND session.current_block_index >= 0
                  AND current_response.block_id::text =
                    session.content_snapshot -> 'blocks' -> session.current_block_index ->> 'id'
                LIMIT 1) AS current_response
         FROM presentation_live_sessions session
         CROSS JOIN LATERAL (
           SELECT count(*) AS participant_count
             FROM presentation_live_participants participant
            WHERE participant.session_id = session.id
         ) participant_totals
         CROSS JOIN LATERAL (
           SELECT count(*) AS response_count
             FROM presentation_live_responses response
            WHERE response.session_id = session.id
         ) response_totals
        WHERE session.workspace_id = $1 AND session.id = $2`,
      parameters,
    );
    let row = openQuestionResult.rows[0];
    if (!row) throw new Error("Presentation response session no longer exists");
    let session = mapSession(row.response_session);
    if (session.phase !== "question_open") {
      // Ranking is deliberately absent from the high-volume open-question acknowledgement path.
      // If results are visible, repeat every projection field with the standing in one statement
      // so a transition to the next question cannot pair a future score with an older fence.
      const visibleResult = await client.query(
        `SELECT to_jsonb(session) || jsonb_build_object(
                  'event_seq', session.event_seq_offset
                    + session.revision
                    + participant_totals.participant_count
                    + response_totals.response_count
                ) AS response_session,
                participant_totals.participant_count::integer AS participant_count,
                (SELECT row_to_json(current_response)
                   FROM presentation_live_responses current_response
                  WHERE current_response.session_id = session.id
                    AND current_response.participant_id = $3
                    AND session.current_block_index >= 0
                    AND current_response.block_id::text =
                      session.content_snapshot -> 'blocks' -> session.current_block_index ->> 'id'
                  LIMIT 1) AS current_response,
              standing.score AS standing_score,
              standing.rank AS standing_rank
           FROM presentation_live_sessions session
           CROSS JOIN LATERAL (
             SELECT count(*) AS participant_count
               FROM presentation_live_participants participant
              WHERE participant.session_id = session.id
           ) participant_totals
           CROSS JOIN LATERAL (
             SELECT count(*) AS response_count
               FROM presentation_live_responses response
              WHERE response.session_id = session.id
           ) response_totals
           LEFT JOIN LATERAL (
             WITH participant_scores AS (
               SELECT participant.id, participant.joined_at, participant.nickname,
                      COALESCE(SUM(response.score), 0)::bigint AS score
                 FROM presentation_live_participants participant
                 LEFT JOIN presentation_live_responses response
                   ON response.session_id = participant.session_id
                  AND response.participant_id = participant.id
                WHERE session.phase <> 'question_open'
                  AND participant.session_id = session.id
                GROUP BY participant.id, participant.joined_at, participant.nickname
             ), standings AS (
               SELECT id, score,
                      ROW_NUMBER() OVER (
                        ORDER BY score DESC, joined_at ASC, nickname ASC, id ASC
                      )::integer AS rank
                 FROM participant_scores
             )
             SELECT score, rank FROM standings WHERE id = $3
           ) standing ON true
          WHERE session.workspace_id = $1 AND session.id = $2`,
        parameters,
      );
      row = visibleResult.rows[0];
      if (!row) throw new Error("Presentation response session no longer exists");
      session = mapSession(row.response_session);
    }
    if (session.phase !== "question_open" && row.standing_rank == null) {
      throw new Error("Presentation response participant no longer exists");
    }
    const standing: PresentationParticipantSnapshotProjection["standing"] =
      row.standing_rank == null
        ? null
        : { rank: Number(row.standing_rank), score: Number(row.standing_score) };
    return {
      session,
      projection: {
        participantCount: Number(row.participant_count),
        standing,
        currentResponse: row.current_response ? mapResponse(row.current_response) : null,
      },
    };
  }

  private async insertSession(client: PoolClient, input: PresentationSessionCreateInput) {
    const normalized = normalizeSession(input);
    const result = await client.query(
      `INSERT INTO presentation_live_sessions
        (id, workspace_id, presentation_id, presentation_version_id, title, content_snapshot,
         join_code, status, phase, current_block_index, revision, settings, trust_mode,
         event_seq, question_opened_at, question_closes_at, created_by,
         created_at, updated_at, finished_at, live_expires_at, retention_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING *`,
      [
        normalized.id,
        normalized.workspaceId,
        normalized.presentationId,
        normalized.presentationVersionId,
        normalized.title,
        JSON.stringify(normalized.content),
        normalized.code,
        normalized.status,
        normalized.phase,
        normalized.currentBlockIndex,
        normalized.revision,
        JSON.stringify(normalized.settings),
        normalized.trustMode,
        normalized.eventSeq,
        normalized.questionOpenedAt,
        normalized.questionClosesAt,
        normalized.createdBy,
        normalized.createdAt,
        normalized.updatedAt,
        normalized.finishedAt,
        normalized.liveExpiresAt,
        normalized.retentionExpiresAt,
      ],
    );
    return mapSession(result.rows[0]!);
  }

  private async insertCredential(client: PoolClient, input: PresentationSessionCredentialRecord) {
    const result = await client.query(
      `INSERT INTO presentation_session_credentials
        (id, workspace_id, session_id, role, token_hash, created_at, expires_at, revoked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        input.id,
        input.workspaceId,
        input.sessionId,
        input.role,
        input.tokenHash,
        input.createdAt,
        input.expiresAt,
        input.revokedAt,
      ],
    );
    return mapCredential(result.rows[0]!);
  }

  async listSessions(workspaceId: string, now = new Date()) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        `SELECT session.*, ${PRESENTATION_EFFECTIVE_EVENT_SEQ_SQL} AS event_seq
           FROM presentation_live_sessions session
          WHERE session.workspace_id = $1
            AND (session.status <> 'active' OR session.live_expires_at > $2)
          ORDER BY session.created_at DESC`,
        [workspaceId, now],
      );
      return result.rows.map(mapSession);
    });
  }

  async createSession(input: PresentationSessionCreateInput) {
    const normalized = normalizeSession(input);
    return this.transaction(normalized.workspaceId, (client) => this.insertSession(client, input));
  }

  async createSessionWithCredential(
    input: PresentationSessionCreateInput,
    credential: PresentationSessionCredentialRecord,
  ) {
    const normalized = normalizeSession(input);
    if (
      credential.workspaceId !== normalized.workspaceId ||
      credential.sessionId !== normalized.id
    ) {
      throw new Error("Presentation credential must belong to the session being created");
    }
    return this.transaction(normalized.workspaceId, async (client) => {
      const session = await this.insertSession(client, normalized);
      const storedCredential = await this.insertCredential(client, credential);
      return { session, credential: storedCredential };
    });
  }

  async getSessionForWorkspace(workspaceId: string, sessionId: string) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        `SELECT session.*, ${PRESENTATION_EFFECTIVE_EVENT_SEQ_SQL} AS event_seq
           FROM presentation_live_sessions session
          WHERE session.workspace_id = $1 AND session.id = $2`,
        [workspaceId, sessionId],
      );
      return result.rows[0] ? mapSession(result.rows[0]) : null;
    });
  }

  async getSessionById(sessionId: string) {
    return this.transaction(null, async (client) => {
      const result = await client.query(
        `SELECT session.*, ${PRESENTATION_EFFECTIVE_EVENT_SEQ_SQL} AS event_seq
           FROM presentation_live_sessions session
          WHERE session.id = $1`,
        [sessionId],
      );
      return result.rows[0] ? mapSession(result.rows[0]) : null;
    });
  }

  async getSessionByCode(code: string) {
    return this.transaction(null, async (client) => {
      const result = await client.query(
        `SELECT session.*, ${PRESENTATION_EFFECTIVE_EVENT_SEQ_SQL} AS event_seq
           FROM presentation_live_sessions session
          WHERE session.join_code = $1
            AND session.status = 'active'
            AND session.live_expires_at > now()
          ORDER BY session.created_at DESC LIMIT 1`,
        [code],
      );
      return result.rows[0] ? mapSession(result.rows[0]) : null;
    });
  }

  private async applyTransition(
    client: PoolClient,
    input: PresentationSessionTransitionInput,
    commandId?: string,
  ): Promise<{
    status: "accepted" | "duplicate" | "idempotency_conflict";
    session: PresentationSessionRecord;
  } | null> {
    if (commandId) {
      const prior = await client.query(
        `SELECT expected_revision FROM presentation_session_command_receipts
         WHERE session_id = $1 AND command_id = $2`,
        [input.sessionId, commandId],
      );
      if (prior.rows[0]) {
        const current = await client.query(
          `SELECT session.*, ${PRESENTATION_EFFECTIVE_EVENT_SEQ_SQL} AS event_seq
             FROM presentation_live_sessions session
            WHERE session.workspace_id = $1 AND session.id = $2`,
          [input.workspaceId, input.sessionId],
        );
        if (!current.rows[0]) return null;
        return {
          status:
            Number(prior.rows[0].expected_revision) === input.expectedRevision
              ? "duplicate"
              : "idempotency_conflict",
          session: mapSession(current.rows[0]),
        };
      }
    }
    const locked = await client.query(
      "SELECT * FROM presentation_live_sessions WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
      [input.workspaceId, input.sessionId],
    );
    if (!locked.rows[0]) return null;
    if (commandId) {
      const prior = await client.query(
        `SELECT expected_revision FROM presentation_session_command_receipts
         WHERE session_id = $1 AND command_id = $2`,
        [input.sessionId, commandId],
      );
      if (prior.rows[0]) {
        const current = await client.query(
          `SELECT session.*, ${PRESENTATION_EFFECTIVE_EVENT_SEQ_SQL} AS event_seq
             FROM presentation_live_sessions session
            WHERE session.workspace_id = $1 AND session.id = $2`,
          [input.workspaceId, input.sessionId],
        );
        if (!current.rows[0]) return null;
        return {
          status:
            Number(prior.rows[0].expected_revision) === input.expectedRevision
              ? "duplicate"
              : "idempotency_conflict",
          session: mapSession(current.rows[0]),
        };
      }
    }
    const session = mapSession(locked.rows[0]);
    if (session.revision !== input.expectedRevision) {
      throw new PresentationSessionConflictError(input.expectedRevision, session.revision);
    }
    const occurredAt = input.occurredAt ?? new Date();
    const window = transitionWindow(session, input, occurredAt);
    await client.query(
      `UPDATE presentation_live_sessions
       SET phase = $3, current_block_index = $4, status = $5, revision = revision + 1,
           event_seq = event_seq + 1, updated_at = $6,
           question_opened_at = $7, question_closes_at = $8,
           finished_at = CASE
             WHEN status <> 'finished' AND $5 = 'finished' THEN $6
             ELSE finished_at
           END,
           retention_expires_at = CASE
             WHEN status <> 'finished' AND $5 = 'finished' AND $9::timestamptz IS NOT NULL THEN $9
             ELSE retention_expires_at
           END
       WHERE workspace_id = $1 AND id = $2`,
      [
        input.workspaceId,
        input.sessionId,
        input.phase,
        input.currentBlockIndex,
        input.status,
        occurredAt,
        window.questionOpenedAt,
        window.questionClosesAt,
        input.retentionExpiresAt ?? null,
      ],
    );
    const current = await client.query(
      `SELECT session.*, ${PRESENTATION_EFFECTIVE_EVENT_SEQ_SQL} AS event_seq
         FROM presentation_live_sessions session
        WHERE session.workspace_id = $1 AND session.id = $2`,
      [input.workspaceId, input.sessionId],
    );
    const stored = mapSession(current.rows[0]!);
    await client.query(
      `INSERT INTO presentation_session_timeline
        (id, workspace_id, session_id, sequence, event_type, block_index, block_id, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        randomUUID(),
        input.workspaceId,
        input.sessionId,
        stored.eventSeq,
        input.event.type,
        input.event.blockIndex,
        input.event.blockId,
        occurredAt,
      ],
    );
    if (commandId) {
      await client.query(
        `INSERT INTO presentation_session_command_receipts
          (id, workspace_id, session_id, command_id, expected_revision, resulting_revision,
           event_type, received_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          randomUUID(),
          input.workspaceId,
          input.sessionId,
          commandId,
          input.expectedRevision,
          stored.revision,
          input.event.type,
          occurredAt,
        ],
      );
    }
    return { status: "accepted", session: stored };
  }

  async transitionSession(input: PresentationSessionTransitionInput) {
    return this.transaction(input.workspaceId, async (client) => {
      const result = await this.applyTransition(client, input);
      return result?.session ?? null;
    });
  }

  async transitionSessionCommand(
    input: PresentationSessionCommandInput,
  ): Promise<PresentationTransitionAcceptance> {
    return this.transaction(input.workspaceId, async (client) => {
      const result = await this.applyTransition(client, input, input.commandId);
      return result ?? { status: "not_found" };
    });
  }

  async addParticipant(input: PresentationSessionParticipantRecord) {
    return this.transaction(null, async (client) => {
      const result = await client.query(
        `INSERT INTO presentation_live_participants
          (id, workspace_id, session_id, nickname, token_hash, joined_at, last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          input.id,
          input.workspaceId,
          input.sessionId,
          input.nickname,
          input.tokenHash,
          input.joinedAt,
          input.lastSeenAt,
        ],
      );
      return mapParticipant(result.rows[0]!);
    });
  }

  async joinParticipantWithinLimit(
    input: PresentationSessionParticipantRecord,
    participantLimit: number,
  ): Promise<PresentationParticipantJoin> {
    return this.transaction(input.workspaceId, async (client) => {
      const locked = await client.query(
        `SELECT status, $3::timestamptz < live_expires_at AS live_open
         FROM presentation_live_sessions
         WHERE workspace_id = $1 AND id = $2
         FOR UPDATE`,
        [input.workspaceId, input.sessionId, input.joinedAt],
      );
      if (!locked.rows[0] || locked.rows[0].status !== "active" || !locked.rows[0].live_open) {
        return { status: "closed" };
      }
      const count = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM presentation_live_participants WHERE session_id = $1",
        [input.sessionId],
      );
      if (Number(count.rows[0]?.count ?? 0) >= participantLimit) return { status: "full" };
      const result = await client.query(
        `INSERT INTO presentation_live_participants
          (id, workspace_id, session_id, nickname, token_hash, joined_at, last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          input.id,
          input.workspaceId,
          input.sessionId,
          input.nickname,
          input.tokenHash,
          input.joinedAt,
          input.lastSeenAt,
        ],
      );
      return { status: "accepted", participant: mapParticipant(result.rows[0]!) };
    });
  }

  async findParticipant(sessionId: string, tokenHash: string) {
    return this.transaction(null, async (client) => {
      const result = await client.query(
        `UPDATE presentation_live_participants SET last_seen_at = now()
         WHERE session_id = $1 AND token_hash = $2 RETURNING *`,
        [sessionId, tokenHash],
      );
      return result.rows[0] ? mapParticipant(result.rows[0]) : null;
    });
  }

  async getResponseContext(
    sessionId: string,
    tokenHash: string,
    idempotencyKey: string,
  ): Promise<PresentationResponseContext | null> {
    return this.transaction(null, async (client) => {
      const result = await client.query(
        `UPDATE presentation_live_participants AS participant
            SET last_seen_at = now()
           FROM presentation_live_sessions AS session
          WHERE participant.session_id = $1
            AND participant.token_hash = $2
            AND session.id = participant.session_id
        RETURNING participant.*,
                  -- This session is validation context, never a client snapshot. Avoid aggregate
                  -- fence scans here; the post-commit acknowledgement performs the authoritative
                  -- sequence read that is returned to the participant.
                  to_jsonb(session) AS response_session,
                  (SELECT row_to_json(prior_response)
                     FROM presentation_live_responses AS prior_response
                    WHERE prior_response.session_id = participant.session_id
                      AND prior_response.participant_id = participant.id
                      AND prior_response.idempotency_key = $3
                    LIMIT 1) AS prior_response`,
        [sessionId, tokenHash, idempotencyKey],
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        session: mapSession(row.response_session),
        participant: mapParticipant(row),
        priorResponse: row.prior_response ? mapResponse(row.prior_response) : null,
      };
    });
  }

  async listParticipants(sessionId: string) {
    return this.transaction(null, async (client) => {
      const result = await client.query(
        "SELECT * FROM presentation_live_participants WHERE session_id = $1 ORDER BY joined_at",
        [sessionId],
      );
      return result.rows.map(mapParticipant);
    });
  }

  async saveResponse(input: PresentationSessionResponseRecord) {
    return this.transaction(null, async (client) => {
      const result = await client.query(
        `INSERT INTO presentation_live_responses
          (id, workspace_id, session_id, participant_id, block_id, question_id,
           response, correct, score, response_ms, submitted_at, idempotency_key, request_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (session_id, participant_id, block_id)
         DO NOTHING
         RETURNING *`,
        [
          input.id,
          input.workspaceId,
          input.sessionId,
          input.participantId,
          input.blockId,
          input.questionId,
          JSON.stringify(input.response),
          input.correct,
          input.score,
          input.responseMs,
          input.submittedAt,
          input.idempotencyKey ?? null,
          input.requestHash ?? null,
        ],
      );
      if (result.rows[0]) return mapResponse(result.rows[0]);
      const existing = await client.query(
        `SELECT * FROM presentation_live_responses
         WHERE session_id = $1 AND participant_id = $2 AND block_id = $3`,
        [input.sessionId, input.participantId, input.blockId],
      );
      return mapResponse(existing.rows[0]!);
    });
  }

  async acceptResponse(
    input: PresentationSessionResponseRecord,
    expectedSessionRevision: number,
  ): Promise<PresentationResponseAcceptance> {
    type WriteResult =
      | { status: "accepted"; response: PresentationSessionResponseRecord }
      | { status: "duplicate"; response: PresentationSessionResponseRecord }
      | { status: "idempotency_conflict"; response: PresentationSessionResponseRecord }
      | { status: "already_responded"; response: PresentationSessionResponseRecord }
      | { status: "phase_closed" };

    const write = await this.transaction<WriteResult>(input.workspaceId, async (client) => {
      if (input.idempotencyKey) {
        // The uniqueness index cannot expose an uncommitted receipt to a request whose stale-state
        // predicate would otherwise fail before INSERT. Serialize only this participant/key before
        // the first lookup; unrelated answers remain concurrent.
        await client.query(
          `SELECT pg_advisory_xact_lock(
             hashtextextended($1::text || ':' || $2::text || ':' || $3::text, 0)
           )`,
          [input.sessionId, input.participantId, input.idempotencyKey],
        );
      }
      const findIdempotentResponse = async () => {
        if (!input.idempotencyKey) return null;
        const result = await client.query(
          `SELECT * FROM presentation_live_responses
           WHERE session_id = $1 AND participant_id = $2 AND idempotency_key = $3`,
          [input.sessionId, input.participantId, input.idempotencyKey],
        );
        return result.rows[0] ? mapResponse(result.rows[0]) : null;
      };
      const prior = await findIdempotentResponse();
      if (prior) {
        return prior.requestHash && input.requestHash && prior.requestHash !== input.requestHash
          ? { status: "idempotency_conflict", response: prior }
          : { status: "duplicate", response: prior };
      }

      if (this.options.concurrentResponseWrites) {
        // Enable only after every serving binary reads the commit-visible aggregate fence. The
        // trigger stays installed for prior-image rollback and transactions that omit this local
        // setting.
        await client.query(
          "SELECT set_config('app.presentation_concurrent_response_writes', 'on', true)",
        );
      }
      const sessionLock = this.options.concurrentResponseWrites ? "FOR SHARE" : "FOR UPDATE";
      const inserted = await client.query(
        `WITH locked_session AS MATERIALIZED (
           SELECT *
             FROM presentation_live_sessions
            WHERE workspace_id = $2 AND id = $3
            ${sessionLock}
         ), eligible_session AS (
           SELECT 1
             FROM locked_session
            WHERE status = 'active'
              AND phase = 'question_open'
              AND revision = $14
              AND $11 < live_expires_at
              AND question_opened_at IS NOT NULL
              AND $11 >= question_opened_at
              AND (question_closes_at IS NULL OR $11 <= question_closes_at)
              AND current_block_index >= 0
              AND content_snapshot -> 'blocks' -> current_block_index ->> 'kind' = 'question'
              AND (content_snapshot -> 'blocks' -> current_block_index ->> 'id')::uuid = $5
              AND (content_snapshot -> 'blocks' -> current_block_index -> 'question' ->> 'id')::uuid
                = $6
         )
         INSERT INTO presentation_live_responses
          (id, workspace_id, session_id, participant_id, block_id, question_id,
           response, correct, score, response_ms, submitted_at, idempotency_key, request_hash)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
           FROM eligible_session
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [
          input.id,
          input.workspaceId,
          input.sessionId,
          input.participantId,
          input.blockId,
          input.questionId,
          JSON.stringify(input.response),
          input.correct,
          input.score,
          input.responseMs,
          input.submittedAt,
          input.idempotencyKey ?? null,
          input.requestHash ?? null,
          expectedSessionRevision,
        ],
      );
      if (inserted.rows[0]) {
        return { status: "accepted", response: mapResponse(inserted.rows[0]) };
      }

      // An insert may have waited for another key at the block uniqueness fence. Re-resolve the
      // exact receipt before interpreting a concurrent host transition as stale state.
      const concurrentPrior = await findIdempotentResponse();
      if (concurrentPrior) {
        return concurrentPrior.requestHash &&
          input.requestHash &&
          concurrentPrior.requestHash !== input.requestHash
          ? { status: "idempotency_conflict", response: concurrentPrior }
          : { status: "duplicate", response: concurrentPrior };
      }
      const current = await client.query(
        `SELECT * FROM presentation_live_sessions
          WHERE workspace_id = $1 AND id = $2`,
        [input.workspaceId, input.sessionId],
      );
      if (
        !current.rows[0] ||
        !responseWindowOpen(mapSession(current.rows[0]), input, expectedSessionRevision)
      ) {
        return { status: "phase_closed" };
      }
      const existing = await client.query(
        `SELECT * FROM presentation_live_responses
          WHERE session_id = $1 AND participant_id = $2 AND block_id = $3`,
        [input.sessionId, input.participantId, input.blockId],
      );
      if (!existing.rows[0]) return { status: "phase_closed" };
      return input.idempotencyKey
        ? { status: "already_responded", response: mapResponse(existing.rows[0]) }
        : { status: "duplicate", response: mapResponse(existing.rows[0]) };
    });

    if (write.status !== "accepted" && write.status !== "duplicate") return write;
    // Commit the durable receipt and release its phase fence before calculating standings and
    // participant projection. A lost acknowledgement remains recoverable by idempotency key.
    const acknowledgement = await this.transaction(input.workspaceId, (client) =>
      this.responseAcknowledgementState(
        client,
        input.workspaceId,
        input.sessionId,
        input.participantId,
      ),
    );
    return { ...write, acknowledgement };
  }

  async listResponses(sessionId: string) {
    return this.transaction(null, async (client) => {
      const result = await client.query(
        "SELECT * FROM presentation_live_responses WHERE session_id = $1 ORDER BY submitted_at",
        [sessionId],
      );
      return result.rows.map(mapResponse);
    });
  }

  async findResponseByIdempotencyKey(
    sessionId: string,
    participantId: string,
    idempotencyKey: string,
  ) {
    return this.transaction(null, async (client) => {
      await client.query(
        `SELECT pg_advisory_xact_lock(
           hashtextextended($1::text || ':' || $2::text || ':' || $3::text, 0)
         )`,
        [sessionId, participantId, idempotencyKey],
      );
      const result = await client.query(
        `SELECT * FROM presentation_live_responses
         WHERE session_id = $1 AND participant_id = $2 AND idempotency_key = $3`,
        [sessionId, participantId, idempotencyKey],
      );
      return result.rows[0] ? mapResponse(result.rows[0]) : null;
    });
  }

  async getParticipantSnapshotProjection(
    sessionId: string,
    participantId: string,
    currentBlockId: string | null,
    includeStanding: boolean,
  ): Promise<PresentationParticipantSnapshotProjection | null> {
    return this.transaction(null, async (client) => {
      const result = includeStanding
        ? await client.query(
            `WITH participant_scores AS (
               SELECT participant.id, participant.joined_at, participant.nickname,
                      COALESCE(SUM(response.score), 0)::bigint AS score
               FROM presentation_live_participants participant
               LEFT JOIN presentation_live_responses response
                 ON response.session_id = participant.session_id
                AND response.participant_id = participant.id
               WHERE participant.session_id = $1
               GROUP BY participant.id, participant.joined_at, participant.nickname
             ), ranked AS (
               SELECT id, score,
                      ROW_NUMBER() OVER (
                        ORDER BY score DESC, joined_at ASC, nickname ASC, id ASC
                      )::integer AS rank,
                      COUNT(*) OVER ()::integer AS participant_count
               FROM participant_scores
             )
             SELECT ranked.participant_count, ranked.score, ranked.rank,
                    (SELECT row_to_json(current_response)
                     FROM presentation_live_responses current_response
                     WHERE current_response.session_id = $1
                       AND current_response.participant_id = $2
                       AND current_response.block_id = $3
                     LIMIT 1) AS current_response
             FROM ranked
             WHERE ranked.id = $2`,
            [sessionId, participantId, currentBlockId],
          )
        : await client.query(
            `WITH roster AS (
               SELECT id, COUNT(*) OVER ()::integer AS participant_count
               FROM presentation_live_participants
               WHERE session_id = $1
             )
             SELECT roster.participant_count,
                    (SELECT row_to_json(current_response)
                     FROM presentation_live_responses current_response
                     WHERE current_response.session_id = $1
                       AND current_response.participant_id = $2
                       AND current_response.block_id = $3
                     LIMIT 1) AS current_response
             FROM roster
             WHERE roster.id = $2`,
            [sessionId, participantId, currentBlockId],
          );
      const row = result.rows[0];
      if (!row) return null;
      return {
        participantCount: Number(row.participant_count),
        standing: includeStanding ? { rank: Number(row.rank), score: Number(row.score) } : null,
        currentResponse: row.current_response ? mapResponse(row.current_response) : null,
      };
    });
  }

  async listTimeline(sessionId: string) {
    return this.transaction(null, async (client) => {
      const result = await client.query(
        "SELECT * FROM presentation_session_timeline WHERE session_id = $1 ORDER BY sequence",
        [sessionId],
      );
      return result.rows.map(mapTimeline);
    });
  }

  async getReport(workspaceId: string, sessionId: string) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        `SELECT report.*, session.retention_expires_at
         FROM presentation_session_reports AS report
         JOIN presentation_live_sessions AS session
           ON session.workspace_id = report.workspace_id AND session.id = report.session_id
         WHERE report.workspace_id = $1 AND report.session_id = $2`,
        [workspaceId, sessionId],
      );
      return result.rows[0] ? mapReport(result.rows[0]) : null;
    });
  }

  async claimReportJob(now: Date, leaseUntil: Date): Promise<PresentationSessionReportJob | null> {
    return this.transaction(null, async (client) => {
      const leaseToken = randomUUID();
      const selected = await client.query(
        `SELECT report.id, report.workspace_id, report.session_id, report.attempts,
                session.retention_expires_at
         FROM presentation_session_reports AS report
         JOIN presentation_live_sessions AS session
           ON session.workspace_id = report.workspace_id AND session.id = report.session_id
         WHERE report.status = 'pending' AND report.available_at <= $1
         ORDER BY report.available_at, report.created_at, report.id
         FOR UPDATE OF report SKIP LOCKED
         LIMIT 1`,
        [now],
      );
      const row = selected.rows[0];
      if (!row) return null;
      const updated = await client.query(
        `UPDATE presentation_session_reports
         SET attempts = attempts + 1, available_at = $2, lease_token = $3, updated_at = now()
         WHERE id = $1 AND status = 'pending'
         RETURNING attempts`,
        [row.id, leaseUntil, leaseToken],
      );
      if (updated.rowCount !== 1) return null;
      return {
        reportId: String(row.id),
        workspaceId: String(row.workspace_id),
        sessionId: String(row.session_id),
        attempts: Number(updated.rows[0]!.attempts),
        leaseToken,
        expiresAt:
          row.retention_expires_at instanceof Date
            ? row.retention_expires_at
            : new Date(String(row.retention_expires_at)),
      };
    });
  }

  async completeReportJob(
    job: PresentationSessionReportJob,
    report: PresentationSessionReportCompletion,
  ) {
    if (job.reportId !== report.reportId || job.sessionId !== report.sessionId) {
      throw new Error("Completed Presentation report does not match the claimed job");
    }
    if (!Number.isInteger(report.schemaVersion) || report.schemaVersion < 1) {
      throw new Error("Presentation report schema version must be a positive integer");
    }
    return this.transaction(job.workspaceId, async (client) => {
      const result = await client.query(
        `UPDATE presentation_session_reports
         SET status = 'ready', schema_version = $4, payload = $5, generated_at = $6,
             lease_token = NULL, last_error = NULL, updated_at = now()
         WHERE id = $1 AND workspace_id = $2 AND session_id = $3 AND status = 'pending'
           AND lease_token = $7`,
        [
          job.reportId,
          job.workspaceId,
          job.sessionId,
          report.schemaVersion,
          JSON.stringify(report.payload),
          report.generatedAt,
          job.leaseToken,
        ],
      );
      if (result.rowCount !== 1) {
        throw new Error("The claimed Presentation report job is no longer pending");
      }
    });
  }

  async retryReportJob(
    job: PresentationSessionReportJob,
    error: string,
    availableAt: Date,
    failed: boolean,
  ) {
    return this.transaction(job.workspaceId, async (client) => {
      await client.query(
        `UPDATE presentation_session_reports
         SET status = $4, last_error = $5, available_at = $6, lease_token = NULL,
             updated_at = now()
         WHERE id = $1 AND workspace_id = $2 AND session_id = $3 AND status = 'pending'
           AND lease_token = $7`,
        [
          job.reportId,
          job.workspaceId,
          job.sessionId,
          failed ? "failed" : "pending",
          error.slice(0, 2_000),
          availableAt,
          job.leaseToken,
        ],
      );
    });
  }

  async createCredential(input: PresentationSessionCredentialRecord) {
    return this.transaction(input.workspaceId, (client) => this.insertCredential(client, input));
  }

  async rotateCredential(input: PresentationSessionCredentialRecord) {
    return this.transaction(input.workspaceId, async (client) => {
      // Serialize by the stable parent row rather than the current credential set. Locking only
      // active credentials leaves a gap when none exist, and concurrent UPDATE snapshots cannot
      // see credentials inserted by a rotation that commits while they wait.
      await client.query(
        `/* rotate_presentation_session_credential */
         SELECT id FROM presentation_live_sessions
         WHERE workspace_id = $1 AND id = $2
         FOR UPDATE`,
        [input.workspaceId, input.sessionId],
      );
      await client.query(
        `UPDATE presentation_session_credentials
         SET revoked_at = GREATEST(created_at, $4::timestamptz)
         WHERE workspace_id = $1 AND session_id = $2 AND role = $3 AND revoked_at IS NULL`,
        [input.workspaceId, input.sessionId, input.role, input.createdAt],
      );
      const result = await client.query(
        `INSERT INTO presentation_session_credentials
          (id, workspace_id, session_id, role, token_hash, created_at, expires_at, revoked_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          input.id,
          input.workspaceId,
          input.sessionId,
          input.role,
          input.tokenHash,
          input.createdAt,
          input.expiresAt,
          input.revokedAt,
        ],
      );
      return mapCredential(result.rows[0]!);
    });
  }

  async findValidCredential(
    sessionId: string,
    tokenHash: string,
    role?: PresentationSessionCredentialRole,
    now = new Date(),
  ) {
    return this.transaction(null, async (client) => {
      const result = await client.query(
        `SELECT * FROM presentation_session_credentials
         WHERE session_id = $1 AND token_hash = $2
           AND ($3::text IS NULL OR role = $3)
           AND revoked_at IS NULL AND expires_at > $4`,
        [sessionId, tokenHash, role ?? null, now],
      );
      return result.rows[0] ? mapCredential(result.rows[0]) : null;
    });
  }

  async revokeCredential(
    workspaceId: string,
    sessionId: string,
    credentialId: string,
    revokedAt = new Date(),
    role?: PresentationSessionCredentialRole,
  ) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        `UPDATE presentation_session_credentials
         SET revoked_at = COALESCE(revoked_at, $4)
         WHERE workspace_id = $1 AND session_id = $2 AND id = $3
           AND ($5::text IS NULL OR role = $5)
         RETURNING *`,
        [workspaceId, sessionId, credentialId, revokedAt, role ?? null],
      );
      return result.rows[0] ? mapCredential(result.rows[0]) : null;
    });
  }
}

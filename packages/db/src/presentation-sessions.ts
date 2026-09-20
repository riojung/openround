import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import {
  MemoryRepository,
  type MemoryRepositoryLifecycleContext,
  type MemoryRepositoryLifecycleExtension,
} from "./memory.js";
import { PostgresRepository } from "./postgres.js";
import type { Repository } from "./types.js";
import {
  PresentationSessionConflictError,
  type PresentationSessionParticipantRecord,
  type PresentationParticipantJoin,
  type PresentationSessionRecord,
  type PresentationSessionRepository,
  type PresentationResponseAcceptance,
  type PresentationSessionResponseRecord,
  type PresentationSessionTimelineRecord,
} from "./presentation-session-types.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function responseWindowOpen(
  session: PresentationSessionRecord,
  response: PresentationSessionResponseRecord,
  expectedSessionRevision: number,
) {
  if (
    session.status !== "active" ||
    session.phase !== "question_open" ||
    session.revision !== expectedSessionRevision ||
    response.submittedAt >= session.liveExpiresAt
  ) {
    return false;
  }
  const block = session.content.blocks[session.currentBlockIndex];
  if (block?.kind !== "question" || block.id !== response.blockId) return false;
  const deadline = session.updatedAt.getTime() + block.question.timeLimitSeconds * 1_000;
  return response.submittedAt.getTime() <= deadline;
}

function mapSession(row: QueryResultRow): PresentationSessionRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    presentationId: String(row.presentation_id),
    presentationVersionId: String(row.presentation_version_id),
    title: String(row.title),
    content: row.content_snapshot,
    code: String(row.join_code),
    status: row.status,
    phase: row.phase,
    currentBlockIndex: Number(row.current_block_index),
    revision: Number(row.revision),
    createdBy: String(row.created_by),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at)),
    finishedAt:
      row.finished_at == null
        ? null
        : row.finished_at instanceof Date
          ? row.finished_at
          : new Date(String(row.finished_at)),
    liveExpiresAt:
      row.live_expires_at instanceof Date
        ? row.live_expires_at
        : new Date(String(row.live_expires_at)),
    retentionExpiresAt:
      row.retention_expires_at instanceof Date
        ? row.retention_expires_at
        : new Date(String(row.retention_expires_at)),
  };
}

function mapParticipant(row: QueryResultRow): PresentationSessionParticipantRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    sessionId: String(row.session_id),
    nickname: String(row.nickname),
    tokenHash: String(row.token_hash),
    joinedAt: row.joined_at instanceof Date ? row.joined_at : new Date(String(row.joined_at)),
    lastSeenAt:
      row.last_seen_at instanceof Date ? row.last_seen_at : new Date(String(row.last_seen_at)),
  };
}

function mapResponse(row: QueryResultRow): PresentationSessionResponseRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    sessionId: String(row.session_id),
    participantId: String(row.participant_id),
    blockId: String(row.block_id),
    questionId: String(row.question_id),
    response: row.response,
    correct: row.correct == null ? null : Boolean(row.correct),
    score: Number(row.score ?? 0),
    responseMs: Number(row.response_ms ?? 0),
    submittedAt:
      row.submitted_at instanceof Date ? row.submitted_at : new Date(String(row.submitted_at)),
  };
}

function mapTimeline(row: QueryResultRow): PresentationSessionTimelineRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    sessionId: String(row.session_id),
    sequence: Number(row.sequence),
    type: row.event_type,
    blockIndex: row.block_index == null ? null : Number(row.block_index),
    blockId: row.block_id == null ? null : String(row.block_id),
    occurredAt:
      row.occurred_at instanceof Date ? row.occurred_at : new Date(String(row.occurred_at)),
  };
}

export class MemoryPresentationSessionRepository
  implements PresentationSessionRepository, MemoryRepositoryLifecycleExtension
{
  private readonly sessions = new Map<string, PresentationSessionRecord>();
  private readonly participants = new Map<string, PresentationSessionParticipantRecord>();
  private readonly responses = new Map<string, PresentationSessionResponseRecord>();
  private readonly timeline = new Map<string, PresentationSessionTimelineRecord>();

  exportAccount({ ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    const sessions = [...this.sessions.values()].filter((session) =>
      ownedWorkspaceIds.has(session.workspaceId),
    );
    const sessionIds = new Set(sessions.map((session) => session.id));
    return {
      presentationSessions: sessions.map(clone),
      presentationSessionParticipants: [...this.participants.values()]
        .filter((participant) => sessionIds.has(participant.sessionId))
        .map(({ tokenHash: _tokenHash, ...participant }) => clone(participant)),
      presentationSessionResponses: [...this.responses.values()]
        .filter((response) => sessionIds.has(response.sessionId))
        .map(clone),
      presentationSessionTimeline: [...this.timeline.values()]
        .filter((event) => sessionIds.has(event.sessionId))
        .map(clone),
    };
  }

  deleteAccount({ ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    for (const [id, session] of this.sessions) {
      if (ownedWorkspaceIds.has(session.workspaceId)) this.deleteSessionTree(id);
    }
  }

  purgeExpired(now: Date) {
    const purged: string[] = [];
    for (const [id, session] of this.sessions) {
      if (session.retentionExpiresAt <= now) {
        this.deleteSessionTree(id);
        purged.push(id);
      }
    }
    return purged;
  }

  private deleteSessionTree(sessionId: string) {
    this.sessions.delete(sessionId);
    const participantIds = new Set<string>();
    for (const [id, participant] of this.participants) {
      if (participant.sessionId === sessionId) {
        participantIds.add(participant.id);
        this.participants.delete(id);
      }
    }
    for (const [id, response] of this.responses) {
      if (response.sessionId === sessionId || participantIds.has(response.participantId)) {
        this.responses.delete(id);
      }
    }
    for (const [id, event] of this.timeline) {
      if (event.sessionId === sessionId) this.timeline.delete(id);
    }
  }

  async listSessions(workspaceId: string) {
    return [...this.sessions.values()]
      .filter((session) => session.workspaceId === workspaceId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map(clone);
  }

  async createSession(input: PresentationSessionRecord) {
    if ([...this.sessions.values()].some((session) => session.code === input.code)) {
      throw new Error("Presentation join code already exists");
    }
    this.sessions.set(input.id, clone(input));
    return clone(input);
  }

  async getSessionForWorkspace(workspaceId: string, sessionId: string) {
    const session = this.sessions.get(sessionId);
    return session?.workspaceId === workspaceId ? clone(session) : null;
  }

  async getSessionById(sessionId: string) {
    const session = this.sessions.get(sessionId);
    return session ? clone(session) : null;
  }

  async getSessionByCode(code: string) {
    const session = [...this.sessions.values()].find((candidate) => candidate.code === code);
    return session ? clone(session) : null;
  }

  async transitionSession(
    input: Parameters<PresentationSessionRepository["transitionSession"]>[0],
  ) {
    const session = this.sessions.get(input.sessionId);
    if (!session || session.workspaceId !== input.workspaceId) return null;
    if (session.revision !== input.expectedRevision) {
      throw new PresentationSessionConflictError(input.expectedRevision, session.revision);
    }
    const now = new Date();
    const becomingFinished = session.status !== "finished" && input.status === "finished";
    const updated: PresentationSessionRecord = {
      ...session,
      phase: input.phase,
      currentBlockIndex: input.currentBlockIndex,
      status: input.status,
      revision: session.revision + 1,
      updatedAt: now,
      finishedAt: becomingFinished ? now : session.finishedAt,
      retentionExpiresAt:
        becomingFinished && input.retentionExpiresAt
          ? input.retentionExpiresAt
          : session.retentionExpiresAt,
    };
    this.sessions.set(updated.id, updated);
    const sequence =
      [...this.timeline.values()].filter((event) => event.sessionId === input.sessionId).length + 1;
    const event: PresentationSessionTimelineRecord = {
      ...input.event,
      id: randomUUID(),
      workspaceId: session.workspaceId,
      sessionId: session.id,
      sequence,
      occurredAt: now,
    };
    this.timeline.set(event.id, event);
    return clone(updated);
  }

  async addParticipant(input: PresentationSessionParticipantRecord) {
    this.participants.set(input.id, clone(input));
    return clone(input);
  }

  async joinParticipantWithinLimit(
    input: PresentationSessionParticipantRecord,
    participantLimit: number,
  ): Promise<PresentationParticipantJoin> {
    const session = this.sessions.get(input.sessionId);
    if (
      !session ||
      session.workspaceId !== input.workspaceId ||
      session.status !== "active" ||
      input.joinedAt >= session.liveExpiresAt
    ) {
      return { status: "closed" };
    }
    const participantCount = [...this.participants.values()].filter(
      (participant) => participant.sessionId === input.sessionId,
    ).length;
    if (participantCount >= participantLimit) return { status: "full" };
    this.participants.set(input.id, clone(input));
    return { status: "accepted", participant: clone(input) };
  }

  async findParticipant(sessionId: string, tokenHash: string) {
    const participant = [...this.participants.values()].find(
      (candidate) => candidate.sessionId === sessionId && candidate.tokenHash === tokenHash,
    );
    if (!participant) return null;
    participant.lastSeenAt = new Date();
    return clone(participant);
  }

  async listParticipants(sessionId: string) {
    return [...this.participants.values()]
      .filter((participant) => participant.sessionId === sessionId)
      .sort((left, right) => left.joinedAt.getTime() - right.joinedAt.getTime())
      .map(clone);
  }

  async saveResponse(input: PresentationSessionResponseRecord) {
    const key = `${input.sessionId}:${input.participantId}:${input.blockId}`;
    const existing = this.responses.get(key);
    if (existing) return clone(existing);
    const stored = clone(input);
    this.responses.set(key, stored);
    return clone(stored);
  }

  async acceptResponse(
    input: PresentationSessionResponseRecord,
    expectedSessionRevision: number,
  ): Promise<PresentationResponseAcceptance> {
    const session = this.sessions.get(input.sessionId);
    if (
      !session ||
      session.workspaceId !== input.workspaceId ||
      !responseWindowOpen(session, input, expectedSessionRevision)
    ) {
      return { status: "phase_closed" };
    }
    const key = `${input.sessionId}:${input.participantId}:${input.blockId}`;
    const existing = this.responses.get(key);
    if (existing) return { status: "duplicate", response: clone(existing) };
    const stored = clone(input);
    this.responses.set(key, stored);
    return { status: "accepted", response: clone(stored) };
  }

  async listResponses(sessionId: string) {
    return [...this.responses.values()]
      .filter((response) => response.sessionId === sessionId)
      .sort((left, right) => left.submittedAt.getTime() - right.submittedAt.getTime())
      .map(clone);
  }

  async listTimeline(sessionId: string) {
    return [...this.timeline.values()]
      .filter((event) => event.sessionId === sessionId)
      .sort((left, right) => left.sequence - right.sequence)
      .map(clone);
  }
}

export class PostgresPresentationSessionRepository implements PresentationSessionRepository {
  constructor(private readonly repository: PostgresRepository) {}

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

  async listSessions(workspaceId: string) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        "SELECT * FROM presentation_live_sessions WHERE workspace_id = $1 ORDER BY created_at DESC",
        [workspaceId],
      );
      return result.rows.map(mapSession);
    });
  }

  async createSession(input: PresentationSessionRecord) {
    return this.transaction(input.workspaceId, async (client) => {
      const result = await client.query(
        `INSERT INTO presentation_live_sessions
          (id, workspace_id, presentation_id, presentation_version_id, title, content_snapshot,
           join_code, status, phase, current_block_index, revision, created_by,
           created_at, updated_at, finished_at, live_expires_at, retention_expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
        [
          input.id,
          input.workspaceId,
          input.presentationId,
          input.presentationVersionId,
          input.title,
          JSON.stringify(input.content),
          input.code,
          input.status,
          input.phase,
          input.currentBlockIndex,
          input.revision,
          input.createdBy,
          input.createdAt,
          input.updatedAt,
          input.finishedAt,
          input.liveExpiresAt,
          input.retentionExpiresAt,
        ],
      );
      return mapSession(result.rows[0]!);
    });
  }

  async getSessionForWorkspace(workspaceId: string, sessionId: string) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        "SELECT * FROM presentation_live_sessions WHERE workspace_id = $1 AND id = $2",
        [workspaceId, sessionId],
      );
      return result.rows[0] ? mapSession(result.rows[0]) : null;
    });
  }

  async getSessionById(sessionId: string) {
    return this.transaction(null, async (client) => {
      const result = await client.query("SELECT * FROM presentation_live_sessions WHERE id = $1", [
        sessionId,
      ]);
      return result.rows[0] ? mapSession(result.rows[0]) : null;
    });
  }

  async getSessionByCode(code: string) {
    return this.transaction(null, async (client) => {
      const result = await client.query(
        "SELECT * FROM presentation_live_sessions WHERE join_code = $1",
        [code],
      );
      return result.rows[0] ? mapSession(result.rows[0]) : null;
    });
  }

  async transitionSession(
    input: Parameters<PresentationSessionRepository["transitionSession"]>[0],
  ) {
    return this.transaction(input.workspaceId, async (client) => {
      const locked = await client.query(
        "SELECT * FROM presentation_live_sessions WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
        [input.workspaceId, input.sessionId],
      );
      if (!locked.rows[0]) return null;
      const currentRevision = Number(locked.rows[0].revision);
      if (currentRevision !== input.expectedRevision) {
        throw new PresentationSessionConflictError(input.expectedRevision, currentRevision);
      }
      const updated = await client.query(
        `UPDATE presentation_live_sessions
         SET phase = $3, current_block_index = $4, status = $5, revision = revision + 1,
             updated_at = now(), finished_at = CASE
               WHEN status <> 'finished' AND $5 = 'finished' THEN now()
               ELSE finished_at
             END,
             retention_expires_at = CASE
               WHEN status <> 'finished' AND $5 = 'finished' AND $6::timestamptz IS NOT NULL THEN $6
               ELSE retention_expires_at
             END
         WHERE workspace_id = $1 AND id = $2 RETURNING *`,
        [
          input.workspaceId,
          input.sessionId,
          input.phase,
          input.currentBlockIndex,
          input.status,
          input.retentionExpiresAt ?? null,
        ],
      );
      const sequence = await client.query<{ sequence: number }>(
        `SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence
         FROM presentation_session_timeline WHERE session_id = $1`,
        [input.sessionId],
      );
      await client.query(
        `INSERT INTO presentation_session_timeline
          (id, workspace_id, session_id, sequence, event_type, block_index, block_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          randomUUID(),
          input.workspaceId,
          input.sessionId,
          Number(sequence.rows[0]!.sequence),
          input.event.type,
          input.event.blockIndex,
          input.event.blockId,
        ],
      );
      return mapSession(updated.rows[0]!);
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
           response, correct, score, response_ms, submitted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
    return this.transaction(input.workspaceId, async (client) => {
      const locked = await client.query(
        `SELECT * FROM presentation_live_sessions
         WHERE workspace_id = $1 AND id = $2
         FOR UPDATE`,
        [input.workspaceId, input.sessionId],
      );
      if (!locked.rows[0]) return { status: "phase_closed" };
      const session = mapSession(locked.rows[0]);
      if (!responseWindowOpen(session, input, expectedSessionRevision)) {
        return { status: "phase_closed" };
      }
      const result = await client.query(
        `INSERT INTO presentation_live_responses
          (id, workspace_id, session_id, participant_id, block_id, question_id,
           response, correct, score, response_ms, submitted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
        ],
      );
      if (result.rows[0]) return { status: "accepted", response: mapResponse(result.rows[0]) };
      const existing = await client.query(
        `SELECT * FROM presentation_live_responses
         WHERE session_id = $1 AND participant_id = $2 AND block_id = $3`,
        [input.sessionId, input.participantId, input.blockId],
      );
      return { status: "duplicate", response: mapResponse(existing.rows[0]!) };
    });
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

  async listTimeline(sessionId: string) {
    return this.transaction(null, async (client) => {
      const result = await client.query(
        "SELECT * FROM presentation_session_timeline WHERE session_id = $1 ORDER BY sequence",
        [sessionId],
      );
      return result.rows.map(mapTimeline);
    });
  }
}

export function createPresentationSessionRepository(
  repository: Repository,
): PresentationSessionRepository {
  if (repository instanceof PostgresRepository) {
    return new PostgresPresentationSessionRepository(repository);
  }
  if (repository instanceof MemoryRepository) {
    return repository.getOrCreateLifecycleExtension(
      "presentation-sessions",
      () => new MemoryPresentationSessionRepository(),
    );
  }
  return new MemoryPresentationSessionRepository();
}

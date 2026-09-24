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
  type PresentationSessionCommandInput,
  type PresentationSessionCommandReceiptRecord,
  type PresentationSessionCreateInput,
  type PresentationSessionCredentialRecord,
  type PresentationSessionCredentialRole,
  type PresentationSessionParticipantRecord,
  type PresentationParticipantSnapshotProjection,
  type PresentationParticipantJoin,
  type PresentationSessionRecord,
  type PresentationSessionRepository,
  type PresentationResponseAcceptance,
  type PresentationSessionResponseRecord,
  type PresentationSessionTimelineRecord,
  type PresentationSessionTransitionInput,
  type PresentationTransitionAcceptance,
} from "./presentation-session-types.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizeSession(input: PresentationSessionCreateInput): PresentationSessionRecord {
  const settings = input.settings ?? { timeMode: "timed" as const };
  let questionOpenedAt = input.questionOpenedAt ?? null;
  let questionClosesAt = input.questionClosesAt ?? null;
  if (input.phase === "question_open" && questionOpenedAt === null) {
    questionOpenedAt = input.updatedAt;
  }
  if (input.phase === "question_open" && settings.timeMode === "flex") {
    questionClosesAt = null;
  } else if (input.phase === "question_open" && questionClosesAt === null) {
    const block = input.content.blocks[input.currentBlockIndex];
    if (block?.kind === "question" && questionOpenedAt) {
      questionClosesAt = new Date(
        questionOpenedAt.getTime() + block.question.timeLimitSeconds * 1_000,
      );
    }
  }
  return {
    ...input,
    settings,
    trustMode: input.trustMode ?? "learning",
    eventSeq: input.eventSeq ?? 0,
    questionOpenedAt,
    questionClosesAt,
  };
}

function transitionWindow(
  session: PresentationSessionRecord,
  input: PresentationSessionTransitionInput,
  occurredAt: Date,
) {
  if (input.phase !== "question_open") {
    return { questionOpenedAt: null, questionClosesAt: null };
  }
  const questionOpenedAt = input.questionOpenedAt ?? occurredAt;
  if (session.settings.timeMode === "flex") {
    return { questionOpenedAt, questionClosesAt: null };
  }
  if (input.questionClosesAt instanceof Date) {
    return { questionOpenedAt, questionClosesAt: input.questionClosesAt };
  }
  const block = session.content.blocks[input.currentBlockIndex];
  return {
    questionOpenedAt,
    questionClosesAt:
      block?.kind === "question"
        ? new Date(questionOpenedAt.getTime() + block.question.timeLimitSeconds * 1_000)
        : null,
  };
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
  if (
    block?.kind !== "question" ||
    block.id !== response.blockId ||
    block.question.id !== response.questionId ||
    session.questionOpenedAt === null ||
    response.submittedAt < session.questionOpenedAt
  ) {
    return false;
  }
  return (
    session.questionClosesAt === null ||
    response.submittedAt.getTime() <= session.questionClosesAt.getTime()
  );
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
    settings: row.settings ?? { timeMode: "timed" },
    trustMode: row.trust_mode ?? "learning",
    eventSeq: Number(row.event_seq ?? 0),
    questionOpenedAt:
      row.question_opened_at == null
        ? null
        : row.question_opened_at instanceof Date
          ? row.question_opened_at
          : new Date(String(row.question_opened_at)),
    questionClosesAt:
      row.question_closes_at == null
        ? null
        : row.question_closes_at instanceof Date
          ? row.question_closes_at
          : new Date(String(row.question_closes_at)),
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
    idempotencyKey: row.idempotency_key == null ? null : String(row.idempotency_key),
    requestHash: row.request_hash == null ? null : String(row.request_hash),
  };
}

function mapCredential(row: QueryResultRow): PresentationSessionCredentialRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    sessionId: String(row.session_id),
    role: row.role,
    tokenHash: String(row.token_hash),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
    expiresAt: row.expires_at instanceof Date ? row.expires_at : new Date(String(row.expires_at)),
    revokedAt:
      row.revoked_at == null
        ? null
        : row.revoked_at instanceof Date
          ? row.revoked_at
          : new Date(String(row.revoked_at)),
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
  private readonly commandReceipts = new Map<string, PresentationSessionCommandReceiptRecord>();
  private readonly credentials = new Map<string, PresentationSessionCredentialRecord>();

  constructor(
    private readonly liveRooms: Pick<Repository, "claimLiveRoomCode" | "releaseLiveRoomCode">,
  ) {}

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
      presentationSessionCommandReceipts: [...this.commandReceipts.values()]
        .filter((receipt) => sessionIds.has(receipt.sessionId))
        .map(clone),
      presentationSessionCredentials: [...this.credentials.values()]
        .filter((credential) => sessionIds.has(credential.sessionId))
        .map(({ tokenHash: _tokenHash, ...credential }) => clone(credential)),
    };
  }

  async deleteAccount({ ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    for (const [id, session] of this.sessions) {
      if (ownedWorkspaceIds.has(session.workspaceId)) await this.deleteSessionTree(id);
    }
  }

  async purgeExpired(now: Date) {
    const purged: string[] = [];
    for (const [id, session] of this.sessions) {
      if (session.retentionExpiresAt <= now) {
        await this.deleteSessionTree(id);
        purged.push(id);
      }
    }
    return purged;
  }

  private async deleteSessionTree(sessionId: string) {
    await this.liveRooms.releaseLiveRoomCode("presentation", sessionId);
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
    for (const [key, receipt] of this.commandReceipts) {
      if (receipt.sessionId === sessionId) this.commandReceipts.delete(key);
    }
    for (const [id, credential] of this.credentials) {
      if (credential.sessionId === sessionId) this.credentials.delete(id);
    }
  }

  async listSessions(workspaceId: string, now = new Date()) {
    return [...this.sessions.values()]
      .filter(
        (session) =>
          session.workspaceId === workspaceId &&
          (session.status !== "active" || session.liveExpiresAt > now),
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map(clone);
  }

  async createSession(input: PresentationSessionCreateInput) {
    const normalized = normalizeSession(input);
    await this.liveRooms.claimLiveRoomCode({
      code: normalized.code,
      workspaceId: normalized.workspaceId,
      artifactType: "presentation",
      artifactId: normalized.id,
      expiresAt: normalized.liveExpiresAt,
      createdAt: normalized.createdAt,
    });
    try {
      this.sessions.set(input.id, clone(normalized));
      if (normalized.status !== "active" || normalized.liveExpiresAt <= new Date()) {
        await this.liveRooms.releaseLiveRoomCode(
          "presentation",
          normalized.id,
          normalized.finishedAt ?? normalized.updatedAt,
        );
      }
      return clone(normalized);
    } catch (error) {
      await this.liveRooms.releaseLiveRoomCode("presentation", normalized.id);
      throw error;
    }
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
    if (
      [...this.credentials.values()].some(({ tokenHash }) => tokenHash === credential.tokenHash)
    ) {
      throw new Error("Presentation session credential already exists");
    }
    await this.liveRooms.claimLiveRoomCode({
      code: normalized.code,
      workspaceId: normalized.workspaceId,
      artifactType: "presentation",
      artifactId: normalized.id,
      expiresAt: normalized.liveExpiresAt,
      createdAt: normalized.createdAt,
    });
    try {
      this.sessions.set(normalized.id, clone(normalized));
      this.credentials.set(credential.id, clone(credential));
      if (normalized.status !== "active" || normalized.liveExpiresAt <= new Date()) {
        await this.liveRooms.releaseLiveRoomCode(
          "presentation",
          normalized.id,
          normalized.finishedAt ?? normalized.updatedAt,
        );
      }
      return { session: clone(normalized), credential: clone(credential) };
    } catch (error) {
      this.sessions.delete(normalized.id);
      this.credentials.delete(credential.id);
      await this.liveRooms.releaseLiveRoomCode("presentation", normalized.id);
      throw error;
    }
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
    const now = new Date();
    const session = [...this.sessions.values()]
      .filter(
        (candidate) =>
          candidate.code === code && candidate.status === "active" && candidate.liveExpiresAt > now,
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
    return session ? clone(session) : null;
  }

  private async applyTransition(input: PresentationSessionTransitionInput, commandId?: string) {
    const session = this.sessions.get(input.sessionId);
    if (!session || session.workspaceId !== input.workspaceId) return null;
    if (session.revision !== input.expectedRevision) {
      throw new PresentationSessionConflictError(input.expectedRevision, session.revision);
    }
    const now = input.occurredAt ?? new Date();
    const window = transitionWindow(session, input, now);
    const becomingFinished = session.status !== "finished" && input.status === "finished";
    const updated: PresentationSessionRecord = {
      ...session,
      phase: input.phase,
      currentBlockIndex: input.currentBlockIndex,
      status: input.status,
      revision: session.revision + 1,
      eventSeq: session.eventSeq + 1,
      ...window,
      updatedAt: now,
      finishedAt: becomingFinished ? now : session.finishedAt,
      retentionExpiresAt:
        becomingFinished && input.retentionExpiresAt
          ? input.retentionExpiresAt
          : session.retentionExpiresAt,
    };
    this.sessions.set(updated.id, updated);
    if (updated.status !== "active") {
      await this.liveRooms.releaseLiveRoomCode("presentation", updated.id, now);
    }
    const event: PresentationSessionTimelineRecord = {
      ...input.event,
      id: randomUUID(),
      workspaceId: session.workspaceId,
      sessionId: session.id,
      sequence: updated.eventSeq,
      occurredAt: now,
    };
    this.timeline.set(event.id, event);
    if (commandId) {
      const receipt: PresentationSessionCommandReceiptRecord = {
        id: randomUUID(),
        workspaceId: session.workspaceId,
        sessionId: session.id,
        commandId,
        expectedRevision: input.expectedRevision,
        resultingRevision: updated.revision,
        eventType: input.event.type,
        receivedAt: now,
      };
      this.commandReceipts.set(`${session.id}:${commandId}`, receipt);
    }
    return clone(updated);
  }

  async transitionSession(input: PresentationSessionTransitionInput) {
    return this.applyTransition(input);
  }

  async transitionSessionCommand(
    input: PresentationSessionCommandInput,
  ): Promise<PresentationTransitionAcceptance> {
    const receipt = this.commandReceipts.get(`${input.sessionId}:${input.commandId}`);
    if (receipt?.workspaceId === input.workspaceId) {
      const session = this.sessions.get(input.sessionId);
      if (!session) return { status: "not_found" };
      return receipt.expectedRevision === input.expectedRevision
        ? { status: "duplicate", session: clone(session) }
        : { status: "idempotency_conflict", session: clone(session) };
    }
    const session = await this.applyTransition(input, input.commandId);
    return session ? { status: "accepted", session } : { status: "not_found" };
  }

  async addParticipant(input: PresentationSessionParticipantRecord) {
    this.participants.set(input.id, clone(input));
    const session = this.sessions.get(input.sessionId);
    if (session?.workspaceId === input.workspaceId) session.eventSeq += 1;
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
    // Sequence fences cover every durable aggregate mutation, not only host transitions. This
    // keeps equal-revision join snapshots from racing one another in reconnecting clients.
    session.eventSeq += 1;
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
    const session = this.sessions.get(input.sessionId);
    if (session?.workspaceId === input.workspaceId) session.eventSeq += 1;
    return clone(stored);
  }

  async acceptResponse(
    input: PresentationSessionResponseRecord,
    expectedSessionRevision: number,
  ): Promise<PresentationResponseAcceptance> {
    if (input.idempotencyKey) {
      const idempotent = [...this.responses.values()].find(
        (candidate) =>
          candidate.workspaceId === input.workspaceId &&
          candidate.sessionId === input.sessionId &&
          candidate.participantId === input.participantId &&
          candidate.idempotencyKey === input.idempotencyKey,
      );
      if (idempotent) {
        return idempotent.requestHash &&
          input.requestHash &&
          idempotent.requestHash !== input.requestHash
          ? { status: "idempotency_conflict", response: clone(idempotent) }
          : { status: "duplicate", response: clone(idempotent) };
      }
    }
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
    if (existing) {
      return {
        status: input.idempotencyKey ? "already_responded" : "duplicate",
        response: clone(existing),
      };
    }
    const stored = clone(input);
    this.responses.set(key, stored);
    // A response changes participant/answer aggregates while the host revision stays fixed.
    // Advance the independent sequence so delayed snapshots cannot roll those aggregates back.
    session.eventSeq += 1;
    return { status: "accepted", response: clone(stored) };
  }

  async listResponses(sessionId: string) {
    return [...this.responses.values()]
      .filter((response) => response.sessionId === sessionId)
      .sort((left, right) => left.submittedAt.getTime() - right.submittedAt.getTime())
      .map(clone);
  }

  async findResponseByIdempotencyKey(
    sessionId: string,
    participantId: string,
    idempotencyKey: string,
  ) {
    const response = [...this.responses.values()].find(
      (candidate) =>
        candidate.sessionId === sessionId &&
        candidate.participantId === participantId &&
        candidate.idempotencyKey === idempotencyKey,
    );
    return response ? clone(response) : null;
  }

  async getParticipantSnapshotProjection(
    sessionId: string,
    participantId: string,
    currentBlockId: string | null,
    includeStanding: boolean,
  ): Promise<PresentationParticipantSnapshotProjection | null> {
    const participants = [...this.participants.values()]
      .filter((participant) => participant.sessionId === sessionId)
      .sort(
        (left, right) =>
          left.joinedAt.getTime() - right.joinedAt.getTime() ||
          left.nickname.localeCompare(right.nickname),
      );
    if (!participants.some((participant) => participant.id === participantId)) return null;
    let standing: PresentationParticipantSnapshotProjection["standing"] = null;
    if (includeStanding) {
      const responses = [...this.responses.values()].filter(
        (response) => response.sessionId === sessionId,
      );
      const scores = new Map<string, number>();
      for (const response of responses) {
        scores.set(
          response.participantId,
          (scores.get(response.participantId) ?? 0) + response.score,
        );
      }
      const ranked = participants
        .map((participant) => ({
          ...participant,
          score: scores.get(participant.id) ?? 0,
        }))
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.joinedAt.getTime() - right.joinedAt.getTime() ||
            left.nickname.localeCompare(right.nickname),
        );
      const rank = ranked.findIndex((participant) => participant.id === participantId);
      standing = rank < 0 ? null : { rank: rank + 1, score: ranked[rank]!.score };
    }
    const currentResponse = currentBlockId
      ? this.responses.get(`${sessionId}:${participantId}:${currentBlockId}`)
      : undefined;
    return {
      participantCount: participants.length,
      standing,
      currentResponse: currentResponse ? clone(currentResponse) : null,
    };
  }

  async listTimeline(sessionId: string) {
    return [...this.timeline.values()]
      .filter((event) => event.sessionId === sessionId)
      .sort((left, right) => left.sequence - right.sequence)
      .map(clone);
  }

  async createCredential(input: PresentationSessionCredentialRecord) {
    if ([...this.credentials.values()].some(({ tokenHash }) => tokenHash === input.tokenHash)) {
      throw new Error("Presentation session credential already exists");
    }
    this.credentials.set(input.id, clone(input));
    return clone(input);
  }

  async rotateCredential(input: PresentationSessionCredentialRecord) {
    for (const credential of this.credentials.values()) {
      if (
        credential.workspaceId === input.workspaceId &&
        credential.sessionId === input.sessionId &&
        credential.role === input.role &&
        credential.revokedAt === null
      ) {
        credential.revokedAt = new Date(input.createdAt);
      }
    }
    return this.createCredential(input);
  }

  async findValidCredential(
    sessionId: string,
    tokenHash: string,
    role?: PresentationSessionCredentialRole,
    now = new Date(),
  ) {
    const credential = [...this.credentials.values()].find(
      (candidate) =>
        candidate.sessionId === sessionId &&
        candidate.tokenHash === tokenHash &&
        (role === undefined || candidate.role === role) &&
        candidate.revokedAt === null &&
        candidate.expiresAt > now,
    );
    return credential ? clone(credential) : null;
  }

  async revokeCredential(
    workspaceId: string,
    sessionId: string,
    credentialId: string,
    revokedAt = new Date(),
    role?: PresentationSessionCredentialRole,
  ) {
    const credential = this.credentials.get(credentialId);
    if (
      !credential ||
      credential.workspaceId !== workspaceId ||
      credential.sessionId !== sessionId ||
      (role !== undefined && credential.role !== role)
    ) {
      return null;
    }
    credential.revokedAt ??= revokedAt;
    return clone(credential);
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
        `SELECT * FROM presentation_live_sessions
         WHERE workspace_id = $1 AND (status <> 'active' OR live_expires_at > $2)
         ORDER BY created_at DESC`,
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
        `SELECT * FROM presentation_live_sessions
         WHERE join_code = $1 AND status = 'active' AND live_expires_at > now()
         ORDER BY created_at DESC LIMIT 1`,
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
          "SELECT * FROM presentation_live_sessions WHERE workspace_id = $1 AND id = $2",
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
        return {
          status:
            Number(prior.rows[0].expected_revision) === input.expectedRevision
              ? "duplicate"
              : "idempotency_conflict",
          session: mapSession(locked.rows[0]),
        };
      }
    }
    const session = mapSession(locked.rows[0]);
    if (session.revision !== input.expectedRevision) {
      throw new PresentationSessionConflictError(input.expectedRevision, session.revision);
    }
    const occurredAt = input.occurredAt ?? new Date();
    const window = transitionWindow(session, input, occurredAt);
    const updated = await client.query(
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
       WHERE workspace_id = $1 AND id = $2 RETURNING *`,
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
    const stored = mapSession(updated.rows[0]!);
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
    return this.transaction(input.workspaceId, async (client) => {
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
      const locked = await client.query(
        `SELECT * FROM presentation_live_sessions
         WHERE workspace_id = $1 AND id = $2
         FOR UPDATE`,
        [input.workspaceId, input.sessionId],
      );
      if (!locked.rows[0]) return { status: "phase_closed" };
      // A concurrent first attempt may have committed while this transaction waited for the
      // session lock. Resolve that receipt before inspecting a now-stale phase or revision.
      const concurrentPrior = await findIdempotentResponse();
      if (concurrentPrior) {
        return concurrentPrior.requestHash &&
          input.requestHash &&
          concurrentPrior.requestHash !== input.requestHash
          ? { status: "idempotency_conflict", response: concurrentPrior }
          : { status: "duplicate", response: concurrentPrior };
      }
      const session = mapSession(locked.rows[0]);
      if (!responseWindowOpen(session, input, expectedSessionRevision)) {
        return { status: "phase_closed" };
      }
      const alreadyResponded = await client.query(
        `SELECT * FROM presentation_live_responses
         WHERE session_id = $1 AND participant_id = $2 AND block_id = $3`,
        [input.sessionId, input.participantId, input.blockId],
      );
      if (alreadyResponded.rows[0]) {
        return {
          status: input.idempotencyKey ? "already_responded" : "duplicate",
          response: mapResponse(alreadyResponded.rows[0]),
        };
      }
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
      if (result.rows[0]) return { status: "accepted", response: mapResponse(result.rows[0]) };
      const existing = await client.query(
        `SELECT * FROM presentation_live_responses
         WHERE session_id = $1 AND participant_id = $2 AND block_id = $3`,
        [input.sessionId, input.participantId, input.blockId],
      );
      return {
        status: input.idempotencyKey ? "already_responded" : "duplicate",
        response: mapResponse(existing.rows[0]!),
      };
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

  async findResponseByIdempotencyKey(
    sessionId: string,
    participantId: string,
    idempotencyKey: string,
  ) {
    return this.transaction(null, async (client) => {
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

export function createPresentationSessionRepository(
  repository: Repository,
): PresentationSessionRepository {
  if (repository instanceof PostgresRepository) {
    return new PostgresPresentationSessionRepository(repository);
  }
  if (repository instanceof MemoryRepository) {
    return repository.getOrCreateLifecycleExtension(
      "presentation-sessions",
      () => new MemoryPresentationSessionRepository(repository),
    );
  }
  return new MemoryPresentationSessionRepository(repository);
}

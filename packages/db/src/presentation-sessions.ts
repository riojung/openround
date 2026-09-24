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
  comparePresentationLeaderboardEntries,
  PresentationSessionConflictError,
  type PresentationSessionCommandInput,
  type PresentationSessionCommandReceiptRecord,
  type PresentationSessionCreateInput,
  type PresentationSessionCredentialRecord,
  type PresentationSessionCredentialRole,
  type PresentationSessionParticipantRecord,
  type PresentationParticipantSnapshotProjection,
  type PresentationParticipantJoin,
  type PresentationResponseAcknowledgementState,
  type PresentationSessionReportCompletion,
  type PresentationSessionReportJob,
  type PresentationSessionReportRecord,
  type PresentationSessionRecord,
  type PresentationSessionRepository,
  type PresentationResponseAcceptance,
  type PresentationResponseContext,
  type PresentationSessionResponseRecord,
  type PresentationSessionTimelineRecord,
  type PresentationSessionTransitionInput,
  type PresentationTransitionAcceptance,
} from "./presentation-session-types.js";

// Revision and live child rows are monotonic for the lifetime of a Presentation session. Their
// sum is therefore a commit-visible, per-session fence: every host command, join, or accepted
// response changes it, while concurrent uncommitted rows cannot consume a value that later leaks
// into a snapshot. Do not expose the stored compatibility counter here; it may deliberately skip
// optimized response writes once a deployment has completed its old-binary overlap window.
const PRESENTATION_EFFECTIVE_EVENT_SEQ_SQL = `(
  session.revision
  + (SELECT count(*)
       FROM presentation_live_participants participant
      WHERE participant.session_id = session.id)
  + (SELECT count(*)
       FROM presentation_live_responses response
      WHERE response.session_id = session.id)
)`;

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

function mapReport(row: QueryResultRow): PresentationSessionReportRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    sessionId: String(row.session_id),
    status: row.status,
    schemaVersion: Number(row.schema_version),
    payload: row.payload ?? null,
    generatedAt:
      row.generated_at == null
        ? null
        : row.generated_at instanceof Date
          ? row.generated_at
          : new Date(String(row.generated_at)),
    expiresAt:
      row.retention_expires_at instanceof Date
        ? row.retention_expires_at
        : new Date(String(row.retention_expires_at)),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at)),
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
  private readonly reports = new Map<string, PresentationSessionReportRecord>();
  private readonly reportJobs = new Map<
    string,
    { attempts: number; availableAt: Date; leaseToken: string | null; lastError: string | null }
  >();

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
      presentationSessionReports: [...this.reports.values()]
        .filter((report) => sessionIds.has(report.sessionId))
        .map(clone),
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
    for (const [id, report] of this.reports) {
      if (report.sessionId === sessionId) {
        this.reports.delete(id);
        this.reportJobs.delete(id);
      }
    }
  }

  private enqueueReport(session: PresentationSessionRecord) {
    if (session.status !== "finished") return;
    const existing = [...this.reports.values()].find((report) => report.sessionId === session.id);
    if (existing) return;
    const createdAt = session.finishedAt ?? session.updatedAt;
    const report: PresentationSessionReportRecord = {
      id: session.id,
      workspaceId: session.workspaceId,
      sessionId: session.id,
      status: "pending",
      schemaVersion: 1,
      payload: null,
      generatedAt: null,
      expiresAt: new Date(session.retentionExpiresAt),
      createdAt: new Date(createdAt),
      updatedAt: new Date(createdAt),
    };
    this.reports.set(report.id, report);
    this.reportJobs.set(report.id, {
      attempts: 0,
      availableAt: new Date(createdAt),
      leaseToken: null,
      lastError: null,
    });
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
      this.enqueueReport(normalized);
      return clone(normalized);
    } catch (error) {
      this.sessions.delete(normalized.id);
      this.reports.delete(normalized.id);
      this.reportJobs.delete(normalized.id);
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
      this.enqueueReport(normalized);
      return { session: clone(normalized), credential: clone(credential) };
    } catch (error) {
      this.sessions.delete(normalized.id);
      this.credentials.delete(credential.id);
      this.reports.delete(normalized.id);
      this.reportJobs.delete(normalized.id);
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
    // Publish the report job only after every report input for this transition is visible. The
    // memory worker can run concurrently while this async method is suspended, so enqueueing
    // before the final timeline record would diverge from PostgreSQL transaction semantics.
    if (becomingFinished) this.enqueueReport(updated);
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
    const session = this.sessions.get(input.sessionId);
    if (!session || session.workspaceId !== input.workspaceId) {
      throw new Error("Presentation session does not exist");
    }
    session.eventSeq += 1;
    const stored = clone(input);
    this.participants.set(input.id, stored);
    return clone(stored);
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
    // Sequence fences cover every durable aggregate mutation, not only host transitions. This
    // keeps equal-revision join snapshots from racing one another in reconnecting clients.
    session.eventSeq += 1;
    const stored = clone(input);
    this.participants.set(input.id, stored);
    return { status: "accepted", participant: clone(stored) };
  }

  async findParticipant(sessionId: string, tokenHash: string) {
    const participant = [...this.participants.values()].find(
      (candidate) => candidate.sessionId === sessionId && candidate.tokenHash === tokenHash,
    );
    if (!participant) return null;
    participant.lastSeenAt = new Date();
    return clone(participant);
  }

  async getResponseContext(
    sessionId: string,
    tokenHash: string,
    idempotencyKey: string,
  ): Promise<PresentationResponseContext | null> {
    const session = this.sessions.get(sessionId);
    const participant = [...this.participants.values()].find(
      (candidate) => candidate.sessionId === sessionId && candidate.tokenHash === tokenHash,
    );
    if (!session || !participant) return null;
    participant.lastSeenAt = new Date();
    const priorResponse = [...this.responses.values()].find(
      (candidate) =>
        candidate.sessionId === sessionId &&
        candidate.participantId === participant.id &&
        candidate.idempotencyKey === idempotencyKey,
    );
    return {
      session: clone(session),
      participant: clone(participant),
      priorResponse: priorResponse ? clone(priorResponse) : null,
    };
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
          : {
              status: "duplicate",
              response: clone(idempotent),
              acknowledgement: this.responseAcknowledgementState(
                this.sessions.get(input.sessionId)!,
                input.participantId,
              ),
            };
      }
    }
    const session = this.sessions.get(input.sessionId);
    if (
      !session ||
      session.workspaceId !== input.workspaceId ||
      ![...this.participants.values()].some(
        (participant) =>
          participant.workspaceId === input.workspaceId &&
          participant.sessionId === input.sessionId &&
          participant.id === input.participantId,
      ) ||
      !responseWindowOpen(session, input, expectedSessionRevision)
    ) {
      return { status: "phase_closed" };
    }
    const key = `${input.sessionId}:${input.participantId}:${input.blockId}`;
    const existing = this.responses.get(key);
    if (existing) {
      if (input.idempotencyKey) {
        return { status: "already_responded", response: clone(existing) };
      }
      return {
        status: "duplicate",
        response: clone(existing),
        acknowledgement: this.responseAcknowledgementState(session, input.participantId),
      };
    }
    // A response changes participant/answer aggregates while the host revision stays fixed.
    // Advance the independent sequence so delayed snapshots cannot roll those aggregates back.
    session.eventSeq += 1;
    const stored = clone(input);
    this.responses.set(key, stored);
    return {
      status: "accepted",
      response: clone(stored),
      acknowledgement: this.responseAcknowledgementState(session, input.participantId),
    };
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

  private participantSnapshotProjection(
    sessionId: string,
    participantId: string,
    currentBlockId: string | null,
    includeStanding: boolean,
  ): PresentationParticipantSnapshotProjection | null {
    const participants = [...this.participants.values()]
      .filter((participant) => participant.sessionId === sessionId)
      .sort(
        (left, right) =>
          left.joinedAt.getTime() - right.joinedAt.getTime() ||
          left.nickname.localeCompare(right.nickname) ||
          left.id.localeCompare(right.id),
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
        .sort(comparePresentationLeaderboardEntries);
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

  private responseAcknowledgementState(
    session: PresentationSessionRecord,
    participantId: string,
  ): PresentationResponseAcknowledgementState {
    const currentBlock =
      session.currentBlockIndex >= 0
        ? (session.content.blocks[session.currentBlockIndex] ?? null)
        : null;
    const projection = this.participantSnapshotProjection(
      session.id,
      participantId,
      currentBlock?.id ?? null,
      session.phase !== "question_open",
    );
    if (!projection) throw new Error("Presentation response participant no longer exists");
    return { session: clone(session), projection };
  }

  async getParticipantSnapshotProjection(
    sessionId: string,
    participantId: string,
    currentBlockId: string | null,
    includeStanding: boolean,
  ): Promise<PresentationParticipantSnapshotProjection | null> {
    return this.participantSnapshotProjection(
      sessionId,
      participantId,
      currentBlockId,
      includeStanding,
    );
  }

  async listTimeline(sessionId: string) {
    return [...this.timeline.values()]
      .filter((event) => event.sessionId === sessionId)
      .sort((left, right) => left.sequence - right.sequence)
      .map(clone);
  }

  async getReport(workspaceId: string, sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session || session.workspaceId !== workspaceId) return null;
    const report = [...this.reports.values()].find(
      (candidate) => candidate.sessionId === sessionId,
    );
    return report ? clone(report) : null;
  }

  async claimReportJob(now: Date, leaseUntil: Date) {
    const candidate = [...this.reportJobs.entries()]
      .filter(([id, job]) => this.reports.get(id)?.status === "pending" && job.availableAt <= now)
      .sort(
        (left, right) =>
          left[1].availableAt.getTime() - right[1].availableAt.getTime() ||
          left[0].localeCompare(right[0]),
      )[0];
    if (!candidate) return null;
    const [reportId, metadata] = candidate;
    const report = this.reports.get(reportId)!;
    const leaseToken = randomUUID();
    metadata.attempts += 1;
    metadata.availableAt = new Date(leaseUntil);
    metadata.leaseToken = leaseToken;
    return {
      reportId,
      workspaceId: report.workspaceId,
      sessionId: report.sessionId,
      attempts: metadata.attempts,
      leaseToken,
      expiresAt: new Date(report.expiresAt),
    };
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
    const current = this.reports.get(job.reportId);
    const metadata = this.reportJobs.get(job.reportId);
    if (
      !current ||
      !metadata ||
      current.workspaceId !== job.workspaceId ||
      current.sessionId !== job.sessionId ||
      current.status !== "pending" ||
      metadata.leaseToken !== job.leaseToken
    ) {
      throw new Error("The claimed Presentation report job is no longer pending");
    }
    this.reports.set(job.reportId, {
      ...current,
      status: "ready",
      schemaVersion: report.schemaVersion,
      payload: clone(report.payload),
      generatedAt: new Date(report.generatedAt),
      updatedAt: new Date(),
    });
    this.reportJobs.delete(job.reportId);
  }

  async retryReportJob(
    job: PresentationSessionReportJob,
    error: string,
    availableAt: Date,
    failed: boolean,
  ) {
    const report = this.reports.get(job.reportId);
    const metadata = this.reportJobs.get(job.reportId);
    if (
      !report ||
      !metadata ||
      report.workspaceId !== job.workspaceId ||
      report.sessionId !== job.sessionId ||
      report.status !== "pending" ||
      metadata.leaseToken !== job.leaseToken
    ) {
      return;
    }
    metadata.lastError = error.slice(0, 2_000);
    metadata.availableAt = new Date(availableAt);
    metadata.leaseToken = null;
    report.updatedAt = new Date();
    if (failed) {
      report.status = "failed";
      this.reportJobs.delete(job.reportId);
    }
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
                'event_seq', session.revision
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
                  'event_seq', session.revision
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

export function createPresentationSessionRepository(
  repository: Repository,
  options: { concurrentResponseWrites?: boolean } = {},
): PresentationSessionRepository {
  if (repository instanceof PostgresRepository) {
    return new PostgresPresentationSessionRepository(repository, options);
  }
  if (repository instanceof MemoryRepository) {
    return repository.getOrCreateLifecycleExtension(
      "presentation-sessions",
      () => new MemoryPresentationSessionRepository(repository),
    );
  }
  return new MemoryPresentationSessionRepository(repository);
}

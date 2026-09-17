import { randomInt, randomUUID } from "node:crypto";
import { SpanStatusCode, trace, type Attributes } from "@opentelemetry/api";
import {
  canonicalizeResponse,
  responseForAnswer,
  type AnswerAck,
  type AnswerSubmit,
  type EventEnvelope,
  type HostCommand,
  type JoinRequest,
  type JoinResponse,
  type Report,
  type SessionSettings,
  type SessionSnapshot,
  type SessionStaffRole,
  type SyncRequest,
  type SyncResponse,
} from "@openround/contracts";
import {
  SessionCodeConflictError,
  SessionVersionConflictError,
  type CreatorContext,
  type ParticipantRecord,
  type Repository,
  type SessionStaffCredentialRecord,
  type StoredSession,
} from "@openround/db";
import {
  acceptAnswer,
  addParticipant,
  applyHostCommand,
  EngineError,
  setParticipantConnection,
  snapshotForRole,
  createGameState,
  upgradeGameState,
  type EngineAnswer,
  type EngineEvent,
  type GameState,
} from "@openround/game-engine";
import type { AppConfig } from "./config.js";
import type { SessionCache } from "./cache.js";
import {
  friendlyNickname,
  hashToken,
  nicknameAllowed,
  normalizeNickname,
  opaqueToken,
  safeHashEqual,
} from "./security.js";
import { createPendingReport } from "./reporting.js";
import type { MetricsService } from "./metrics.js";
import { entitlementsFor, retentionExpiry } from "./entitlements.js";

export interface SessionMutation {
  state: GameState;
  events: EngineEvent[];
  reportId?: string;
}

type MutationListener = (mutation: SessionMutation) => void | Promise<void>;

export interface SessionAuxiliaryEvent {
  sessionId: string;
  type: `qna.${string}` | "session.staff.revoked";
  payload: Record<string, unknown>;
}

type AuxiliaryListener = (event: SessionAuxiliaryEvent) => void | Promise<void>;

interface PendingAnswer {
  input: AnswerSubmit;
  participant: ParticipantRecord;
  receivedAtMs: number;
  resolve: (acknowledgement: AnswerAck) => void;
  reject: (error: unknown) => void;
}

interface AnswerBatch {
  items: PendingAnswer[];
  timer: NodeJS.Timeout;
}

interface AnswerIngress {
  receivedAtMs: number;
  ready: Promise<void>;
  settled: Promise<void>;
}

interface PendingJoin {
  input: JoinRequest;
  resolve: (response: JoinResponse) => void;
  reject: (error: unknown) => void;
}

interface JoinBatch {
  items: PendingJoin[];
  timer: NodeJS.Timeout;
}

const answerBatchWindowMs = 10;
const maximumAnswerBatchSize = 250;
const joinBatchWindowMs = 10;
const maximumJoinBatchSize = 250;

export class SessionError extends Error {
  constructor(
    public readonly code:
      | "INVALID_CODE"
      | "SESSION_FULL"
      | "SESSION_LOCKED"
      | "NICKNAME_REJECTED"
      | "STALE_VERSION"
      | "ANSWER_LATE"
      | "ANSWER_INVALID"
      | "ENTITLEMENT_LIMIT"
      | "INSTITUTION_AUTH_REQUIRED"
      | "UNAUTHORIZED"
      | "NOT_FOUND"
      | "CONFLICT",
    message: string,
  ) {
    super(message);
  }
}

export class SessionService {
  private readonly active = new Map<string, StoredSession>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly answerBatches = new Map<string, AnswerBatch>();
  private readonly answerIngress = new Map<string, Set<AnswerIngress>>();
  private readonly joinBatches = new Map<string, JoinBatch>();
  private readonly participantCredentials = new Map<string, ParticipantRecord>();
  private readonly listeners = new Set<MutationListener>();
  private readonly auxiliaryListeners = new Set<AuxiliaryListener>();
  private readonly tracer = trace.getTracer("openround-game-service");
  private closing = false;

  constructor(
    private readonly repository: Repository,
    private readonly cache: SessionCache,
    private readonly config: AppConfig,
    private readonly metrics: MetricsService,
  ) {}

  subscribe(listener: MutationListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeAuxiliary(listener: AuxiliaryListener) {
    this.auxiliaryListeners.add(listener);
    return () => this.auxiliaryListeners.delete(listener);
  }

  async publishAuxiliary(event: SessionAuxiliaryEvent) {
    for (const listener of this.auxiliaryListeners) await listener(event);
  }

  private traceOperation<T>(name: string, attributes: Attributes, work: () => Promise<T>) {
    return this.tracer.startActiveSpan(name, { attributes }, async (span) => {
      try {
        return await work();
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.recordException(error instanceof Error ? error : String(error));
        throw error;
      } finally {
        span.end();
      }
    });
  }

  private async publish(mutation: SessionMutation) {
    this.metrics.recordSessionEvents(mutation.events.map((event) => event.type));
    for (const listener of this.listeners) await listener(mutation);
  }

  private async exclusive<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const prior = this.queues.get(sessionId) ?? Promise.resolve();
    let resolveCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      resolveCurrent = resolve;
    });
    const chained = prior.then(() => current);
    this.queues.set(sessionId, chained);
    await prior;
    try {
      return await work();
    } finally {
      resolveCurrent();
      if (this.queues.get(sessionId) === chained) this.queues.delete(sessionId);
    }
  }

  private async mutate<T>(
    sessionId: string,
    operation: "answer" | "deadline" | "delete" | "disconnect" | "host" | "join" | "resume",
    work: () => Promise<T>,
  ): Promise<T> {
    return this.exclusive(sessionId, async () => {
      if (this.closing) throw new SessionError("CONFLICT", "The server is shutting down");
      const owner = randomUUID();
      const startedAt = performance.now();
      const waitUntil = Date.now() + this.config.SESSION_MUTATION_LEASE_WAIT_MS;
      let acquired: boolean;
      try {
        acquired = await this.cache.acquireMutationLease(
          sessionId,
          owner,
          this.config.SESSION_MUTATION_LEASE_TTL_MS,
        );
        while (!acquired) {
          const remainingMs = waitUntil - Date.now();
          if (remainingMs <= 0) break;
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(25, Math.max(5, remainingMs))),
          );
          acquired = await this.cache.acquireMutationLease(
            sessionId,
            owner,
            this.config.SESSION_MUTATION_LEASE_TTL_MS,
          );
        }
      } catch {
        this.metrics.observeMutationLease("error", (performance.now() - startedAt) / 1_000);
        throw new SessionError("CONFLICT", "Session coordination is temporarily unavailable");
      }
      if (!acquired) {
        this.metrics.observeMutationLease("timeout", (performance.now() - startedAt) / 1_000);
        throw new SessionError("CONFLICT", "The session is busy; synchronize and retry");
      }
      this.metrics.observeMutationLease("acquired", (performance.now() - startedAt) / 1_000);

      const renewal = setInterval(
        () => {
          void this.cache
            .renewMutationLease(sessionId, owner, this.config.SESSION_MUTATION_LEASE_TTL_MS)
            .then((renewed) => {
              if (!renewed) this.metrics.mutationLeaseRenewalFailed();
            })
            .catch(() => this.metrics.mutationLeaseRenewalFailed());
        },
        Math.max(250, Math.floor(this.config.SESSION_MUTATION_LEASE_TTL_MS / 3)),
      );
      renewal.unref();

      try {
        let conflictRetries = 0;
        while (true) {
          try {
            return await work();
          } catch (error) {
            if (!(error instanceof SessionVersionConflictError)) throw error;
            this.active.delete(sessionId);
            this.metrics.setActiveSessions(this.active.size);
            this.metrics.sessionVersionConflict(operation);
            if (operation !== "join" && conflictRetries === 0) {
              conflictRetries += 1;
              continue;
            }
            throw new SessionError(
              operation === "host" ? "STALE_VERSION" : "CONFLICT",
              "Session state changed; synchronize and retry",
            );
          }
        }
      } finally {
        clearInterval(renewal);
        await this.cache.releaseMutationLease(sessionId, owner).catch(() => undefined);
      }
    });
  }

  private async loadSession(sessionId: string): Promise<StoredSession | null> {
    const persisted = await this.repository.getSessionById(sessionId);
    if (!persisted || persisted.expiresAt.getTime() <= Date.now()) {
      this.active.delete(sessionId);
      this.metrics.setActiveSessions(this.active.size);
      if (persisted) await this.cache.delete(sessionId).catch(() => undefined);
      return null;
    }
    const cached = await this.cache.get(sessionId);
    persisted.state = upgradeGameState(persisted.state);
    if (cached && cached.version >= persisted.state.version) {
      persisted.state = upgradeGameState(cached);
    }
    this.active.set(sessionId, persisted);
    this.metrics.setActiveSessions(this.active.size);
    this.scheduleDeadline(persisted);
    return persisted;
  }

  private async loadSessionForMutation(sessionId: string): Promise<StoredSession | null> {
    const active = this.active.get(sessionId);
    if (active) {
      if (active.expiresAt.getTime() <= Date.now()) {
        this.active.delete(sessionId);
        this.metrics.setActiveSessions(this.active.size);
        await this.cache.delete(sessionId).catch(() => undefined);
        return null;
      }
      const cached = await this.cache.get(sessionId);
      if (cached && cached.version >= active.state.version) {
        active.state = upgradeGameState(cached);
        this.scheduleDeadline(active);
        return active;
      }
    }
    return this.loadSession(sessionId);
  }

  private async participantForToken(token: string) {
    const tokenHash = hashToken(token);
    const cached = this.participantCredentials.get(tokenHash);
    if (cached) return cached;
    const participant = await this.repository.getParticipantByToken(tokenHash);
    if (participant) this.participantCredentials.set(tokenHash, participant);
    return participant;
  }

  private async staffForTokenHash(tokenHash: string) {
    return this.repository.getSessionStaffByToken(tokenHash, new Date());
  }

  private async authorizeStaffTokenHash(
    session: StoredSession,
    tokenHash: string,
    allowedRoles: SessionStaffRole[],
  ): Promise<{ rootHost: boolean; credential: SessionStaffCredentialRecord | null }> {
    if (safeHashEqual(session.hostTokenHash, tokenHash)) {
      return { rootHost: true, credential: null };
    }
    const credential = await this.staffForTokenHash(tokenHash);
    if (
      !credential ||
      credential.sessionId !== session.id ||
      credential.workspaceId !== session.workspaceId ||
      !allowedRoles.includes(credential.role)
    ) {
      throw new SessionError("UNAUTHORIZED", "Session staff credential is invalid or expired");
    }
    return { rootHost: false, credential };
  }

  private authorizeStaff(session: StoredSession, token: string, allowedRoles: SessionStaffRole[]) {
    return this.authorizeStaffTokenHash(session, hashToken(token), allowedRoles);
  }

  async realtimeStaffIdentity(sessionId: string, token: string, role: "host" | "presenter") {
    const session = await this.loadSession(sessionId);
    if (!session) throw new SessionError("NOT_FOUND", "Session not found");
    const tokenHash = hashToken(token);
    const staff = await this.authorizeStaffTokenHash(
      session,
      tokenHash,
      role === "presenter" ? ["cohost", "presenter"] : ["cohost"],
    );
    return {
      credentialId: staff.credential?.id ?? null,
      expiresAtMs: staff.credential?.expiresAt.getTime() ?? null,
      tokenHash,
    };
  }

  async revalidateRealtimeStaff(sessionId: string, tokenHash: string, role: "host" | "presenter") {
    const session = await this.loadSession(sessionId);
    if (!session) throw new SessionError("NOT_FOUND", "Session not found");
    await this.authorizeStaffTokenHash(
      session,
      tokenHash,
      role === "presenter" ? ["cohost", "presenter"] : ["cohost"],
    );
  }

  async createSessionStaffCredential(
    creator: CreatorContext,
    sessionId: string,
    input: { role: SessionStaffRole; label: string; expiresInMinutes: number },
  ) {
    if (creator.role === "viewer") {
      throw new SessionError("UNAUTHORIZED", "Viewers cannot create session staff credentials");
    }
    const session = await this.repository.getSessionById(sessionId);
    if (!session || session.workspaceId !== creator.workspaceId) {
      throw new SessionError("NOT_FOUND", "Session not found");
    }
    const token = opaqueToken();
    const embedPolicyKey = input.role === "presenter" ? opaqueToken() : undefined;
    const embedAllowedOrigins =
      input.role === "presenter"
        ? await this.repository.getEmbedAllowedOrigins(creator.workspaceId)
        : [];
    const now = new Date();
    const requestedExpiry = new Date(now.getTime() + input.expiresInMinutes * 60_000);
    const record = await this.repository.createSessionStaffCredential({
      id: randomUUID(),
      workspaceId: creator.workspaceId,
      sessionId,
      role: input.role,
      label: input.label,
      tokenHash: hashToken(token),
      embedPolicyKeyHash: embedPolicyKey ? hashToken(embedPolicyKey) : null,
      embedAllowedOrigins,
      createdBy: creator.userId,
      expiresAt:
        requestedExpiry < session.expiresAt ? requestedExpiry : new Date(session.expiresAt),
      revokedAt: null,
      createdAt: now,
    });
    return {
      token,
      ...(embedPolicyKey ? { embedPolicyKey } : {}),
      ...(input.role === "presenter" ? { embedAllowedOrigins } : {}),
      credential: {
        id: record.id,
        sessionId: record.sessionId,
        role: record.role,
        label: record.label,
        expiresAt: record.expiresAt.toISOString(),
        revokedAt: record.revokedAt?.toISOString() ?? null,
        createdAt: record.createdAt.toISOString(),
      },
    };
  }

  private async save(
    session: StoredSession,
    events: EngineEvent[],
    expectedVersion: number,
    report?: Report,
  ) {
    session.updatedAt = new Date();
    await this.repository.saveSession(session, expectedVersion, report);
    this.active.set(session.id, session);
    this.metrics.setActiveSessions(this.active.size);
    await Promise.allSettled([
      this.cache.set(session.state, this.liveCacheTtlSeconds(session)),
      this.cache.appendEvents(
        session.id,
        events.map((event) => ({
          seq: event.seq,
          type: event.type,
          payload: {
            version: session.state.version,
          },
        })),
      ),
    ]);
    if (session.state.phase === "finished") {
      await this.cache.releaseSessionCode(session.state.code, session.id).catch(() => undefined);
    }
    this.scheduleDeadline(session);
  }

  private liveCacheTtlSeconds(session: StoredSession) {
    return Math.max(1, Math.ceil((session.expiresAt.getTime() - Date.now()) / 1_000));
  }

  private scheduleDeadline(session: StoredSession) {
    const existing = this.timers.get(session.id);
    if (existing) clearTimeout(existing);
    this.timers.delete(session.id);
    if (session.state.phase !== "question_open" || !session.state.deadlineMs) return;
    const delay = Math.max(0, session.state.deadlineMs - Date.now());
    const deadlineMs = session.state.deadlineMs;
    const timer = setTimeout(
      () => {
        this.timers.delete(session.id);
        void this.autoLock(session.id, deadlineMs).catch(() => undefined);
      },
      Math.min(delay + answerBatchWindowMs + 5, 2_147_483_647),
    );
    timer.unref();
    this.timers.set(session.id, timer);
  }

  private async autoLock(sessionId: string, deadlineMs: number) {
    await this.flushAnswersReceivedBy(sessionId, deadlineMs);
    await this.mutate(sessionId, "deadline", async () => {
      const session = await this.loadSessionForMutation(sessionId);
      if (!session || session.state.phase !== "question_open") return;
      if (session.state.deadlineMs && Date.now() < session.state.deadlineMs) {
        this.scheduleDeadline(session);
        return;
      }
      const result = applyHostCommand(session.state, {
        action: "lock",
        commandId: `deadline:${session.state.roundId}`,
        expectedVersion: session.state.version,
        nowMs: Date.now(),
        newRoundId: randomUUID,
      });
      session.state = result.state;
      await this.save(session, result.events, result.state.version - 1);
      await this.publish({ state: session.state, events: result.events });
    });
  }

  async createSession(
    creator: CreatorContext,
    quizId: string,
    settings: SessionSettings,
  ): Promise<{ sessionId: string; code: string; hostToken: string; snapshot: SessionSnapshot }> {
    if (creator.role === "viewer") {
      throw new SessionError("UNAUTHORIZED", "Viewers cannot host live rounds");
    }
    const institutionPolicy = await this.repository.getInstitutionPolicy(creator.workspaceId);
    if (institutionPolicy.identityRequirement === "institution") {
      throw new SessionError(
        "INSTITUTION_AUTH_REQUIRED",
        "Institution-identified live participation is not enabled in this release; keep guest or optional identity to host a round",
      );
    }
    const quiz = await this.repository.getQuiz(creator.workspaceId, quizId);
    if (!quiz?.currentVersionId)
      throw new SessionError("NOT_FOUND", "Publish the quiz before hosting it");
    const version = await this.repository.getQuizVersion(
      creator.workspaceId,
      quiz.currentVersionId,
    );
    if (!version) throw new SessionError("NOT_FOUND", "Published quiz version not found");
    const plan = this.config.COMMUNITY_MODE
      ? "team"
      : await this.repository.getPlan(creator.workspaceId);
    const entitlements = entitlementsFor(plan, this.config);
    if (settings.audienceLimit > entitlements.maxParticipants) {
      throw new SessionError(
        "ENTITLEMENT_LIMIT",
        `This plan supports up to ${entitlements.maxParticipants} live participants`,
      );
    }
    const brandTheme = entitlements.brandTheme
      ? await this.repository.getBrandTheme(creator.workspaceId)
      : null;

    const sessionId = randomUUID();
    const hostToken = opaqueToken();
    const now = new Date();
    const ttlMs = 24 * 60 * 60_000;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const code = String(randomInt(0, 10_000_000)).padStart(7, "0");
      let reserved = false;
      let retained = false;
      try {
        try {
          reserved = await this.cache.reserveSessionCode(code, sessionId, ttlMs);
        } catch {
          throw new SessionError(
            "CONFLICT",
            "Session code coordination is temporarily unavailable",
          );
        }
        if (!reserved) continue;
        if (await this.repository.getSessionByCode(code)) continue;
        const session: StoredSession = {
          id: sessionId,
          workspaceId: creator.workspaceId,
          quizVersionId: version.id,
          hostId: creator.userId,
          hostTokenHash: hashToken(hostToken),
          state: createGameState({
            sessionId,
            code,
            quiz: version.content,
            settings,
            brandTheme,
          }),
          expiresAt: new Date(now.getTime() + ttlMs),
          retentionExpiresAt: retentionExpiry(now, entitlements),
          createdAt: now,
          updatedAt: now,
        };
        await this.repository.createSession(session);
        retained = true;
        await this.cache.set(session.state, ttlMs / 1_000).catch(() => undefined);
        this.active.set(session.id, session);
        this.metrics.setActiveSessions(this.active.size);
        return {
          sessionId,
          code,
          hostToken,
          snapshot: snapshotForRole(session.state, { role: "host" }),
        };
      } catch (error) {
        if (error instanceof SessionCodeConflictError) continue;
        throw error;
      } finally {
        if (reserved && !retained) {
          await this.cache.releaseSessionCode(code, sessionId).catch(() => undefined);
        }
      }
    }
    throw new SessionError("CONFLICT", "Could not reserve a session code");
  }

  async join(input: JoinRequest): Promise<JoinResponse> {
    const kind = input.resumeToken ? "resume" : "new";
    return this.traceOperation(
      "openround.session.join",
      { "openround.join.kind": kind },
      async () => {
        const startedAt = performance.now();
        try {
          const joined = await this.joinParticipant(input);
          this.metrics.recordJoin(kind, "success", (performance.now() - startedAt) / 1_000);
          trace.getActiveSpan()?.setAttribute("openround.outcome", "success");
          return joined;
        } catch (error) {
          const outcome =
            error instanceof SessionError ? error.code.toLocaleLowerCase("en-CA") : "error";
          this.metrics.recordJoin(kind, outcome, (performance.now() - startedAt) / 1_000);
          trace.getActiveSpan()?.setAttribute("openround.outcome", outcome);
          throw error;
        }
      },
    );
  }

  private async joinParticipant(input: JoinRequest): Promise<JoinResponse> {
    if (input.resumeToken) {
      const participant = await this.participantForToken(input.resumeToken);
      if (!participant) throw new SessionError("UNAUTHORIZED", "Resume token is invalid");
      return {
        participantId: participant.id,
        participantToken: input.resumeToken,
        snapshot: await this.reconnectParticipant(participant),
      };
    }

    const stored = await this.repository.getSessionByCode(input.code);
    if (!stored) throw new SessionError("INVALID_CODE", "Check the code and try again");
    const institutionPolicy = await this.repository.getInstitutionPolicy(stored.workspaceId);
    if (institutionPolicy.identityRequirement === "institution") {
      throw new SessionError(
        "INSTITUTION_AUTH_REQUIRED",
        "This workspace requires institution identity; anonymous code entry is disabled",
      );
    }
    return this.queueJoin(stored.id, input);
  }

  private queueJoin(sessionId: string, input: JoinRequest) {
    return new Promise<JoinResponse>((resolve, reject) => {
      let batch = this.joinBatches.get(sessionId);
      if (!batch) {
        const items: PendingJoin[] = [];
        const timer = setTimeout(() => this.dispatchJoinBatch(sessionId, items), joinBatchWindowMs);
        batch = { items, timer };
        this.joinBatches.set(sessionId, batch);
      }
      batch.items.push({ input, resolve, reject });
      if (batch.items.length >= maximumJoinBatchSize) {
        clearTimeout(batch.timer);
        this.dispatchJoinBatch(sessionId, batch.items);
      }
    });
  }

  private dispatchJoinBatch(sessionId: string, items: PendingJoin[]) {
    const current = this.joinBatches.get(sessionId);
    if (!current || current.items !== items) return;
    clearTimeout(current.timer);
    this.joinBatches.delete(sessionId);
    void this.processJoinBatch(sessionId, items).catch((error: unknown) => {
      for (const item of items) item.reject(error);
    });
  }

  private async processJoinBatch(sessionId: string, items: PendingJoin[]) {
    await this.mutate(sessionId, "join", async () => {
      const session = await this.loadSessionForMutation(sessionId);
      if (!session) throw new SessionError("INVALID_CODE", "Session is no longer available");
      const priorState = session.state;
      if (
        priorState.lobbyLocked ||
        (!priorState.settings.allowLateJoin && priorState.phase !== "lobby")
      ) {
        throw new SessionError("SESSION_LOCKED", "This session is not accepting new participants");
      }
      if (priorState.phase === "finished")
        throw new SessionError("SESSION_LOCKED", "This session has ended");

      let nextState = priorState;
      let participantCount = Object.values(priorState.participants).filter(
        (participant) => !participant.kicked,
      ).length;
      const normalizedNames = new Set(
        Object.values(priorState.participants).map((participant) =>
          participant.nickname.toLocaleLowerCase("en-CA"),
        ),
      );
      const accepted: Array<{
        item: PendingJoin;
        participant: ParticipantRecord;
        participantToken: string;
      }> = [];
      const events: EngineEvent[] = [];
      const eventVersions = new Map<number, number>();

      for (const item of items) {
        try {
          if (participantCount >= priorState.settings.audienceLimit) {
            throw new SessionError(
              "SESSION_FULL",
              "This session has reached its participant limit",
            );
          }
          const generated = friendlyNickname(participantCount);
          const nickname = normalizeNickname(
            priorState.settings.nicknamePolicy === "friendly_only"
              ? generated
              : (item.input.nickname ?? generated),
          );
          if (!nicknameAllowed(nickname)) {
            throw new SessionError("NICKNAME_REJECTED", "Choose another nickname");
          }
          let uniqueNickname = nickname;
          let suffix = 2;
          while (normalizedNames.has(uniqueNickname.toLocaleLowerCase("en-CA"))) {
            uniqueNickname = `${nickname} ${suffix++}`;
          }
          normalizedNames.add(uniqueNickname.toLocaleLowerCase("en-CA"));

          const participantToken = opaqueToken();
          const participant: ParticipantRecord = {
            id: randomUUID(),
            sessionId: session.id,
            nickname: uniqueNickname,
            tokenHash: hashToken(participantToken),
            status: "active",
            joinedAt: new Date(),
          };
          const result = addParticipant(nextState, {
            id: participant.id,
            nickname: participant.nickname,
            score: 0,
            correctCount: 0,
            acceptedResponseMs: 0,
            connected: true,
            kicked: false,
          });
          nextState = result.state;
          participantCount += 1;
          events.push(...result.events);
          for (const event of result.events) eventVersions.set(event.seq, result.state.version);
          accepted.push({ item, participant, participantToken });
        } catch (error) {
          if (error instanceof SessionError) item.reject(error);
          else throw error;
        }
      }

      if (accepted.length === 0) return;
      session.state = nextState;
      session.updatedAt = new Date();
      try {
        await this.repository.commitParticipants(
          session,
          accepted.map(({ participant }) => participant),
          priorState.version,
        );
      } catch (error) {
        session.state = priorState;
        throw error;
      }
      this.active.set(session.id, session);
      this.metrics.setActiveSessions(this.active.size);
      this.metrics.recordJoinBatch(accepted.length);
      for (const { participant } of accepted) {
        this.participantCredentials.set(participant.tokenHash, participant);
      }
      for (const { item, participant, participantToken } of accepted) {
        item.resolve({
          participantId: participant.id,
          participantToken,
          snapshot: snapshotForRole(session.state, {
            role: "participant",
            participantId: participant.id,
          }),
        });
      }
      await Promise.resolve();
      const cacheUpdate = Promise.allSettled([
        this.cache.set(session.state, this.liveCacheTtlSeconds(session)),
        this.cache.appendEvents(
          session.id,
          events.map((event) => ({
            seq: event.seq,
            type: event.type,
            payload: { version: eventVersions.get(event.seq) ?? session.state.version },
          })),
        ),
      ]);
      await cacheUpdate;
      this.scheduleDeadline(session);
      const latestEvent = events.at(-1)!;
      await this.publish({ state: session.state, events: [latestEvent] }).catch(() => undefined);
    });
  }

  async answer(input: AnswerSubmit): Promise<AnswerAck> {
    const receivedAtMs = Date.now();
    let markReady!: () => void;
    let markSettled!: () => void;
    const ingress: AnswerIngress = {
      receivedAtMs,
      ready: new Promise<void>((resolve) => {
        markReady = resolve;
      }),
      settled: new Promise<void>((resolve) => {
        markSettled = resolve;
      }),
    };
    const sessionIngress = this.answerIngress.get(input.sessionId) ?? new Set<AnswerIngress>();
    sessionIngress.add(ingress);
    this.answerIngress.set(input.sessionId, sessionIngress);
    return this.traceOperation("openround.session.answer", {}, async () => {
      const startedAt = performance.now();
      try {
        const acknowledgement = await this.queueAnswer(input, receivedAtMs, markReady);
        const outcome = acknowledgement.accepted
          ? acknowledgement.duplicate
            ? "duplicate"
            : "accepted"
          : acknowledgement.code === "ANSWER_LATE"
            ? "late"
            : "invalid";
        this.metrics.recordAnswer(outcome, (performance.now() - startedAt) / 1_000);
        trace.getActiveSpan()?.setAttribute("openround.outcome", outcome);
        return acknowledgement;
      } catch (error) {
        this.metrics.recordAnswer("error", (performance.now() - startedAt) / 1_000);
        trace.getActiveSpan()?.setAttribute("openround.outcome", "error");
        throw error;
      } finally {
        markReady();
        markSettled();
        sessionIngress.delete(ingress);
        if (sessionIngress.size === 0) this.answerIngress.delete(input.sessionId);
      }
    });
  }

  private async queueAnswer(
    input: AnswerSubmit,
    receivedAtMs: number,
    markReady: () => void,
  ): Promise<AnswerAck> {
    const participant = await this.participantForToken(input.participantToken);
    if (!participant || participant.sessionId !== input.sessionId) {
      throw new SessionError("UNAUTHORIZED", "Participant token is invalid");
    }
    return new Promise<AnswerAck>((resolve, reject) => {
      let batch = this.answerBatches.get(input.sessionId);
      if (!batch) {
        const items: PendingAnswer[] = [];
        const timer = setTimeout(
          () => this.dispatchAnswerBatch(input.sessionId, items),
          answerBatchWindowMs,
        );
        batch = { items, timer };
        this.answerBatches.set(input.sessionId, batch);
      }
      batch.items.push({ input, participant, receivedAtMs, resolve, reject });
      markReady();
      if (batch.items.length >= maximumAnswerBatchSize) {
        clearTimeout(batch.timer);
        this.dispatchAnswerBatch(input.sessionId, batch.items);
      }
    });
  }

  private async flushAnswersReceivedBy(sessionId: string, cutoffMs: number) {
    while (true) {
      const ingress = [...(this.answerIngress.get(sessionId) ?? [])].filter(
        (item) => item.receivedAtMs <= cutoffMs,
      );
      if (ingress.length === 0) return;
      await Promise.allSettled(ingress.map((item) => item.ready));
      const batch = this.answerBatches.get(sessionId);
      if (batch) {
        clearTimeout(batch.timer);
        this.dispatchAnswerBatch(sessionId, batch.items);
      }
      await Promise.allSettled(ingress.map((item) => item.settled));
    }
  }

  private dispatchAnswerBatch(sessionId: string, items: PendingAnswer[]) {
    const current = this.answerBatches.get(sessionId);
    if (!current || current.items !== items) return;
    clearTimeout(current.timer);
    this.answerBatches.delete(sessionId);
    void this.processAnswerBatch(sessionId, items).catch((error: unknown) => {
      for (const item of items) item.reject(error);
    });
  }

  private async processAnswerBatch(sessionId: string, items: PendingAnswer[]) {
    await this.mutate(sessionId, "answer", async () => {
      const session = await this.loadSessionForMutation(sessionId);
      if (!session) throw new SessionError("NOT_FOUND", "Session not found");
      const priorState = session.state;
      const durableAnswers = await this.repository.findAnswers(
        session.workspaceId,
        session.id,
        items.map(({ input, participant }) => ({
          participantId: participant.id,
          roundId: input.roundId,
          idempotencyKey: input.idempotencyKey,
        })),
      );
      const durableByIdempotencyKey = new Map(
        durableAnswers.map((answer) => [answer.idempotencyKey, answer]),
      );
      const durableByParticipantRound = new Map(
        durableAnswers.map((answer) => [`${answer.participantId}:${answer.roundId}`, answer]),
      );
      let nextState = priorState;
      const newAnswers: EngineAnswer[] = [];
      const events: EngineEvent[] = [];
      const eventVersions = new Map<number, number>();
      const outcomes: Array<{ item: PendingAnswer; acknowledgement: AnswerAck }> = [];

      for (const item of items) {
        try {
          const durableForKey = durableByIdempotencyKey.get(item.input.idempotencyKey);
          const durableForRound = durableByParticipantRound.get(
            `${item.participant.id}:${item.input.roundId}`,
          );
          const durable = durableForKey ?? durableForRound;
          if (durable) {
            const idempotentRequestMatches =
              !durableForKey ||
              (durable.participantId === item.participant.id &&
                durable.roundId === item.input.roundId &&
                durable.confidence === (item.input.confidence ?? null) &&
                JSON.stringify(canonicalizeResponse(durable.response)) ===
                  JSON.stringify(responseForAnswer(item.input)));
            if (durable.participantId !== item.participant.id || !idempotentRequestMatches) {
              outcomes.push({
                item,
                acknowledgement: {
                  accepted: false,
                  duplicate: false,
                  code: "ANSWER_INVALID",
                },
              });
            } else {
              outcomes.push({
                item,
                acknowledgement: {
                  accepted: true,
                  answerId: durable.answerId,
                  acceptedAt: new Date(durable.acceptedAtMs).toISOString(),
                  score: durable.score,
                  duplicate: true,
                },
              });
            }
            continue;
          }
          const beforeAnswer = nextState;
          const result = acceptAnswer(beforeAnswer, {
            answerId: randomUUID(),
            participantId: item.participant.id,
            roundId: item.input.roundId,
            response: responseForAnswer(item.input),
            confidence: item.input.confidence,
            idempotencyKey: item.input.idempotencyKey,
            nowMs: item.receivedAtMs,
          });
          const duplicate = result.state === beforeAnswer;
          if (!duplicate) {
            nextState = result.state;
            newAnswers.push(result.answer);
            events.push({ type: "session.snapshot", seq: result.state.seq });
            eventVersions.set(result.state.seq, result.state.version);
          }
          outcomes.push({
            item,
            acknowledgement: {
              accepted: true,
              answerId: result.answer.answerId,
              acceptedAt: new Date(result.answer.acceptedAtMs).toISOString(),
              score: result.answer.score,
              duplicate,
            },
          });
        } catch (error) {
          if (error instanceof EngineError && error.code === "ANSWER_LATE") {
            outcomes.push({
              item,
              acknowledgement: { accepted: false, duplicate: false, code: "ANSWER_LATE" },
            });
          } else if (
            error instanceof EngineError &&
            (error.code === "ANSWER_INVALID" ||
              error.code === "NOT_FOUND" ||
              error.code === "CONFLICT")
          ) {
            outcomes.push({
              item,
              acknowledgement: { accepted: false, duplicate: false, code: "ANSWER_INVALID" },
            });
          } else {
            throw error;
          }
        }
      }

      if (newAnswers.length > 0) {
        session.state = nextState;
        session.updatedAt = new Date();
        try {
          const persisted = await this.repository.commitAnswers(
            session,
            newAnswers,
            priorState.version,
          );
          for (let index = 0; index < newAnswers.length; index += 1) {
            if (persisted[index]?.answerId !== newAnswers[index]?.answerId) {
              throw new SessionError(
                "CONFLICT",
                "Answer state changed during persistence; synchronize and retry",
              );
            }
          }
        } catch (error) {
          session.state = priorState;
          throw error;
        }
        this.active.set(session.id, session);
        this.metrics.setActiveSessions(this.active.size);
        this.metrics.recordAnswerBatch(newAnswers.length);
        for (const { item, acknowledgement } of outcomes) item.resolve(acknowledgement);
        await Promise.resolve();
        const cacheUpdate = Promise.allSettled([
          this.cache.set(session.state, this.liveCacheTtlSeconds(session)),
          this.cache.appendEvents(
            session.id,
            events.map((event) => ({
              seq: event.seq,
              type: event.type,
              payload: { version: eventVersions.get(event.seq) ?? session.state.version },
            })),
          ),
        ]);
        await cacheUpdate;
        const latestEvent = events.at(-1)!;
        await this.publish({ state: session.state, events: [latestEvent] }).catch(() => undefined);
        return;
      }

      for (const { item, acknowledgement } of outcomes) item.resolve(acknowledgement);
    });
  }

  async hostCommand(input: HostCommand): Promise<SessionSnapshot> {
    const commandReceivedAtMs = Date.now();
    const closesAnswerIngress = ["pause", "lock", "end"].includes(input.action);
    return this.traceOperation(
      "openround.session.host_command",
      { "openround.host.action": input.action },
      async () => {
        if (closesAnswerIngress) {
          await this.snapshot({
            sessionId: input.sessionId,
            hostToken: input.hostToken,
            role: "host",
          });
          await this.flushAnswersReceivedBy(input.sessionId, commandReceivedAtMs);
        }
        return this.mutate(input.sessionId, "host", async () => {
          const session = await this.loadSessionForMutation(input.sessionId);
          if (!session) throw new SessionError("NOT_FOUND", "Session not found");
          const staffActor = await this.authorizeStaff(session, input.hostToken, ["cohost"]);
          try {
            const commandTime = new Date(closesAnswerIngress ? commandReceivedAtMs : Date.now());
            const priorState = session.state;
            const priorRetentionExpiresAt = session.retentionExpiresAt;
            const priorPhase = session.state.phase;
            const result = applyHostCommand(session.state, {
              commandId: input.commandId,
              expectedVersion: input.expectedVersion,
              action: input.action,
              participantId: input.participantId,
              interventionType: input.interventionType,
              recheckMode: input.recheckMode,
              recheckQuestionId: input.recheckQuestionId,
              nowMs: commandTime.getTime(),
              newRoundId: randomUUID,
            });
            if (!result.duplicate) {
              const expectedVersion = session.state.version;
              session.state = result.state;
              if (priorPhase !== "finished" && session.state.phase === "finished") {
                const plan = this.config.COMMUNITY_MODE
                  ? "team"
                  : await this.repository.getPlan(session.workspaceId);
                session.retentionExpiresAt = retentionExpiry(
                  commandTime,
                  entitlementsFor(plan, this.config),
                );
              }
              const report =
                session.state.phase === "finished"
                  ? createPendingReport(session.state, session.retentionExpiresAt)
                  : undefined;
              try {
                await this.save(session, result.events, expectedVersion, report);
              } catch (error) {
                session.state = priorState;
                session.retentionExpiresAt = priorRetentionExpiresAt;
                this.active.delete(session.id);
                this.metrics.setActiveSessions(this.active.size);
                throw error;
              }
              await this.publish({
                state: session.state,
                events: result.events,
                reportId: report?.id,
              });
              await this.repository.recordAudit({
                workspaceId: session.workspaceId,
                actorId: staffActor.rootHost ? session.hostId : null,
                action: `session.command.${input.action}`,
                targetType: "game_session",
                targetId: session.id,
                requestId: input.commandId,
                metadata: staffActor.credential
                  ? {
                      staffCredentialId: staffActor.credential.id,
                      staffRole: staffActor.credential.role,
                    }
                  : {},
              });
            }
            this.metrics.recordHostCommand(
              input.action,
              result.duplicate ? "duplicate" : "applied",
            );
            return snapshotForRole(session.state, { role: "host" });
          } catch (error) {
            if (error instanceof EngineError) {
              const code = error.code === "STALE_VERSION" ? "STALE_VERSION" : "CONFLICT";
              this.metrics.recordHostCommand(input.action, code.toLocaleLowerCase("en-CA"));
              throw new SessionError(code, error.message);
            }
            this.metrics.recordHostCommand(input.action, "error");
            throw error;
          }
        });
      },
    );
  }

  async snapshot(input: {
    sessionId: string;
    participantToken?: string;
    hostToken?: string;
    role?: "participant" | "host" | "presenter";
  }) {
    const session = await this.loadSession(input.sessionId);
    if (!session) throw new SessionError("NOT_FOUND", "Session not found");
    if (input.hostToken) {
      await this.authorizeStaff(
        session,
        input.hostToken,
        input.role === "presenter" ? ["cohost", "presenter"] : ["cohost"],
      );
      return snapshotForRole(session.state, {
        role: input.role === "presenter" ? "presenter" : "host",
      });
    }
    if (input.participantToken) {
      const participant = await this.participantForToken(input.participantToken);
      if (!participant || participant.sessionId !== session.id) {
        throw new SessionError("UNAUTHORIZED", "Participant token is invalid");
      }
      return snapshotForRole(session.state, { role: "participant", participantId: participant.id });
    }
    throw new SessionError("UNAUTHORIZED", "A session credential is required");
  }

  async sync(input: SyncRequest): Promise<SyncResponse> {
    let snapshot: SessionSnapshot;
    if (input.role === "participant" && input.participantToken) {
      const participant = await this.participantForToken(input.participantToken);
      if (!participant || participant.sessionId !== input.sessionId) {
        throw new SessionError("UNAUTHORIZED", "Participant token is invalid");
      }
      snapshot = await this.reconnectParticipant(participant);
    } else {
      snapshot = await this.snapshot(input);
    }
    const cached =
      input.lastSeq < snapshot.seq
        ? await this.cache.readEvents(input.sessionId, input.lastSeq, 1_000)
        : [];
    const replay = cached.map((event) => {
      const payloadVersion = (event.payload as { version?: unknown } | null)?.version;
      return {
        eventId: `${input.sessionId}:${event.seq}`,
        sessionId: input.sessionId,
        sessionVersion:
          typeof payloadVersion === "number" && Number.isSafeInteger(payloadVersion)
            ? payloadVersion
            : snapshot.version,
        seq: event.seq,
        type: event.type,
        schemaVersion: 1 as const,
        serverTime: event.serverTime,
        payload: event.payload,
      };
    });
    const replayComplete =
      input.lastSeq === snapshot.seq ||
      (replay.length > 0 &&
        replay[0]!.seq === input.lastSeq + 1 &&
        replay.at(-1)!.seq === snapshot.seq);
    this.metrics.recordSync(input.role, replayComplete, replay.length);
    return { snapshot, replay, replayComplete };
  }

  private async reconnectParticipant(participant: ParticipantRecord): Promise<SessionSnapshot> {
    return this.mutate(participant.sessionId, "resume", async () => {
      const session = await this.loadSessionForMutation(participant.sessionId);
      if (!session) throw new SessionError("INVALID_CODE", "Session is no longer available");
      const current = session.state.participants[participant.id];
      if (!current || current.kicked || participant.status === "kicked") {
        throw new SessionError("UNAUTHORIZED", "Participant access has been revoked");
      }
      if (!current.connected) {
        const expectedVersion = session.state.version;
        const result = setParticipantConnection(session.state, participant.id, true);
        session.state = result.state;
        await this.save(session, result.events, expectedVersion);
        await this.publish({ state: session.state, events: result.events });
      }
      return snapshotForRole(session.state, {
        role: "participant",
        participantId: participant.id,
      });
    });
  }

  async deleteSession(workspaceId: string, sessionId: string) {
    return this.mutate(sessionId, "delete", async () => {
      const session = await this.loadSessionForMutation(sessionId);
      const deleted = await this.repository.deleteSession(workspaceId, sessionId);
      if (deleted) {
        if (session) {
          await this.cache
            .releaseSessionCode(session.state.code, session.id)
            .catch(() => undefined);
        }
        await this.invalidate([sessionId]);
      }
      return deleted;
    });
  }

  async invalidate(sessionIds: string[]) {
    const uniqueSessionIds = [...new Set(sessionIds)];
    for (const sessionId of uniqueSessionIds) {
      const timer = this.timers.get(sessionId);
      if (timer) clearTimeout(timer);
      this.timers.delete(sessionId);
      this.active.delete(sessionId);
      for (const [tokenHash, participant] of this.participantCredentials) {
        if (participant.sessionId === sessionId) this.participantCredentials.delete(tokenHash);
      }
    }
    this.metrics.setActiveSessions(this.active.size);
    const cacheDeletes = await Promise.allSettled(
      uniqueSessionIds.map((sessionId) => this.cache.delete(sessionId)),
    );
    const failures = cacheDeletes
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length > 0) {
      throw new AggregateError(failures, "One or more session cache entries could not be deleted");
    }
  }

  async authorizeMedia(sessionId: string, mediaId: string, credential: string) {
    const session = await this.loadSession(sessionId);
    if (!session) throw new SessionError("NOT_FOUND", "Session not found");
    const referenced = session.state.quiz.questions.some(
      (question) => question.mediaId === mediaId,
    );
    if (!referenced) throw new SessionError("NOT_FOUND", "Media is not part of this session");
    if (safeHashEqual(session.hostTokenHash, hashToken(credential))) return session.workspaceId;
    const staff = await this.staffForTokenHash(hashToken(credential));
    if (staff?.sessionId === session.id && staff.workspaceId === session.workspaceId) {
      return session.workspaceId;
    }
    const participant = await this.participantForToken(credential);
    const participantState = participant ? session.state.participants[participant.id] : null;
    if (
      !participant ||
      participant.sessionId !== sessionId ||
      !participantState ||
      participantState.kicked
    ) {
      throw new SessionError("UNAUTHORIZED", "Session credential is invalid");
    }
    return session.workspaceId;
  }

  async disconnect(participantToken: string) {
    const participant = await this.participantForToken(participantToken);
    if (!participant) return;
    await this.mutate(participant.sessionId, "disconnect", async () => {
      const session = await this.loadSessionForMutation(participant.sessionId);
      if (!session || !session.state.participants[participant.id]) return;
      if (!session.state.participants[participant.id]!.connected) return;
      const expectedVersion = session.state.version;
      const result = setParticipantConnection(session.state, participant.id, false);
      session.state = result.state;
      await this.save(session, result.events, expectedVersion);
      await this.publish({ state: session.state, events: result.events });
    });
  }

  envelope<T>(state: GameState, event: EngineEvent, payload: T): EventEnvelope<T> {
    return {
      eventId: `${state.sessionId}:${event.seq}`,
      sessionId: state.sessionId,
      sessionVersion: state.version,
      seq: event.seq,
      type: event.type,
      schemaVersion: 1,
      serverTime: new Date().toISOString(),
      payload,
    };
  }

  close() {
    this.closing = true;
    for (const batch of this.joinBatches.values()) {
      clearTimeout(batch.timer);
      for (const item of batch.items) {
        item.reject(new SessionError("CONFLICT", "The server is shutting down"));
      }
    }
    this.joinBatches.clear();
    for (const batch of this.answerBatches.values()) {
      clearTimeout(batch.timer);
      for (const item of batch.items) {
        item.reject(new SessionError("CONFLICT", "The server is shutting down"));
      }
    }
    this.answerBatches.clear();
    this.answerIngress.clear();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.active.clear();
    this.participantCredentials.clear();
    this.metrics.setActiveSessions(0);
  }
}

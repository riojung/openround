import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import {
  PresentationParticipantSnapshotSchema,
  PresentationReportEnvelopeSchema,
  PresentationReportV1Schema,
  type PresentationCommand,
  type PresentationHostSnapshot,
  type PresentationParticipantSnapshot,
  type PresentationResponseAck,
  type PresentationResponseSubmit,
  type PresentationRoleSnapshot,
  type PresentationSessionResponse,
  type PresentationSyncRequest,
  type PresentationSyncResponse,
  type QuestionDraft,
  questionTypeDefinition,
} from "@openround/contracts";
import {
  PresentationSessionConflictError,
  SessionCodeConflictError,
  type PresentationRepository,
  type PresentationResponseAcknowledgementState,
  type PresentationSessionRecord,
  type PresentationSessionRepository,
  type PresentationSessionResponseRecord,
  type Repository,
} from "@openround/db";
import type { AppConfig } from "./config.js";
import { entitlementsFor, retentionExpiry } from "./entitlements.js";
import type { ProductEventDispatcher, ProductEventInput } from "./product-events.js";
import { generatePresentationReport } from "./presentation-reporting.js";
import {
  buildPresentationCompanionSnapshot,
  buildPresentationHostSnapshot,
  buildPresentationListSnapshot,
  buildPresentationParticipantSnapshot,
  buildPresentationProjectionData,
  buildTargetedPresentationParticipantSnapshot,
  presentationCurrentBlock,
  type PresentationProjectionData,
} from "./presentation-session-projections.js";
import type { StorageService } from "./storage.js";

const PRESENTATION_SESSION_LIFETIME_MS = 24 * 60 * 60 * 1_000;

export {
  presentationCurrentBlock,
  presentationParticipantBlock,
} from "./presentation-session-projections.js";

export type PresentationSessionServiceErrorCode =
  | "NOT_FOUND"
  | "PHASE_CLOSED"
  | "PARTICIPANT_LIMIT"
  | "INSTITUTION_AUTH_REQUIRED"
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR"
  | "STALE_SESSION"
  | "IDEMPOTENCY_CONFLICT"
  | "ALREADY_RESPONDED"
  | "REPORT_UNAVAILABLE";

export class PresentationSessionServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: PresentationSessionServiceErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PresentationSessionServiceError";
  }
}

/**
 * Aggregate reads raced durable room mutations too many times to construct one coherent
 * projection. This is deliberately distinct from a missing credential: transports should retry
 * the room projection without disconnecting otherwise-authorized sockets.
 */
export class PresentationBroadcastConsistencyError extends Error {
  constructor(public readonly sessionId: string) {
    super("Presentation room changed while its broadcast snapshot was being built");
    this.name = "PresentationBroadcastConsistencyError";
  }
}

export interface SubmitPresentationResponseInput {
  sessionId: string;
  participantToken: string;
  blockId: string;
  expectedRevision: number;
  idempotencyKey: string;
  response: PresentationSessionResponse;
  /** Server ingress time, captured before feature/auth/database work. */
  receivedAt?: Date;
}

export type PresentationHashedSyncRequest =
  | {
      sessionId: string;
      projection: "participant";
      participantTokenHash: string;
      afterSeq?: number;
    }
  | { sessionId: string; projection: "host"; controlTokenHash: string; afterSeq?: number }
  | { sessionId: string; projection: "companion"; companionTokenHash: string; afterSeq?: number };

export type PresentationConnectedParticipantIdsProvider = (
  sessionId: string,
) => Promise<ReadonlySet<string>>;

export function presentationParticipantTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function presentationCredentialToken() {
  return `${randomUUID()}.${randomBytes(24).toString("base64url")}`;
}

function presentationResponseRequestHash(
  input: Pick<SubmitPresentationResponseInput, "blockId" | "expectedRevision" | "response">,
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        blockId: input.blockId,
        expectedRevision: input.expectedRevision,
        response: {
          choiceIds: [...(input.response.choiceIds ?? [])].sort(),
          numericValue: input.response.numericValue ?? null,
          ratingValue: input.response.ratingValue ?? null,
          confidence: input.response.confidence ?? null,
        },
      }),
    )
    .digest("hex");
}

export function presentationLiveSessionExpired(
  session: PresentationSessionRecord,
  now = new Date(),
) {
  return session.liveExpiresAt.getTime() <= now.getTime();
}

function responseTiming(session: PresentationSessionRecord, receivedAt: Date) {
  const block = presentationCurrentBlock(session);
  if (block?.kind !== "question") return { responseMs: 0, remainingRatio: 0 };
  const durationMs = block.question.timeLimitSeconds * 1_000;
  if (!session.questionOpenedAt) {
    return {
      responseMs: durationMs,
      remainingRatio: session.settings.timeMode === "flex" ? 1 : 0,
    };
  }
  const responseMs = Math.max(
    0,
    Math.min(durationMs, receivedAt.getTime() - session.questionOpenedAt.getTime()),
  );
  return {
    responseMs,
    remainingRatio:
      session.settings.timeMode === "flex" ? 1 : Math.max(0, 1 - responseMs / durationMs),
  };
}

function responseScore(question: QuestionDraft, correct: boolean | null, remainingRatio: number) {
  if (!correct || !questionTypeDefinition(question.type).scored) return 0;
  return Math.round(question.basePoints * (0.5 + remainingRatio * 0.5));
}

function validateResponse(question: QuestionDraft, response: PresentationSessionResponse) {
  if (question.confidence === "required" && response.confidence == null) {
    throw new PresentationSessionServiceError(
      422,
      "VALIDATION_ERROR",
      "Choose a confidence level before submitting",
    );
  }
  if (question.type === "numeric") {
    const value = Number(response.numericValue);
    if (
      response.numericValue === undefined ||
      response.numericValue.trim() === "" ||
      !Number.isFinite(value)
    ) {
      throw new PresentationSessionServiceError(
        422,
        "VALIDATION_ERROR",
        "Enter a valid numeric response",
      );
    }
    return;
  }
  if (question.type === "rating") {
    if (
      response.ratingValue === undefined ||
      response.ratingValue < question.min ||
      response.ratingValue > question.max
    ) {
      throw new PresentationSessionServiceError(
        422,
        "VALIDATION_ERROR",
        `Choose a rating from ${question.min} to ${question.max}`,
      );
    }
    return;
  }
  const selected = response.choiceIds ?? [];
  const validIds = new Set(question.choices.map((choice) => choice.id));
  if (!selected.length || selected.some((choiceId) => !validIds.has(choiceId))) {
    throw new PresentationSessionServiceError(
      422,
      "VALIDATION_ERROR",
      "Choose a valid response option",
    );
  }
  if (question.type !== "multi_select" && selected.length !== 1) {
    throw new PresentationSessionServiceError(
      422,
      "VALIDATION_ERROR",
      "Choose one response option",
    );
  }
}

function responseCorrect(
  question: QuestionDraft,
  response: PresentationSessionResponse,
): boolean | null {
  if (question.type === "poll" || question.type === "rating") return null;
  if (question.type === "numeric") {
    const actual = Number(response.numericValue);
    const expected = Number(question.correctValue);
    const tolerance = Number(question.tolerance || 0);
    return Math.abs(actual - expected) <= tolerance;
  }
  const selected = new Set(response.choiceIds ?? []);
  const correct = new Set(
    question.choices.filter((choice) => choice.isCorrect).map((choice) => choice.id),
  );
  return selected.size === correct.size && [...selected].every((choiceId) => correct.has(choiceId));
}

function nextTransition(session: PresentationSessionRecord) {
  const blocks = session.content.blocks;
  if (session.phase === "finished") return null;
  if (session.phase === "question_open") {
    const block = blocks[session.currentBlockIndex]!;
    return {
      phase: "question_reveal" as const,
      currentBlockIndex: session.currentBlockIndex,
      status: "active" as const,
      event: {
        type: "question.revealed" as const,
        blockIndex: session.currentBlockIndex,
        blockId: block.id,
      },
    };
  }
  if (session.phase === "question_reveal") {
    const block = blocks[session.currentBlockIndex];
    if (
      block?.kind === "question" &&
      (block.question.delivery ?? "main") === "main" &&
      block.question.linkedRecheckQuestionId
    ) {
      return {
        phase: "intervention" as const,
        currentBlockIndex: session.currentBlockIndex,
        status: "active" as const,
        event: {
          type: "intervention.presented" as const,
          blockIndex: session.currentBlockIndex,
          blockId: block.id,
        },
      };
    }
  }
  const nextIndex = session.phase === "lobby" ? 0 : session.currentBlockIndex + 1;
  const next = blocks[nextIndex];
  if (!next) {
    return {
      phase: "finished" as const,
      currentBlockIndex: Math.max(session.currentBlockIndex, 0),
      status: "finished" as const,
      event: {
        type: "presentation.finished" as const,
        blockIndex: null,
        blockId: null,
      },
    };
  }
  return {
    phase: next.kind === "content" ? ("content" as const) : ("question_open" as const),
    currentBlockIndex: nextIndex,
    status: "active" as const,
    event: {
      type:
        next.kind === "content" ? ("content.presented" as const) : ("question.launched" as const),
      blockIndex: nextIndex,
      blockId: next.id,
    },
  };
}

export class PresentationSessionService {
  private connectedParticipantIdsProvider: PresentationConnectedParticipantIdsProvider | null =
    null;

  constructor(
    private readonly dependencies: {
      repository: Repository;
      presentations: PresentationRepository;
      sessions: PresentationSessionRepository;
      config: Pick<
        AppConfig,
        | "COMMUNITY_MODE"
        | "COMMUNITY_REPORT_RETENTION_DAYS"
        | "MAX_SESSION_PARTICIPANTS"
        | "MAX_PRACTICE_PERSONAL_LINKS"
      >;
      storage: StorageService;
      productEvents?: ProductEventDispatcher;
      productEventsEnabled?: (workspaceId: string) => boolean;
    },
  ) {}

  private get sessions() {
    return this.dependencies.sessions;
  }

  private recordProductEvents(workspaceId: string, events: ProductEventInput[]) {
    if (
      events.length === 0 ||
      !this.dependencies.productEvents ||
      !this.dependencies.productEventsEnabled?.(workspaceId)
    ) {
      return;
    }
    this.dependencies.productEvents.enqueue({ workspaceId, events });
  }

  private recordAcceptedTransitionProductEvents(
    session: PresentationSessionRecord,
    transition: NonNullable<ReturnType<typeof nextTransition>>,
  ) {
    const occurredAt = session.updatedAt.toISOString();
    if (transition.event.type === "intervention.presented") {
      this.recordProductEvents(session.workspaceId, [
        {
          name: "intervention_started",
          occurredAt,
          dimensions: { artifactType: "presentation" },
        },
      ]);
      return;
    }
    const block = presentationCurrentBlock(session);
    if (
      transition.event.type === "question.launched" &&
      block?.kind === "question" &&
      (block.question.delivery ?? "main") === "recheck"
    ) {
      this.recordProductEvents(session.workspaceId, [
        {
          name: "linked_recheck_opened",
          occurredAt,
          dimensions: { artifactType: "presentation" },
        },
      ]);
    }
  }

  /**
   * Supplies transport presence for staff-only REST projections. Socket.IO owns this view because
   * it can query every adapter node without turning routine fan-out into participant-row writes.
   */
  setConnectedParticipantIdsProvider(provider: PresentationConnectedParticipantIdsProvider | null) {
    this.connectedParticipantIdsProvider = provider;
  }

  private async uniqueJoinCode() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = String(randomInt(0, 10_000_000)).padStart(7, "0");
      if (!(await this.dependencies.repository.getLiveRoomCode(code))) return code;
    }
    throw new Error("Unable to allocate a presentation join code");
  }

  async listHostSnapshots(workspaceId: string) {
    const sessions = await this.sessions.listSessions(workspaceId, new Date());
    return Promise.all(sessions.map((session) => this.hostSnapshot(session)));
  }

  async createSession(input: {
    workspaceId: string;
    userId: string;
    presentationId: string;
    requestId: string;
  }) {
    const institutionPolicy = await this.dependencies.repository.getInstitutionPolicy(
      input.workspaceId,
    );
    if (institutionPolicy.identityRequirement === "institution") {
      throw new PresentationSessionServiceError(
        403,
        "INSTITUTION_AUTH_REQUIRED",
        "Institution-identified Presentation participation is not enabled in this release",
      );
    }
    const presentation = await this.dependencies.presentations.getPresentation(
      input.workspaceId,
      input.presentationId,
    );
    if (!presentation) {
      throw new PresentationSessionServiceError(404, "NOT_FOUND", "Presentation not found");
    }
    if (!presentation.currentVersionId) {
      throw new PresentationSessionServiceError(
        422,
        "VALIDATION_ERROR",
        "Publish this Presentation before hosting it",
      );
    }
    const version = await this.dependencies.presentations.getPresentationVersion(
      input.workspaceId,
      presentation.currentVersionId,
    );
    if (!version) {
      throw new PresentationSessionServiceError(
        404,
        "NOT_FOUND",
        "Published Presentation not found",
      );
    }
    const now = new Date();
    const plan = await this.dependencies.repository.getPlan(input.workspaceId);
    let session: PresentationSessionRecord | null = null;
    let controlToken: string | null = null;
    let controlCredentialId: string | null = null;
    for (let attempt = 0; attempt < 20 && !session; attempt += 1) {
      const candidateSessionId = randomUUID();
      const candidateControlToken = presentationCredentialToken();
      try {
        const liveExpiresAt = new Date(now.getTime() + PRESENTATION_SESSION_LIFETIME_MS);
        const created = await this.sessions.createSessionWithCredential(
          {
            id: candidateSessionId,
            workspaceId: input.workspaceId,
            presentationId: presentation.id,
            presentationVersionId: version.id,
            title: version.content.title,
            content: version.content,
            code: await this.uniqueJoinCode(),
            status: "active",
            phase: "lobby",
            currentBlockIndex: -1,
            revision: 0,
            settings: { timeMode: "timed" },
            trustMode: "learning",
            eventSeq: 0,
            questionOpenedAt: null,
            questionClosesAt: null,
            createdBy: input.userId,
            createdAt: now,
            updatedAt: now,
            finishedAt: null,
            liveExpiresAt,
            retentionExpiresAt: retentionExpiry(
              now,
              entitlementsFor(plan, this.dependencies.config),
            ),
          },
          {
            id: randomUUID(),
            workspaceId: input.workspaceId,
            sessionId: candidateSessionId,
            role: "host",
            tokenHash: presentationParticipantTokenHash(candidateControlToken),
            createdAt: now,
            expiresAt: liveExpiresAt,
            revokedAt: null,
          },
        );
        session = created.session;
        controlToken = candidateControlToken;
        controlCredentialId = created.credential.id;
      } catch (error) {
        const databaseError = error as { code?: string; constraint?: string; message?: string };
        const codeConflict =
          error instanceof SessionCodeConflictError ||
          (databaseError.code === "23505" &&
            (databaseError.constraint === "live_room_codes_pkey" ||
              databaseError.constraint === "presentation_live_sessions_join_code_key"));
        if (!codeConflict && !/join code already exists/i.test(databaseError.message ?? "")) {
          throw error;
        }
      }
    }
    if (!session || !controlToken || !controlCredentialId) {
      throw new Error("Unable to allocate a presentation join code");
    }
    // The session and its first credential are already durable. Audit failure must not turn a
    // successful creation into an orphaned room whose credential was never delivered.
    await this.dependencies.repository
      .recordAudit({
        workspaceId: input.workspaceId,
        actorId: input.userId,
        action: "presentation.session.create",
        targetType: "presentation_live_session",
        targetId: session.id,
        requestId: input.requestId,
        metadata: { presentationId: presentation.id, presentationVersionId: version.id },
      })
      .catch(() => undefined);
    return {
      snapshot: await this.restHostSnapshot(session),
      controlToken,
      controlCredentialId,
    };
  }

  async createControlPass(input: {
    workspaceId: string;
    userId: string;
    sessionId: string;
    requestId: string;
  }) {
    const session = await this.sessions.getSessionForWorkspace(input.workspaceId, input.sessionId);
    if (!session) {
      throw new PresentationSessionServiceError(404, "NOT_FOUND", "Presentation session not found");
    }
    if (presentationLiveSessionExpired(session)) {
      throw new PresentationSessionServiceError(
        409,
        "PHASE_CLOSED",
        "This Presentation session has expired",
      );
    }
    const controlToken = presentationCredentialToken();
    const credential = await this.sessions.rotateCredential({
      id: randomUUID(),
      workspaceId: session.workspaceId,
      sessionId: session.id,
      role: "host",
      tokenHash: presentationParticipantTokenHash(controlToken),
      createdAt: new Date(),
      expiresAt: session.liveExpiresAt,
      revokedAt: null,
    });
    await this.dependencies.repository.recordAudit({
      workspaceId: input.workspaceId,
      actorId: input.userId,
      action: "presentation.session.control_pass.create",
      targetType: "presentation_live_session",
      targetId: session.id,
      requestId: input.requestId,
      metadata: { credentialId: credential.id },
    });
    return {
      credentialId: credential.id,
      controlToken,
      expiresAt: credential.expiresAt.toISOString(),
    };
  }

  async revokeControlPass(input: {
    workspaceId: string;
    userId: string;
    sessionId: string;
    credentialId: string;
    requestId: string;
  }) {
    const session = await this.sessions.getSessionForWorkspace(input.workspaceId, input.sessionId);
    if (!session) {
      throw new PresentationSessionServiceError(404, "NOT_FOUND", "Presentation session not found");
    }
    const credential = await this.sessions.revokeCredential(
      input.workspaceId,
      input.sessionId,
      input.credentialId,
      new Date(),
      "host",
    );
    if (!credential) {
      throw new PresentationSessionServiceError(404, "NOT_FOUND", "Control pass not found");
    }
    await this.dependencies.repository.recordAudit({
      workspaceId: input.workspaceId,
      actorId: input.userId,
      action: "presentation.session.control_pass.revoke",
      targetType: "presentation_live_session",
      targetId: input.sessionId,
      requestId: input.requestId,
      metadata: { credentialId: credential.id },
    });
  }

  async getHostSnapshot(workspaceId: string, sessionId: string) {
    const session = await this.sessions.getSessionForWorkspace(workspaceId, sessionId);
    if (!session) {
      throw new PresentationSessionServiceError(404, "NOT_FOUND", "Presentation session not found");
    }
    if (presentationLiveSessionExpired(session)) {
      throw new PresentationSessionServiceError(
        409,
        "PHASE_CLOSED",
        "This Presentation session has expired",
      );
    }
    return this.restHostSnapshot(session);
  }

  async advance(input: {
    workspaceId: string;
    userId: string;
    sessionId: string;
    expectedRevision: number;
    requestId: string;
  }) {
    const session = await this.sessions.getSessionForWorkspace(input.workspaceId, input.sessionId);
    if (!session) {
      throw new PresentationSessionServiceError(404, "NOT_FOUND", "Presentation session not found");
    }
    if (presentationLiveSessionExpired(session)) {
      throw new PresentationSessionServiceError(
        409,
        "PHASE_CLOSED",
        "This Presentation session has expired",
      );
    }
    if (input.expectedRevision !== session.revision) {
      throw this.staleSession(input.expectedRevision, session.revision);
    }
    const transition = nextTransition(session);
    if (!transition) return this.restHostSnapshot(session);
    try {
      const transitionRetentionExpiresAt =
        transition.status === "finished"
          ? retentionExpiry(
              new Date(),
              entitlementsFor(
                await this.dependencies.repository.getPlan(input.workspaceId),
                this.dependencies.config,
              ),
            )
          : undefined;
      const updated = await this.sessions.transitionSession({
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        expectedRevision: input.expectedRevision,
        ...transition,
        ...(transitionRetentionExpiresAt
          ? { retentionExpiresAt: transitionRetentionExpiresAt }
          : {}),
      });
      if (!updated) {
        throw new PresentationSessionServiceError(
          404,
          "NOT_FOUND",
          "Presentation session not found",
        );
      }
      this.recordAcceptedTransitionProductEvents(updated, transition);
      if (updated.status === "finished") {
        await this.dependencies.repository.recordAudit({
          workspaceId: input.workspaceId,
          actorId: input.userId,
          action: "presentation.session.finish",
          targetType: "presentation_live_session",
          targetId: updated.id,
          requestId: input.requestId,
        });
      }
      return this.restHostSnapshot(updated);
    } catch (error) {
      if (error instanceof PresentationSessionConflictError) {
        throw this.staleSession(error.expectedRevision, error.currentRevision);
      }
      throw error;
    }
  }

  async join(code: string, nickname: string) {
    const session = await this.sessions.getSessionByCode(code);
    if (!session || session.status === "finished" || presentationLiveSessionExpired(session)) {
      throw new PresentationSessionServiceError(404, "NOT_FOUND", "Active Presentation not found");
    }
    const institutionPolicy = await this.dependencies.repository.getInstitutionPolicy(
      session.workspaceId,
    );
    if (institutionPolicy.identityRequirement === "institution") {
      throw new PresentationSessionServiceError(
        403,
        "INSTITUTION_AUTH_REQUIRED",
        "This workspace requires institution identity; anonymous code entry is disabled",
      );
    }
    const participantToken = `${randomUUID()}.${randomBytes(24).toString("base64url")}`;
    const now = new Date();
    const plan = await this.dependencies.repository.getPlan(session.workspaceId);
    const participantLimit = entitlementsFor(plan, this.dependencies.config).maxParticipants;
    const joined = await this.sessions.joinParticipantWithinLimit(
      {
        id: randomUUID(),
        workspaceId: session.workspaceId,
        sessionId: session.id,
        nickname,
        tokenHash: presentationParticipantTokenHash(participantToken),
        joinedAt: now,
        lastSeenAt: now,
      },
      participantLimit,
    );
    if (joined.status === "closed") {
      throw new PresentationSessionServiceError(404, "NOT_FOUND", "Active Presentation not found");
    }
    if (joined.status === "full") {
      throw new PresentationSessionServiceError(
        409,
        "PARTICIPANT_LIMIT",
        "This Presentation is full",
      );
    }
    this.recordProductEvents(session.workspaceId, [
      {
        name: "participant_joined",
        occurredAt: joined.participant.joinedAt.toISOString(),
        dimensions: { artifactType: "presentation" },
      },
    ]);
    const currentSession = await this.sessions.getSessionById(session.id);
    if (!currentSession) {
      throw new PresentationSessionServiceError(404, "NOT_FOUND", "Active Presentation not found");
    }
    return {
      workspaceId: currentSession.workspaceId,
      participantToken,
      snapshot: await this.realtimeParticipantSnapshot(currentSession, joined.participant.id),
    };
  }

  async getParticipantSnapshot(sessionId: string, token: string) {
    const { session, participantId } = await this.authorizeParticipant(sessionId, token);
    return {
      workspaceId: session.workspaceId,
      snapshot: await this.realtimeParticipantSnapshot(session, participantId),
    };
  }

  async getParticipantMedia(sessionId: string, mediaId: string, token: string) {
    const { session } = await this.authorizeParticipant(sessionId, token);
    return this.getCurrentMedia(session, mediaId);
  }

  async getHostMedia(workspaceId: string, sessionId: string, mediaId: string) {
    const session = await this.sessions.getSessionForWorkspace(workspaceId, sessionId);
    if (!session || presentationLiveSessionExpired(session)) {
      throw new PresentationSessionServiceError(404, "NOT_FOUND", "Media not found");
    }
    return this.getCurrentMedia(session, mediaId);
  }

  private async getCurrentMedia(session: PresentationSessionRecord, mediaId: string) {
    const block = presentationCurrentBlock(session);
    const referenced =
      block?.kind === "content"
        ? block.mediaId === mediaId
        : block?.kind === "question"
          ? block.question.mediaId === mediaId
          : false;
    if (!referenced) {
      throw new PresentationSessionServiceError(404, "NOT_FOUND", "Media not found");
    }
    const asset = await this.dependencies.repository.getMediaAsset(session.workspaceId, mediaId);
    if (!asset || asset.scanStatus !== "clean") {
      throw new PresentationSessionServiceError(404, "NOT_FOUND", "Media not found");
    }
    return {
      workspaceId: session.workspaceId,
      media: { id: asset.id, scanStatus: asset.scanStatus },
      downloadUrl: await this.dependencies.storage.createDownloadUrl(asset),
    };
  }

  async sync(input: PresentationSyncRequest): Promise<PresentationSyncResponse> {
    let authorizedSession: PresentationSessionRecord;
    let participantId: string | null = null;
    let snapshot: PresentationRoleSnapshot;
    if (input.projection === "participant") {
      const authorized = await this.authorizeParticipant(input.sessionId, input.participantToken);
      authorizedSession = authorized.session;
      participantId = authorized.participantId;
    } else if (input.projection === "host") {
      authorizedSession = await this.authorizeCredential(
        input.sessionId,
        input.controlToken,
        "host",
      );
    } else {
      authorizedSession = await this.authorizeCredential(
        input.sessionId,
        input.companionToken,
        "companion",
      );
    }
    const projection = await this.consistentProjection(authorizedSession);
    if (!projection) {
      throw new PresentationSessionServiceError(
        401,
        "UNAUTHORIZED",
        input.projection === "participant"
          ? "Participant credential is invalid"
          : "Presentation control credential is invalid",
      );
    }
    if (input.projection === "participant") {
      snapshot = await this.realtimeParticipantSnapshot(
        projection.session,
        participantId!,
        projection.data,
      );
    } else if (input.projection === "host") {
      snapshot = await this.realtimeHostSnapshot(projection.session, projection.data);
    } else {
      snapshot = await this.realtimeCompanionSnapshot(projection.session, projection.data);
    }
    return {
      resetRequired: (input.afterSeq ?? 0) !== snapshot.seq,
      events: [],
      snapshot,
    };
  }

  /**
   * Builds a room broadcast from one aggregate read. Explicit sync still refreshes last-seen, but
   * routine fan-out must not turn 250 connected participants into hundreds of database writes and
   * repeated full-response scans for every accepted answer.
   */
  async syncManyByCredentialHash(
    inputs: PresentationHashedSyncRequest[],
    connectedParticipantIds: ReadonlySet<string> = new Set(),
  ): Promise<Array<PresentationSyncResponse | null>> {
    if (!inputs.length) return [];
    const sessionIds = new Set(inputs.map(({ sessionId }) => sessionId));
    if (sessionIds.size !== 1) {
      return inputs.map(() => null);
    }
    const sessionId = inputs[0]!.sessionId;
    let session = await this.sessions.getSessionById(sessionId);
    if (!session || presentationLiveSessionExpired(session)) return inputs.map(() => null);
    const projection = await this.consistentProjection(session);
    if (!projection) return inputs.map(() => null);
    session = projection.session;
    const data = projection.data;
    const participantByTokenHash = new Map(
      data.participants.map((participant) => [participant.tokenHash, participant]),
    );
    let hostSnapshot: PresentationHostSnapshot | null = null;
    let companionSnapshot: PresentationRoleSnapshot | null = null;

    return Promise.all(
      inputs.map(async (input): Promise<PresentationSyncResponse | null> => {
        try {
          let snapshot: PresentationRoleSnapshot;
          if (input.projection === "participant") {
            const participant = participantByTokenHash.get(input.participantTokenHash);
            if (!participant) return null;
            snapshot = await this.realtimeParticipantSnapshot(session, participant.id, data);
          } else if (input.projection === "host") {
            await this.authorizeCredentialHash(input.sessionId, input.controlTokenHash, "host");
            hostSnapshot ??= await this.realtimeHostSnapshot(
              session,
              data,
              connectedParticipantIds,
            );
            snapshot = hostSnapshot;
          } else {
            await this.authorizeCredentialHash(
              input.sessionId,
              input.companionTokenHash,
              "companion",
            );
            companionSnapshot ??= await this.realtimeCompanionSnapshot(
              session,
              data,
              connectedParticipantIds,
            );
            snapshot = companionSnapshot;
          }
          return {
            resetRequired: (input.afterSeq ?? 0) !== snapshot.seq,
            events: [],
            snapshot,
          };
        } catch {
          return null;
        }
      }),
    );
  }

  async command(input: PresentationCommand): Promise<PresentationHostSnapshot> {
    const session = await this.authorizeCredential(input.sessionId, input.controlToken, "host");
    const transition = nextTransition(session);
    if (!transition) return this.realtimeHostSnapshot(session);
    try {
      const transitionRetentionExpiresAt =
        transition.status === "finished"
          ? retentionExpiry(
              new Date(),
              entitlementsFor(
                await this.dependencies.repository.getPlan(session.workspaceId),
                this.dependencies.config,
              ),
            )
          : undefined;
      const accepted = await this.sessions.transitionSessionCommand({
        workspaceId: session.workspaceId,
        sessionId: session.id,
        commandId: input.commandId,
        expectedRevision: input.expectedRevision,
        ...transition,
        ...(transitionRetentionExpiresAt
          ? { retentionExpiresAt: transitionRetentionExpiresAt }
          : {}),
      });
      if (accepted.status === "not_found") {
        throw new PresentationSessionServiceError(
          404,
          "NOT_FOUND",
          "Presentation session not found",
        );
      }
      if (accepted.status === "idempotency_conflict") {
        throw new PresentationSessionServiceError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "This command key was already used for a different request",
        );
      }
      if (accepted.status === "accepted" && accepted.session.status === "finished") {
        await this.dependencies.repository.recordAudit({
          workspaceId: accepted.session.workspaceId,
          actorId: null,
          action: "presentation.session.finish",
          targetType: "presentation_live_session",
          targetId: accepted.session.id,
          requestId: input.commandId,
        });
      }
      if (accepted.status === "accepted") {
        this.recordAcceptedTransitionProductEvents(accepted.session, transition);
      }
      return this.realtimeHostSnapshot(accepted.session);
    } catch (error) {
      if (error instanceof PresentationSessionConflictError) {
        throw this.staleSession(error.expectedRevision, error.currentRevision);
      }
      throw error;
    }
  }

  async submitResponse(
    input: SubmitPresentationResponseInput | (PresentationResponseSubmit & { receivedAt?: Date }),
  ): Promise<PresentationResponseAck> {
    // Capture receipt before reads/validation so network or database latency cannot improve a score
    // or admit an answer after the server-side close instant.
    const receivedAt = input.receivedAt ?? new Date();
    const requestHash = presentationResponseRequestHash(input);
    const context = await this.sessions.getResponseContext(
      input.sessionId,
      presentationParticipantTokenHash(input.participantToken),
      input.idempotencyKey,
    );
    if (!context || presentationLiveSessionExpired(context.session, receivedAt)) {
      throw new PresentationSessionServiceError(
        401,
        "UNAUTHORIZED",
        "Participant credential is invalid",
      );
    }
    const { session, participant, priorResponse } = context;
    const acknowledgePriorReceipt = async (
      knownReceipt?: PresentationSessionResponseRecord | null,
    ): Promise<PresentationResponseAck | null> => {
      const receipt =
        knownReceipt ??
        (await this.sessions.findResponseByIdempotencyKey(
          input.sessionId,
          participant.id,
          input.idempotencyKey,
        ));
      if (!receipt) return null;
      if (receipt.requestHash && receipt.requestHash !== requestHash) {
        throw new PresentationSessionServiceError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "This response key was already used for a different request",
        );
      }
      const duplicate = await this.sessions.acceptResponse(receipt, input.expectedRevision);
      if (duplicate.status !== "duplicate") {
        throw new Error("Durable Presentation response receipt could not be acknowledged");
      }
      return this.responseAcknowledgement(
        duplicate.acknowledgement,
        participant.id,
        duplicate.response,
        input.idempotencyKey,
        true,
      );
    };
    if (priorResponse) {
      return (await acknowledgePriorReceipt(priorResponse))!;
    }
    // Resolve the submitted block independently from the current pointer. The repository checks a
    // matching idempotency receipt before its live phase/revision fence, allowing a lost ack to be
    // recovered after the host advances without ever applying the payload to the next question.
    const submittedBlock = session.content.blocks.find((block) => block.id === input.blockId);
    if (submittedBlock?.kind !== "question") {
      const replayed = await acknowledgePriorReceipt();
      if (replayed) return replayed;
      throw new PresentationSessionServiceError(
        409,
        "STALE_SESSION",
        "This question changed before the response was saved. Refresh before trying again.",
        {
          expectedBlockId: input.blockId,
          currentBlockId: presentationCurrentBlock(session)?.id ?? null,
          expectedRevision: input.expectedRevision,
          currentRevision: session.revision,
        },
      );
    }
    try {
      validateResponse(submittedBlock.question, input.response);
    } catch (error) {
      const replayed = await acknowledgePriorReceipt();
      if (replayed) return replayed;
      throw error;
    }
    const correct = responseCorrect(submittedBlock.question, input.response);
    const timing = responseTiming(session, receivedAt);
    const acceptance = await this.sessions.acceptResponse(
      {
        id: randomUUID(),
        workspaceId: session.workspaceId,
        sessionId: session.id,
        participantId: participant.id,
        blockId: submittedBlock.id,
        questionId: submittedBlock.question.id,
        response: input.response,
        correct,
        score: responseScore(submittedBlock.question, correct, timing.remainingRatio),
        responseMs: timing.responseMs,
        submittedAt: receivedAt,
        idempotencyKey: input.idempotencyKey,
        requestHash,
      },
      input.expectedRevision,
    );
    if (acceptance.status === "phase_closed") {
      const currentSession = (await this.sessions.getSessionById(input.sessionId)) ?? session;
      const current = presentationCurrentBlock(currentSession);
      if (currentSession.revision !== input.expectedRevision || current?.id !== input.blockId) {
        throw new PresentationSessionServiceError(
          409,
          "STALE_SESSION",
          "This question changed before the response was saved. Refresh before trying again.",
          {
            expectedBlockId: input.blockId,
            currentBlockId: current?.id ?? null,
            expectedRevision: input.expectedRevision,
            currentRevision: currentSession.revision,
          },
        );
      }
      throw new PresentationSessionServiceError(
        409,
        "PHASE_CLOSED",
        "This question is no longer accepting responses",
      );
    }
    if (acceptance.status === "already_responded") {
      throw new PresentationSessionServiceError(
        409,
        "ALREADY_RESPONDED",
        "Your response is already saved",
      );
    }
    if (acceptance.status === "idempotency_conflict") {
      throw new PresentationSessionServiceError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "This response key was already used for a different request",
      );
    }
    if (acceptance.status === "accepted") {
      this.recordProductEvents(session.workspaceId, [
        {
          name: "response_saved_acknowledged",
          occurredAt: acceptance.response.submittedAt.toISOString(),
          dimensions: { artifactType: "presentation" },
        },
      ]);
    }
    return this.responseAcknowledgement(
      acceptance.acknowledgement,
      participant.id,
      acceptance.response,
      input.idempotencyKey,
      acceptance.status === "duplicate",
    );
  }

  async submitLegacyResponse(input: {
    sessionId: string;
    participantToken: string;
    response: PresentationSessionResponse;
    receivedAt?: Date;
  }) {
    const receivedAt = input.receivedAt ?? new Date();
    const session = await this.sessions.getSessionById(input.sessionId);
    if (!session || presentationLiveSessionExpired(session, receivedAt)) {
      throw new PresentationSessionServiceError(
        401,
        "UNAUTHORIZED",
        "Participant credential is invalid",
      );
    }
    const participant = await this.sessions.findParticipant(
      input.sessionId,
      presentationParticipantTokenHash(input.participantToken),
    );
    if (!participant) {
      throw new PresentationSessionServiceError(
        401,
        "UNAUTHORIZED",
        "Participant credential is invalid",
      );
    }
    const block = presentationCurrentBlock(session);
    if (session.phase !== "question_open" || block?.kind !== "question") {
      throw new PresentationSessionServiceError(
        409,
        "PHASE_CLOSED",
        "This question is no longer accepting responses",
      );
    }
    const idempotencyKey = `legacy:${createHash("sha256")
      .update(`${session.id}:${participant.id}:${block.id}`)
      .digest("hex")}`;
    return this.submitResponse({
      sessionId: session.id,
      participantToken: input.participantToken,
      blockId: block.id,
      expectedRevision: session.revision,
      idempotencyKey,
      response: input.response,
      receivedAt,
    });
  }

  async getReport(workspaceId: string, sessionId: string) {
    const session = await this.sessions.getSessionForWorkspace(workspaceId, sessionId);
    if (!session) {
      throw new PresentationSessionServiceError(404, "NOT_FOUND", "Presentation session not found");
    }
    if (session.status !== "finished") {
      throw new PresentationSessionServiceError(
        409,
        "PHASE_CLOSED",
        "The Presentation report is available after the session finishes",
      );
    }
    const stored = await this.sessions.getReport(workspaceId, sessionId);
    if (!stored) {
      throw new PresentationSessionServiceError(
        503,
        "REPORT_UNAVAILABLE",
        "The Presentation report has not been queued for reconciliation",
      );
    }
    let report = null;
    if (stored.status === "ready") {
      report = PresentationReportV1Schema.parse(stored.payload);
    } else if (stored.status === "pending") {
      // Keep the original `/v1` response useful immediately after finish while the durable worker
      // reconciles the same immutable inputs in the background. Existing clients can continue to
      // read `report`; newer clients can also observe `reportStatus`.
      const [participants, responses, timeline] = await Promise.all([
        this.sessions.listParticipants(sessionId),
        this.sessions.listResponses(sessionId),
        this.sessions.listTimeline(sessionId),
      ]);
      report = generatePresentationReport({ session, participants, responses, timeline });
    }
    return PresentationReportEnvelopeSchema.parse({
      reportStatus: stored.status,
      report,
    });
  }

  async workspaceForCode(code: string) {
    return (await this.sessions.getSessionByCode(code))?.workspaceId ?? null;
  }

  async workspaceForSession(sessionId: string) {
    return (await this.sessions.getSessionById(sessionId))?.workspaceId ?? null;
  }

  private staleSession(expectedRevision: number, currentRevision: number) {
    return new PresentationSessionServiceError(
      409,
      "STALE_SESSION",
      "This Presentation advanced in another host window. Refresh before continuing.",
      { expectedRevision, currentRevision },
    );
  }

  private async authorizeParticipant(sessionId: string, token: string) {
    const session = await this.sessions.getSessionById(sessionId);
    if (!session || presentationLiveSessionExpired(session)) {
      throw new PresentationSessionServiceError(
        401,
        "UNAUTHORIZED",
        "Participant credential is invalid",
      );
    }
    const participant = await this.sessions.findParticipant(
      sessionId,
      presentationParticipantTokenHash(token),
    );
    if (!participant) {
      throw new PresentationSessionServiceError(
        401,
        "UNAUTHORIZED",
        "Participant credential is invalid",
      );
    }
    return { session, participantId: participant.id };
  }

  private async authorizeCredential(sessionId: string, token: string, role: "host" | "companion") {
    return this.authorizeCredentialHash(sessionId, presentationParticipantTokenHash(token), role);
  }

  private async authorizeCredentialHash(
    sessionId: string,
    tokenHash: string,
    role: "host" | "companion",
  ) {
    const session = await this.sessions.getSessionById(sessionId);
    if (!session || presentationLiveSessionExpired(session)) {
      throw new PresentationSessionServiceError(
        401,
        "UNAUTHORIZED",
        "Presentation control credential is invalid",
      );
    }
    const credential = await this.sessions.findValidCredential(
      sessionId,
      tokenHash,
      role,
      new Date(),
    );
    if (!credential || credential.workspaceId !== session.workspaceId) {
      throw new PresentationSessionServiceError(
        401,
        "UNAUTHORIZED",
        "Presentation control credential is invalid",
      );
    }
    return session;
  }

  private async realtimeHostSnapshot(
    session: PresentationSessionRecord,
    projectionData?: PresentationProjectionData,
    connectedParticipantIds: ReadonlySet<string> = new Set(),
  ): Promise<PresentationHostSnapshot> {
    const data = projectionData ?? (await this.projectionData(session));
    return buildPresentationHostSnapshot(session, data, connectedParticipantIds);
  }

  private async restHostSnapshot(session: PresentationSessionRecord) {
    let connectedParticipantIds: ReadonlySet<string> = new Set();
    if (this.connectedParticipantIdsProvider) {
      try {
        connectedParticipantIds = await this.connectedParticipantIdsProvider(session.id);
      } catch {
        // Persisted heartbeat recency remains the conservative fallback if adapter presence fails.
      }
    }
    return {
      ...(await this.realtimeHostSnapshot(session, undefined, connectedParticipantIds)),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  private async realtimeParticipantSnapshot(
    session: PresentationSessionRecord,
    participantId: string,
    projectionData?: PresentationProjectionData,
  ): Promise<PresentationParticipantSnapshot> {
    const data = projectionData ?? (await this.projectionData(session));
    return buildPresentationParticipantSnapshot(session, participantId, data);
  }

  private async responseAcknowledgement(
    acknowledgement: PresentationResponseAcknowledgementState,
    participantId: string,
    response: PresentationSessionResponseRecord,
    idempotencyKey: string,
    duplicate: boolean,
  ): Promise<PresentationResponseAck> {
    const { session, projection } = acknowledgement;
    const acceptedAt = response.submittedAt.toISOString();
    const snapshot = buildTargetedPresentationParticipantSnapshot(
      session,
      participantId,
      projection,
      response,
    );
    const acknowledgedSnapshot = PresentationParticipantSnapshotSchema.parse({
      ...snapshot,
      responseReceipt: {
        responseId: response.id,
        blockId: response.blockId,
        idempotencyKey,
        acceptedAt,
      },
    });
    return {
      sessionId: session.id,
      accepted: true,
      duplicate,
      responseId: response.id,
      blockId: response.blockId,
      idempotencyKey,
      acceptedAt,
      snapshot: acknowledgedSnapshot,
    };
  }

  private async realtimeCompanionSnapshot(
    session: PresentationSessionRecord,
    projectionData?: PresentationProjectionData,
    connectedParticipantIds: ReadonlySet<string> = new Set(),
  ) {
    const data = projectionData ?? (await this.projectionData(session));
    return buildPresentationCompanionSnapshot(session, data, connectedParticipantIds);
  }

  private async projectionData(
    session: PresentationSessionRecord,
  ): Promise<PresentationProjectionData> {
    const [participants, responses] = await Promise.all([
      this.sessions.listParticipants(session.id),
      this.sessions.listResponses(session.id),
    ]);
    return buildPresentationProjectionData(session, participants, responses);
  }

  private async consistentProjection(
    initialSession: PresentationSessionRecord,
  ): Promise<{ session: PresentationSessionRecord; data: PresentationProjectionData } | null> {
    let session = initialSession;
    if (presentationLiveSessionExpired(session)) return null;
    // Participant and response lists are separate repository reads. Confirm the aggregate fence
    // after collecting them so explicit reconnects and room broadcasts cannot label a mixed
    // projection with an older sequence or expose results from a newly opened question.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const data = await this.projectionData(session);
      const confirmed = await this.sessions.getSessionById(session.id);
      if (!confirmed || presentationLiveSessionExpired(confirmed)) return null;
      if (confirmed.eventSeq === session.eventSeq) {
        return { session: confirmed, data };
      }
      session = confirmed;
    }
    throw new PresentationBroadcastConsistencyError(session.id);
  }

  private async hostSnapshot(session: PresentationSessionRecord) {
    const [participants, responses] = await Promise.all([
      this.sessions.listParticipants(session.id),
      this.sessions.listResponses(session.id),
    ]);
    return buildPresentationListSnapshot(session, participants, responses);
  }
}

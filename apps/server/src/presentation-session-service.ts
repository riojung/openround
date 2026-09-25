import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import {
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
} from "@openround/contracts";
import {
  SessionCodeConflictError,
  type PresentationRepository,
  type PresentationSessionRecord,
  type PresentationSessionRepository,
  type Repository,
} from "@openround/db";
import type { AppConfig } from "./config.js";
import { entitlementsFor, retentionExpiry } from "./entitlements.js";
import {
  PresentationLiveMutationService,
  type SubmitPresentationResponseInput,
} from "./presentation-live-mutation-service.js";
import type { ProductEventDispatcher, ProductEventInput } from "./product-events.js";
import { generatePresentationReport } from "./presentation-reporting.js";
import {
  PresentationSessionServiceError,
  type PresentationSessionServiceErrorCode,
} from "./presentation-session-errors.js";
import {
  buildPresentationCompanionSnapshot,
  buildPresentationHostSnapshot,
  buildPresentationListSnapshot,
  buildPresentationParticipantSnapshot,
  buildPresentationProjectionData,
  presentationCurrentBlock,
  type PresentationProjectionData,
} from "./presentation-session-projections.js";
import type { StorageService } from "./storage.js";

const PRESENTATION_SESSION_LIFETIME_MS = 24 * 60 * 60 * 1_000;

export {
  presentationCurrentBlock,
  presentationParticipantBlock,
} from "./presentation-session-projections.js";
export { PresentationSessionServiceError, type PresentationSessionServiceErrorCode };

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

export type { SubmitPresentationResponseInput } from "./presentation-live-mutation-service.js";

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

export function presentationLiveSessionExpired(
  session: PresentationSessionRecord,
  now = new Date(),
) {
  return session.liveExpiresAt.getTime() <= now.getTime();
}

export class PresentationSessionService {
  private connectedParticipantIdsProvider: PresentationConnectedParticipantIdsProvider | null =
    null;
  private readonly liveMutations: PresentationLiveMutationService;

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
  ) {
    this.liveMutations = new PresentationLiveMutationService({
      sessions: dependencies.sessions,
      repository: dependencies.repository,
      config: dependencies.config,
      participantTokenHash: presentationParticipantTokenHash,
      sessionExpired: presentationLiveSessionExpired,
      authorizeHostCredential: (sessionId, token) =>
        this.authorizeCredential(sessionId, token, "host"),
      realtimeHostSnapshot: (session) => this.realtimeHostSnapshot(session),
      restHostSnapshot: (session) => this.restHostSnapshot(session),
      recordProductEvents: (workspaceId, events) => this.recordProductEvents(workspaceId, events),
    });
  }

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
    return this.liveMutations.advance(input);
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
    return this.liveMutations.command(input);
  }

  async submitResponse(
    input: SubmitPresentationResponseInput | (PresentationResponseSubmit & { receivedAt?: Date }),
  ): Promise<PresentationResponseAck> {
    return this.liveMutations.submitResponse(input);
  }

  async submitLegacyResponse(input: {
    sessionId: string;
    participantToken: string;
    response: PresentationSessionResponse;
    receivedAt?: Date;
  }) {
    return this.liveMutations.submitLegacyResponse(input);
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

import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import {
  PresentationCompanionSnapshotSchema,
  PresentationHostSnapshotSchema,
  PresentationParticipantSnapshotSchema,
  type PresentationCommand,
  type PresentationBlock,
  type PresentationHostSnapshot,
  type PresentationParticipantSnapshot,
  type PresentationResponseAck,
  type PresentationResponseSubmit,
  type PresentationRoleSnapshot,
  type PresentationSessionResponse,
  type PresentationSyncRequest,
  type PresentationSyncResponse,
  type QuestionDraft,
  questionPurpose,
  questionTypeDefinition,
} from "@openround/contracts";
import {
  PresentationSessionConflictError,
  SessionCodeConflictError,
  type PresentationRepository,
  type PresentationSessionRecord,
  type PresentationSessionRepository,
  type PresentationSessionResponseRecord,
  type Repository,
} from "@openround/db";
import type { AppConfig } from "./config.js";
import { entitlementsFor, retentionExpiry } from "./entitlements.js";
import type { StorageService } from "./storage.js";

const PRESENTATION_SESSION_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const PRESENTATION_PARTICIPANT_PRESENCE_WINDOW_MS = 15_000;

export type PresentationSessionServiceErrorCode =
  | "NOT_FOUND"
  | "PHASE_CLOSED"
  | "PARTICIPANT_LIMIT"
  | "INSTITUTION_AUTH_REQUIRED"
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR"
  | "STALE_SESSION"
  | "IDEMPOTENCY_CONFLICT"
  | "ALREADY_RESPONDED";

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
 * broadcast. This is deliberately distinct from a missing credential: transports should retry
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

export function presentationCurrentBlock(session: PresentationSessionRecord) {
  return session.currentBlockIndex >= 0
    ? (session.content.blocks[session.currentBlockIndex] ?? null)
    : null;
}

function questionDeadline(session: PresentationSessionRecord) {
  const block = presentationCurrentBlock(session);
  if (session.phase !== "question_open" || block?.kind !== "question") return null;
  return session.questionClosesAt;
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

function acceptingResponses(session: PresentationSessionRecord, now = new Date()) {
  const block = presentationCurrentBlock(session);
  if (session.phase !== "question_open" || block?.kind !== "question") return false;
  return session.questionClosesAt === null || session.questionClosesAt.getTime() >= now.getTime();
}

function responseScore(question: QuestionDraft, correct: boolean | null, remainingRatio: number) {
  if (!correct || !questionTypeDefinition(question.type).scored) return 0;
  return Math.round(question.basePoints * (0.5 + remainingRatio * 0.5));
}

function rankedParticipants(
  participants: Awaited<ReturnType<PresentationSessionRepository["listParticipants"]>>,
  responses: PresentationSessionResponseRecord[],
) {
  const scores = new Map<string, number>();
  for (const response of responses) {
    scores.set(response.participantId, (scores.get(response.participantId) ?? 0) + response.score);
  }
  return participants
    .map((participant) => ({
      id: participant.id,
      nickname: participant.nickname,
      joinedAt: participant.joinedAt,
      score: scores.get(participant.id) ?? 0,
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.joinedAt.getTime() - right.joinedAt.getTime() ||
        left.nickname.localeCompare(right.nickname),
    )
    .map((participant, index) => ({ ...participant, rank: index + 1 }));
}

function facilitatorVisibleResponses(
  session: PresentationSessionRecord,
  responses: PresentationSessionResponseRecord[],
) {
  const block = presentationCurrentBlock(session);
  if (session.phase !== "question_open" || block?.kind !== "question") return responses;
  // A correct response immediately earns points. Including the open question in the live
  // leaderboard would therefore disclose correctness (and timing through the exact score) before
  // the facilitator reveals the answer.
  return responses.filter((response) => response.blockId !== block.id);
}

type PresentationParticipants = Awaited<
  ReturnType<PresentationSessionRepository["listParticipants"]>
>;

interface PresentationProjectionData {
  participants: PresentationParticipants;
  responses: PresentationSessionResponseRecord[];
  leaderboard: ReturnType<typeof rankedParticipants>;
  facilitatorLeaderboard: ReturnType<typeof rankedParticipants>;
  responseByParticipantAndBlock: Map<string, PresentationSessionResponseRecord>;
  latestReceiptByParticipant: Map<string, PresentationSessionResponseRecord>;
}

/**
 * Participant projection is deliberately an allowlist. New authoring fields remain private until
 * explicitly reviewed for participant delivery.
 */
export function presentationParticipantBlock(block: PresentationBlock | null) {
  if (!block) return null;
  if (block.kind === "content") {
    return {
      id: block.id,
      kind: block.kind,
      layout: block.layout,
      title: block.title,
      body: block.body,
      mediaId: block.mediaId,
      mediaAlt: block.mediaAlt,
    };
  }
  const question = block.question;
  const base = {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    confidence: question.confidence,
    timeLimitSeconds: question.timeLimitSeconds,
    mediaId: question.mediaId,
    mediaAlt: question.mediaAlt,
  };
  if (question.type === "numeric") return { id: block.id, kind: block.kind, question: base };
  if (question.type === "rating") {
    return {
      id: block.id,
      kind: block.kind,
      question: {
        ...base,
        min: question.min,
        max: question.max,
        minLabel: question.minLabel,
        maxLabel: question.maxLabel,
      },
    };
  }
  return {
    id: block.id,
    kind: block.kind,
    question: {
      ...base,
      choices: question.choices.map(({ id, label }) => ({ id, label })),
    },
  };
}

function presentationLiveQuestion(question: QuestionDraft, facilitator: boolean) {
  const projected = {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    confidence: question.confidence ?? "off",
    choices:
      "choices" in question
        ? question.choices.map((choice) => ({ id: choice.id, label: choice.label }))
        : [],
    ...(question.type === "numeric" ? { unit: question.unit } : {}),
    ...(question.type === "rating"
      ? {
          rating: {
            min: question.min,
            max: question.max,
            minLabel: question.minLabel,
            maxLabel: question.maxLabel,
          },
        }
      : {}),
    timeLimitSeconds: question.timeLimitSeconds,
    basePoints: question.basePoints,
    mediaId: question.mediaId,
    mediaAlt: question.mediaAlt,
  };
  return facilitator
    ? {
        ...projected,
        purpose: questionPurpose(question),
        linkedRecheckAvailable: Boolean(question.linkedRecheckQuestionId),
      }
    : projected;
}

function presentationRevealedAnswer(question: QuestionDraft) {
  if (question.type === "numeric") {
    return {
      kind: "numeric" as const,
      correctValue: question.correctValue,
      tolerance: question.tolerance,
      unit: question.unit,
      explanation: question.explanation,
    };
  }
  if (question.type === "rating" || question.type === "poll") {
    return { kind: "unscored" as const, explanation: question.explanation };
  }
  return {
    kind: "choice" as const,
    correctChoiceIds: question.choices
      .filter((choice) => choice.isCorrect)
      .map((choice) => choice.id),
    explanation: question.explanation,
  };
}

function presentationRealtimeBlock(
  block: PresentationBlock | null,
  facilitator: boolean,
  revealAnswer = false,
) {
  if (!block) return null;
  if (block.kind === "content") {
    return {
      id: block.id,
      kind: block.kind,
      layout: block.layout,
      title: block.title,
      body: block.body,
      mediaId: block.mediaId,
      mediaAlt: block.mediaAlt,
    };
  }
  return {
    id: block.id,
    kind: block.kind,
    question: presentationLiveQuestion(block.question, facilitator),
    ...(facilitator
      ? {
          revealedAnswer: revealAnswer ? presentationRevealedAnswer(block.question) : null,
        }
      : {}),
  };
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
    },
  ) {}

  private get sessions() {
    return this.dependencies.sessions;
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
    let snapshot: PresentationRoleSnapshot;
    if (input.projection === "participant") {
      const authorized = await this.authorizeParticipant(input.sessionId, input.participantToken);
      snapshot = await this.realtimeParticipantSnapshot(
        authorized.session,
        authorized.participantId,
      );
    } else if (input.projection === "host") {
      const session = await this.authorizeCredential(input.sessionId, input.controlToken, "host");
      snapshot = await this.realtimeHostSnapshot(session);
    } else {
      const session = await this.authorizeCredential(
        input.sessionId,
        input.companionToken,
        "companion",
      );
      snapshot = await this.realtimeCompanionSnapshot(session);
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
    let data: PresentationProjectionData | null = null;
    // Participant/response queries are independent repository reads. Confirm the event-sequence
    // fence after collecting them; if a join, answer, or transition committed between reads,
    // rebuild from the newer session instead of labelling mixed data with an older sequence.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const candidate = await this.projectionData(session);
      const confirmed = await this.sessions.getSessionById(sessionId);
      if (!confirmed || presentationLiveSessionExpired(confirmed)) return inputs.map(() => null);
      if (confirmed.eventSeq === session.eventSeq) {
        data = candidate;
        session = confirmed;
        break;
      }
      session = confirmed;
    }
    if (!data) throw new PresentationBroadcastConsistencyError(sessionId);
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
    const requestHash = presentationResponseRequestHash(input);
    const priorResponse = await this.sessions.findResponseByIdempotencyKey(
      input.sessionId,
      participant.id,
      input.idempotencyKey,
    );
    if (priorResponse) {
      if (priorResponse.requestHash && priorResponse.requestHash !== requestHash) {
        throw new PresentationSessionServiceError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "This response key was already used for a different request",
        );
      }
      const currentSession = (await this.sessions.getSessionById(input.sessionId)) ?? session;
      return this.responseAcknowledgement(
        currentSession,
        participant.id,
        priorResponse,
        input.idempotencyKey,
        true,
      );
    }
    // Resolve the submitted block independently from the current pointer. The repository checks a
    // matching idempotency receipt before its live phase/revision fence, allowing a lost ack to be
    // recovered after the host advances without ever applying the payload to the next question.
    const submittedBlock = session.content.blocks.find((block) => block.id === input.blockId);
    if (submittedBlock?.kind !== "question") {
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
    validateResponse(submittedBlock.question, input.response);
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
    const currentSession = (await this.sessions.getSessionById(input.sessionId)) ?? session;
    return this.responseAcknowledgement(
      currentSession,
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
    const [responses, participants, timeline] = await Promise.all([
      this.sessions.listResponses(sessionId),
      this.sessions.listParticipants(sessionId),
      this.sessions.listTimeline(sessionId),
    ]);
    const byBlock = new Map<string, PresentationSessionResponseRecord[]>();
    for (const response of responses) {
      const group = byBlock.get(response.blockId) ?? [];
      group.push(response);
      byBlock.set(response.blockId, group);
    }
    const evidence = session.content.blocks.map((block, blockIndex) => {
      if (block.kind === "content") {
        return {
          blockId: block.id,
          blockIndex,
          kind: "content" as const,
          title: block.title,
          assessmentStatus: "not_assessed" as const,
        };
      }
      const blockResponses = byBlock.get(block.id) ?? [];
      const assessed = blockResponses.filter((response) => response.correct !== null);
      const correct = assessed.filter((response) => response.correct).length;
      return {
        blockId: block.id,
        blockIndex,
        kind: "question" as const,
        questionId: block.question.id,
        prompt: block.question.prompt,
        questionType: block.question.type,
        questionTypeLabel: questionTypeDefinition(block.question.type).label,
        delivery: block.question.delivery ?? "main",
        respondents: blockResponses.length,
        correct: assessed.length ? correct : null,
        accuracyPercent: assessed.length ? Math.round((correct / assessed.length) * 100) : null,
        totalScore: blockResponses.reduce((total, response) => total + response.score, 0),
        averageResponseMs: blockResponses.length
          ? Math.round(
              blockResponses.reduce((total, response) => total + response.responseMs, 0) /
                blockResponses.length,
            )
          : null,
      };
    });
    const responseByParticipantQuestion = new Map(
      responses.map((response) => [`${response.participantId}:${response.questionId}`, response]),
    );
    const recovery = session.content.blocks.flatMap((block) => {
      if (block.kind !== "question" || !block.question.linkedRecheckQuestionId) return [];
      let eligible = 0;
      let recovered = 0;
      for (const participant of participants) {
        const initial = responseByParticipantQuestion.get(`${participant.id}:${block.question.id}`);
        const recheck = responseByParticipantQuestion.get(
          `${participant.id}:${block.question.linkedRecheckQuestionId}`,
        );
        if (initial?.correct === false && recheck) {
          eligible += 1;
          if (recheck.correct === true) recovered += 1;
        }
      }
      return [
        {
          sourceQuestionId: block.question.id,
          recheckQuestionId: block.question.linkedRecheckQuestionId,
          eligible,
          recovered,
          recoveryPercent: eligible ? Math.round((recovered / eligible) * 100) : null,
        },
      ];
    });
    return {
      sessionId: session.id,
      artifactType: "presentation" as const,
      presentationId: session.presentationId,
      presentationVersionId: session.presentationVersionId,
      title: session.title,
      status: session.status,
      trustMode: session.trustMode,
      participantCount: participants.length,
      responseCount: responses.length,
      leaderboard: rankedParticipants(participants, responses).map(
        ({ id, nickname, score, rank }) => ({ id, nickname, score, rank }),
      ),
      evidence,
      recovery,
      timeline: timeline.map((event) => ({
        sequence: event.sequence,
        type: event.type,
        blockIndex: event.blockIndex,
        blockId: event.blockId,
        occurredAt: event.occurredAt,
      })),
      evidenceNote:
        "Content slides are recorded in the facilitation timeline but are not evidence of learning.",
      createdAt: session.createdAt,
      finishedAt: session.finishedAt,
    };
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
    const { participants, responses } = data;
    const block = presentationCurrentBlock(session);
    const leaderboard = data.facilitatorLeaderboard;
    const responseCount =
      block?.kind === "question"
        ? responses.filter((response) => response.blockId === block.id).length
        : 0;
    const sampledAt = new Date();
    const connectedCount = participants.filter(
      (participant) =>
        connectedParticipantIds.has(participant.id) ||
        sampledAt.getTime() - participant.lastSeenAt.getTime() <=
          PRESENTATION_PARTICIPANT_PRESENCE_WINDOW_MS,
    ).length;
    return PresentationHostSnapshotSchema.parse({
      sessionId: session.id,
      artifactType: "presentation",
      presentationId: session.presentationId,
      presentationVersionId: session.presentationVersionId,
      title: session.title,
      code: session.code,
      status: session.status,
      phase: session.phase,
      currentBlockIndex: session.currentBlockIndex,
      blockCount: session.content.blocks.length,
      revision: session.revision,
      seq: session.eventSeq,
      serverTime: sampledAt.toISOString(),
      questionOpenedAt: session.questionOpenedAt?.toISOString() ?? null,
      questionClosesAt: questionDeadline(session)?.toISOString() ?? null,
      acceptingResponses: acceptingResponses(session),
      settings: { ...session.settings, trustMode: session.trustMode },
      projection: "host",
      currentBlock: presentationRealtimeBlock(
        block,
        true,
        session.phase === "question_reveal" ||
          session.phase === "intervention" ||
          session.phase === "finished",
      ),
      participantCount: participants.length,
      responseCount,
      participants: leaderboard.map(({ id, nickname, joinedAt, score, rank }) => ({
        id,
        nickname,
        joinedAt: joinedAt.toISOString(),
        score,
        rank,
      })),
      roomStatus: {
        sessionId: session.id,
        joinedCount: participants.length,
        connectedCount,
        notCurrentlyConnectedCount: participants.length - connectedCount,
        responseCount,
        sampledAt: sampledAt.toISOString(),
      },
      finishedAt: session.finishedAt?.toISOString() ?? null,
    });
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

  private async targetedResponseAcknowledgementSnapshot(
    initialSession: PresentationSessionRecord,
    participantId: string,
    acknowledgedResponse: PresentationSessionResponseRecord,
  ): Promise<PresentationParticipantSnapshot> {
    let session = initialSession;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const block = presentationCurrentBlock(session);
      const projection = await this.sessions.getParticipantSnapshotProjection(
        session.id,
        participantId,
        block?.id ?? null,
        session.phase !== "question_open",
      );
      if (!projection) {
        throw new PresentationSessionServiceError(
          401,
          "UNAUTHORIZED",
          "Participant credential is invalid",
        );
      }
      const confirmed = await this.sessions.getSessionById(session.id);
      if (!confirmed || presentationLiveSessionExpired(confirmed)) {
        throw new PresentationSessionServiceError(
          401,
          "UNAUTHORIZED",
          "Participant credential is invalid",
        );
      }
      if (confirmed.eventSeq !== session.eventSeq) {
        session = confirmed;
        continue;
      }
      const currentResponse =
        block?.id === acknowledgedResponse.blockId
          ? acknowledgedResponse
          : projection.currentResponse;
      const resultVisible =
        session.phase === "question_reveal" ||
        session.phase === "intervention" ||
        session.phase === "finished";
      return PresentationParticipantSnapshotSchema.parse({
        sessionId: session.id,
        artifactType: "presentation",
        presentationId: session.presentationId,
        presentationVersionId: session.presentationVersionId,
        title: session.title,
        code: session.code,
        status: session.status,
        phase: session.phase,
        currentBlockIndex: session.currentBlockIndex,
        blockCount: session.content.blocks.length,
        revision: session.revision,
        seq: session.eventSeq,
        serverTime: new Date().toISOString(),
        questionOpenedAt: session.questionOpenedAt?.toISOString() ?? null,
        questionClosesAt: questionDeadline(session)?.toISOString() ?? null,
        acceptingResponses: acceptingResponses(session),
        settings: { ...session.settings, trustMode: session.trustMode },
        projection: "participant",
        participantId,
        currentBlock: presentationRealtimeBlock(block, false),
        participantCount: projection.participantCount,
        responseSubmitted: Boolean(currentResponse),
        standing: session.phase === "question_open" ? null : projection.standing,
        responseResult:
          resultVisible && currentResponse
            ? { correct: currentResponse.correct, score: currentResponse.score }
            : null,
        finishedAt: session.finishedAt?.toISOString() ?? null,
      });
    }
    throw new PresentationBroadcastConsistencyError(initialSession.id);
  }

  private async realtimeParticipantSnapshot(
    session: PresentationSessionRecord,
    participantId: string,
    projectionData?: PresentationProjectionData,
  ): Promise<PresentationParticipantSnapshot> {
    const data = projectionData ?? (await this.projectionData(session));
    const { participants } = data;
    const block = presentationCurrentBlock(session);
    const currentResponse = block
      ? data.responseByParticipantAndBlock.get(`${participantId}:${block.id}`)
      : undefined;
    const latestResponse = data.latestReceiptByParticipant.get(participantId);
    const standing = data.leaderboard.find((entry) => entry.id === participantId);
    const resultVisible =
      session.phase === "question_reveal" ||
      session.phase === "intervention" ||
      session.phase === "finished";
    return PresentationParticipantSnapshotSchema.parse({
      sessionId: session.id,
      artifactType: "presentation",
      presentationId: session.presentationId,
      presentationVersionId: session.presentationVersionId,
      title: session.title,
      code: session.code,
      status: session.status,
      phase: session.phase,
      currentBlockIndex: session.currentBlockIndex,
      blockCount: session.content.blocks.length,
      revision: session.revision,
      seq: session.eventSeq,
      serverTime: new Date().toISOString(),
      questionOpenedAt: session.questionOpenedAt?.toISOString() ?? null,
      questionClosesAt: questionDeadline(session)?.toISOString() ?? null,
      acceptingResponses: acceptingResponses(session),
      settings: { ...session.settings, trustMode: session.trustMode },
      projection: "participant",
      participantId,
      currentBlock: presentationRealtimeBlock(block, false),
      participantCount: participants.length,
      responseSubmitted: Boolean(currentResponse),
      responseReceipt: latestResponse?.idempotencyKey
        ? {
            responseId: latestResponse.id,
            blockId: latestResponse.blockId,
            idempotencyKey: latestResponse.idempotencyKey,
            acceptedAt: latestResponse.submittedAt.toISOString(),
          }
        : null,
      standing:
        session.phase !== "question_open" && standing
          ? { rank: standing.rank, score: standing.score }
          : null,
      responseResult:
        resultVisible && currentResponse
          ? { correct: currentResponse.correct, score: currentResponse.score }
          : null,
      finishedAt: session.finishedAt?.toISOString() ?? null,
    });
  }

  private async responseAcknowledgement(
    session: PresentationSessionRecord,
    participantId: string,
    response: PresentationSessionResponseRecord,
    idempotencyKey: string,
    duplicate: boolean,
  ): Promise<PresentationResponseAck> {
    const acceptedAt = response.submittedAt.toISOString();
    const snapshot = await this.targetedResponseAcknowledgementSnapshot(
      session,
      participantId,
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
    const host = await this.realtimeHostSnapshot(session, projectionData, connectedParticipantIds);
    return PresentationCompanionSnapshotSchema.parse({
      sessionId: host.sessionId,
      artifactType: host.artifactType,
      presentationId: host.presentationId,
      presentationVersionId: host.presentationVersionId,
      title: host.title,
      code: host.code,
      status: host.status,
      phase: host.phase,
      currentBlockIndex: host.currentBlockIndex,
      blockCount: host.blockCount,
      revision: host.revision,
      seq: host.seq,
      serverTime: host.serverTime,
      questionOpenedAt: host.questionOpenedAt,
      questionClosesAt: host.questionClosesAt,
      acceptingResponses: host.acceptingResponses,
      settings: host.settings,
      projection: "companion",
      currentBlock: presentationRealtimeBlock(presentationCurrentBlock(session), false),
      roomStatus: host.roomStatus,
      primaryAction: session.status === "active" ? "advance" : "none",
      finishedAt: host.finishedAt,
    });
  }

  private async projectionData(
    session: PresentationSessionRecord,
  ): Promise<PresentationProjectionData> {
    const [participants, responses] = await Promise.all([
      this.sessions.listParticipants(session.id),
      this.sessions.listResponses(session.id),
    ]);
    const responseByParticipantAndBlock = new Map<string, PresentationSessionResponseRecord>();
    const latestReceiptByParticipant = new Map<string, PresentationSessionResponseRecord>();
    for (const response of responses) {
      responseByParticipantAndBlock.set(`${response.participantId}:${response.blockId}`, response);
      if (response.idempotencyKey) {
        const current = latestReceiptByParticipant.get(response.participantId);
        if (!current || current.submittedAt <= response.submittedAt) {
          latestReceiptByParticipant.set(response.participantId, response);
        }
      }
    }
    return {
      participants,
      responses,
      leaderboard: rankedParticipants(participants, responses),
      facilitatorLeaderboard: rankedParticipants(
        participants,
        facilitatorVisibleResponses(session, responses),
      ),
      responseByParticipantAndBlock,
      latestReceiptByParticipant,
    };
  }

  private async hostSnapshot(session: PresentationSessionRecord) {
    const [participants, responses] = await Promise.all([
      this.sessions.listParticipants(session.id),
      this.sessions.listResponses(session.id),
    ]);
    const block = presentationCurrentBlock(session);
    const deadline = questionDeadline(session);
    const leaderboard = rankedParticipants(
      participants,
      facilitatorVisibleResponses(session, responses),
    );
    const restLeaderboard = leaderboard.map(({ joinedAt, ...participant }) => ({
      ...participant,
      joinedAt: joinedAt.toISOString(),
    }));
    return {
      id: session.id,
      artifactType: "presentation" as const,
      presentationId: session.presentationId,
      presentationVersionId: session.presentationVersionId,
      title: session.title,
      code: session.code,
      status: session.status,
      phase: session.phase,
      currentBlockIndex: session.currentBlockIndex,
      blockCount: session.content.blocks.length,
      revision: session.revision,
      settings: { ...session.settings, trustMode: session.trustMode },
      trustMode: session.trustMode,
      eventSeq: session.eventSeq,
      currentBlock: presentationRealtimeBlock(
        block,
        true,
        session.phase === "question_reveal" ||
          session.phase === "intervention" ||
          session.phase === "finished",
      ),
      questionOpenedAt: session.questionOpenedAt?.toISOString() ?? null,
      questionClosesAt: deadline?.toISOString() ?? null,
      acceptingResponses: acceptingResponses(session),
      participantCount: participants.length,
      responseCount:
        block?.kind === "question"
          ? responses.filter((response) => response.blockId === block.id).length
          : 0,
      participants: restLeaderboard,
      leaderboard: restLeaderboard,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      finishedAt: session.finishedAt?.toISOString() ?? null,
    };
  }
}

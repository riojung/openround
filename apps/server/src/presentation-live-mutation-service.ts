import { createHash, randomUUID } from "node:crypto";
import {
  PresentationParticipantSnapshotSchema,
  type PresentationCommand,
  type PresentationHostSnapshot,
  type PresentationResponseAck,
  type PresentationResponseSubmit,
  type PresentationSessionResponse,
} from "@openround/contracts";
import {
  PresentationSessionConflictError,
  type PresentationResponseAcknowledgementState,
  type PresentationSessionRecord,
  type PresentationSessionRepository,
  type PresentationSessionResponseRecord,
  type Repository,
} from "@openround/db";
import type { AppConfig } from "./config.js";
import { entitlementsFor, retentionExpiry } from "./entitlements.js";
import type { ProductEventInput } from "./product-events.js";
import { PresentationSessionServiceError } from "./presentation-session-errors.js";
import {
  buildTargetedPresentationParticipantSnapshot,
  presentationCurrentBlock,
} from "./presentation-session-projections.js";
import {
  presentationResponseCorrect,
  presentationResponseRequestHash,
  presentationResponseScore,
  presentationResponseTiming,
  presentationResponseValidationMessage,
} from "./presentation-session-response-policy.js";

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

export interface AdvancePresentationSessionInput {
  workspaceId: string;
  userId: string;
  sessionId: string;
  expectedRevision: number;
  requestId: string;
}

export interface SubmitLegacyPresentationResponseInput {
  sessionId: string;
  participantToken: string;
  response: PresentationSessionResponse;
  receivedAt?: Date;
}

export type PresentationRestHostSnapshot = PresentationHostSnapshot & {
  createdAt: Date;
  updatedAt: Date;
};

type PresentationMutationSessionRepository = Pick<
  PresentationSessionRepository,
  | "getSessionForWorkspace"
  | "getSessionById"
  | "transitionSession"
  | "transitionSessionCommand"
  | "findParticipant"
  | "getResponseContext"
  | "acceptResponse"
  | "findResponseByIdempotencyKey"
>;

type PresentationMutationRepository = Pick<Repository, "getPlan" | "recordAudit">;

type PresentationEntitlementConfig = Pick<
  AppConfig,
  | "COMMUNITY_MODE"
  | "COMMUNITY_REPORT_RETENTION_DAYS"
  | "MAX_SESSION_PARTICIPANTS"
  | "MAX_PRACTICE_PERSONAL_LINKS"
>;

interface PresentationLiveMutationDependencies {
  sessions: PresentationMutationSessionRepository;
  repository: PresentationMutationRepository;
  config: PresentationEntitlementConfig;
  participantTokenHash(token: string): string;
  sessionExpired(session: PresentationSessionRecord, now?: Date): boolean;
  authorizeHostCredential(sessionId: string, token: string): Promise<PresentationSessionRecord>;
  realtimeHostSnapshot(session: PresentationSessionRecord): Promise<PresentationHostSnapshot>;
  restHostSnapshot(session: PresentationSessionRecord): Promise<PresentationRestHostSnapshot>;
  recordProductEvents(workspaceId: string, events: ProductEventInput[]): void;
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

export class PresentationLiveMutationService {
  constructor(private readonly dependencies: PresentationLiveMutationDependencies) {}

  async advance(input: AdvancePresentationSessionInput): Promise<PresentationRestHostSnapshot> {
    const session = await this.dependencies.sessions.getSessionForWorkspace(
      input.workspaceId,
      input.sessionId,
    );
    if (!session) {
      throw new PresentationSessionServiceError(404, "NOT_FOUND", "Presentation session not found");
    }
    if (this.dependencies.sessionExpired(session)) {
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
    if (!transition) return this.dependencies.restHostSnapshot(session);
    try {
      const transitionRetentionExpiresAt = await this.transitionRetentionExpiry(
        input.workspaceId,
        transition.status,
      );
      const updated = await this.dependencies.sessions.transitionSession({
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
      return this.dependencies.restHostSnapshot(updated);
    } catch (error) {
      if (error instanceof PresentationSessionConflictError) {
        throw this.staleSession(error.expectedRevision, error.currentRevision);
      }
      throw error;
    }
  }

  async command(input: PresentationCommand): Promise<PresentationHostSnapshot> {
    const session = await this.dependencies.authorizeHostCredential(
      input.sessionId,
      input.controlToken,
    );
    const transition = nextTransition(session);
    if (!transition) return this.dependencies.realtimeHostSnapshot(session);
    try {
      const transitionRetentionExpiresAt = await this.transitionRetentionExpiry(
        session.workspaceId,
        transition.status,
      );
      const accepted = await this.dependencies.sessions.transitionSessionCommand({
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
      return this.dependencies.realtimeHostSnapshot(accepted.session);
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
    const context = await this.dependencies.sessions.getResponseContext(
      input.sessionId,
      this.dependencies.participantTokenHash(input.participantToken),
      input.idempotencyKey,
    );
    if (!context || this.dependencies.sessionExpired(context.session, receivedAt)) {
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
        (await this.dependencies.sessions.findResponseByIdempotencyKey(
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
      const duplicate = await this.dependencies.sessions.acceptResponse(
        receipt,
        input.expectedRevision,
      );
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
    const validationMessage = presentationResponseValidationMessage(
      submittedBlock.question,
      input.response,
    );
    if (validationMessage) {
      const replayed = await acknowledgePriorReceipt();
      if (replayed) return replayed;
      throw new PresentationSessionServiceError(422, "VALIDATION_ERROR", validationMessage);
    }
    const correct = presentationResponseCorrect(submittedBlock.question, input.response);
    const timing = presentationResponseTiming(session, receivedAt);
    const acceptance = await this.dependencies.sessions.acceptResponse(
      {
        id: randomUUID(),
        workspaceId: session.workspaceId,
        sessionId: session.id,
        participantId: participant.id,
        blockId: submittedBlock.id,
        questionId: submittedBlock.question.id,
        response: input.response,
        correct,
        score: presentationResponseScore(submittedBlock.question, correct, timing.remainingRatio),
        responseMs: timing.responseMs,
        submittedAt: receivedAt,
        idempotencyKey: input.idempotencyKey,
        requestHash,
      },
      input.expectedRevision,
    );
    if (acceptance.status === "phase_closed") {
      const currentSession =
        (await this.dependencies.sessions.getSessionById(input.sessionId)) ?? session;
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
      this.dependencies.recordProductEvents(session.workspaceId, [
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

  async submitLegacyResponse(
    input: SubmitLegacyPresentationResponseInput,
  ): Promise<PresentationResponseAck> {
    const receivedAt = input.receivedAt ?? new Date();
    const session = await this.dependencies.sessions.getSessionById(input.sessionId);
    if (!session || this.dependencies.sessionExpired(session, receivedAt)) {
      throw new PresentationSessionServiceError(
        401,
        "UNAUTHORIZED",
        "Participant credential is invalid",
      );
    }
    const participant = await this.dependencies.sessions.findParticipant(
      input.sessionId,
      this.dependencies.participantTokenHash(input.participantToken),
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

  private async transitionRetentionExpiry(workspaceId: string, status: "active" | "finished") {
    if (status !== "finished") return undefined;
    return retentionExpiry(
      new Date(),
      entitlementsFor(
        await this.dependencies.repository.getPlan(workspaceId),
        this.dependencies.config,
      ),
    );
  }

  private recordAcceptedTransitionProductEvents(
    session: PresentationSessionRecord,
    transition: NonNullable<ReturnType<typeof nextTransition>>,
  ) {
    const occurredAt = session.updatedAt.toISOString();
    if (transition.event.type === "intervention.presented") {
      this.dependencies.recordProductEvents(session.workspaceId, [
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
      this.dependencies.recordProductEvents(session.workspaceId, [
        {
          name: "linked_recheck_opened",
          occurredAt,
          dimensions: { artifactType: "presentation" },
        },
      ]);
    }
  }

  private staleSession(expectedRevision: number, currentRevision: number) {
    return new PresentationSessionServiceError(
      409,
      "STALE_SESSION",
      "This Presentation advanced in another host window. Refresh before continuing.",
      { expectedRevision, currentRevision },
    );
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
}

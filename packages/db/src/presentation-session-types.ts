import type {
  PresentationContent,
  PresentationSessionPhase,
  PresentationSessionResponse,
} from "@openround/contracts";

export interface PresentationSessionRecord {
  id: string;
  workspaceId: string;
  presentationId: string;
  presentationVersionId: string;
  title: string;
  content: PresentationContent;
  code: string;
  status: "active" | "finished";
  phase: PresentationSessionPhase;
  currentBlockIndex: number;
  revision: number;
  settings: PresentationSessionSettings;
  trustMode: PresentationSessionTrustMode;
  eventSeq: number;
  questionOpenedAt: Date | null;
  questionClosesAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
  liveExpiresAt: Date;
  retentionExpiresAt: Date;
}

export type PresentationSessionTimeMode = "timed" | "flex";
export type PresentationSessionTrustMode = "learning" | "verified";

export interface PresentationSessionSettings {
  timeMode: PresentationSessionTimeMode;
}

export type PresentationSessionCreateInput = Omit<
  PresentationSessionRecord,
  "settings" | "trustMode" | "eventSeq" | "questionOpenedAt" | "questionClosesAt"
> &
  Partial<
    Pick<
      PresentationSessionRecord,
      "settings" | "trustMode" | "eventSeq" | "questionOpenedAt" | "questionClosesAt"
    >
  >;

export interface PresentationSessionParticipantRecord {
  id: string;
  workspaceId: string;
  sessionId: string;
  nickname: string;
  tokenHash: string;
  joinedAt: Date;
  lastSeenAt: Date;
}

export interface PresentationSessionResponseRecord {
  id: string;
  workspaceId: string;
  sessionId: string;
  participantId: string;
  blockId: string;
  questionId: string;
  response: PresentationSessionResponse;
  correct: boolean | null;
  score: number;
  responseMs: number;
  submittedAt: Date;
  /** Required by realtime callers. Optional only while legacy REST callers migrate. */
  idempotencyKey?: string | null;
  /** Canonical request fingerprint used to reject key reuse with a different request. */
  requestHash?: string | null;
}

export interface PresentationParticipantSnapshotProjection {
  participantCount: number;
  standing: { rank: number; score: number } | null;
  currentResponse: PresentationSessionResponseRecord | null;
}

export type PresentationSessionCredentialRole = "host" | "companion";

export interface PresentationSessionCredentialRecord {
  id: string;
  workspaceId: string;
  sessionId: string;
  role: PresentationSessionCredentialRole;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface PresentationSessionCommandReceiptRecord {
  id: string;
  workspaceId: string;
  sessionId: string;
  commandId: string;
  expectedRevision: number;
  resultingRevision: number;
  eventType: PresentationSessionTimelineRecord["type"];
  receivedAt: Date;
}

export interface PresentationSessionTimelineRecord {
  id: string;
  workspaceId: string;
  sessionId: string;
  sequence: number;
  type:
    | "presentation.started"
    | "content.presented"
    | "question.launched"
    | "question.revealed"
    | "intervention.presented"
    | "presentation.finished";
  blockIndex: number | null;
  blockId: string | null;
  occurredAt: Date;
}

export type PresentationResponseAcceptance =
  | { status: "accepted"; response: PresentationSessionResponseRecord }
  | { status: "duplicate"; response: PresentationSessionResponseRecord }
  | { status: "idempotency_conflict"; response: PresentationSessionResponseRecord }
  | { status: "already_responded"; response: PresentationSessionResponseRecord }
  | { status: "phase_closed" };

export type PresentationTransitionAcceptance =
  | { status: "accepted"; session: PresentationSessionRecord }
  | { status: "duplicate"; session: PresentationSessionRecord }
  | { status: "idempotency_conflict"; session: PresentationSessionRecord }
  | { status: "not_found" };

export type PresentationParticipantJoin =
  | { status: "accepted"; participant: PresentationSessionParticipantRecord }
  | { status: "full" }
  | { status: "closed" };

export interface PresentationSessionTransitionInput {
  workspaceId: string;
  sessionId: string;
  expectedRevision: number;
  phase: PresentationSessionPhase;
  currentBlockIndex: number;
  status: "active" | "finished";
  occurredAt?: Date;
  questionOpenedAt?: Date | null;
  questionClosesAt?: Date | null;
  retentionExpiresAt?: Date;
  event: Omit<
    PresentationSessionTimelineRecord,
    "id" | "workspaceId" | "sessionId" | "sequence" | "occurredAt"
  >;
}

export type PresentationSessionCommandInput = PresentationSessionTransitionInput & {
  commandId: string;
};

export interface PresentationSessionRepository {
  listSessions(workspaceId: string, now?: Date): Promise<PresentationSessionRecord[]>;
  createSession(input: PresentationSessionCreateInput): Promise<PresentationSessionRecord>;
  /** Creates the live room and its first scoped credential in one durable unit. */
  createSessionWithCredential(
    input: PresentationSessionCreateInput,
    credential: PresentationSessionCredentialRecord,
  ): Promise<{
    session: PresentationSessionRecord;
    credential: PresentationSessionCredentialRecord;
  }>;
  getSessionForWorkspace(
    workspaceId: string,
    sessionId: string,
  ): Promise<PresentationSessionRecord | null>;
  getSessionById(sessionId: string): Promise<PresentationSessionRecord | null>;
  getSessionByCode(code: string): Promise<PresentationSessionRecord | null>;
  transitionSession(
    input: PresentationSessionTransitionInput,
  ): Promise<PresentationSessionRecord | null>;
  transitionSessionCommand(
    input: PresentationSessionCommandInput,
  ): Promise<PresentationTransitionAcceptance>;
  addParticipant(
    input: PresentationSessionParticipantRecord,
  ): Promise<PresentationSessionParticipantRecord>;
  joinParticipantWithinLimit(
    input: PresentationSessionParticipantRecord,
    participantLimit: number,
  ): Promise<PresentationParticipantJoin>;
  findParticipant(
    sessionId: string,
    tokenHash: string,
  ): Promise<PresentationSessionParticipantRecord | null>;
  listParticipants(sessionId: string): Promise<PresentationSessionParticipantRecord[]>;
  saveResponse(
    input: PresentationSessionResponseRecord,
  ): Promise<PresentationSessionResponseRecord>;
  acceptResponse(
    input: PresentationSessionResponseRecord,
    expectedSessionRevision: number,
  ): Promise<PresentationResponseAcceptance>;
  findResponseByIdempotencyKey(
    sessionId: string,
    participantId: string,
    idempotencyKey: string,
  ): Promise<PresentationSessionResponseRecord | null>;
  getParticipantSnapshotProjection(
    sessionId: string,
    participantId: string,
    currentBlockId: string | null,
    includeStanding: boolean,
  ): Promise<PresentationParticipantSnapshotProjection | null>;
  listResponses(sessionId: string): Promise<PresentationSessionResponseRecord[]>;
  listTimeline(sessionId: string): Promise<PresentationSessionTimelineRecord[]>;
  createCredential(
    input: PresentationSessionCredentialRecord,
  ): Promise<PresentationSessionCredentialRecord>;
  /** Atomically revokes active credentials for the same role before creating the replacement. */
  rotateCredential(
    input: PresentationSessionCredentialRecord,
  ): Promise<PresentationSessionCredentialRecord>;
  findValidCredential(
    sessionId: string,
    tokenHash: string,
    role?: PresentationSessionCredentialRole,
    now?: Date,
  ): Promise<PresentationSessionCredentialRecord | null>;
  revokeCredential(
    workspaceId: string,
    sessionId: string,
    credentialId: string,
    revokedAt?: Date,
    role?: PresentationSessionCredentialRole,
  ): Promise<PresentationSessionCredentialRecord | null>;
}

export class PresentationSessionConflictError extends Error {
  constructor(
    public readonly expectedRevision: number,
    public readonly currentRevision: number,
  ) {
    super("The live presentation changed in another host window");
    this.name = "PresentationSessionConflictError";
  }
}

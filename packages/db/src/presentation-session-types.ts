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
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
  liveExpiresAt: Date;
  retentionExpiresAt: Date;
}

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
  | { status: "phase_closed" };

export type PresentationParticipantJoin =
  | { status: "accepted"; participant: PresentationSessionParticipantRecord }
  | { status: "full" }
  | { status: "closed" };

export interface PresentationSessionRepository {
  listSessions(workspaceId: string, now?: Date): Promise<PresentationSessionRecord[]>;
  createSession(input: PresentationSessionRecord): Promise<PresentationSessionRecord>;
  getSessionForWorkspace(
    workspaceId: string,
    sessionId: string,
  ): Promise<PresentationSessionRecord | null>;
  getSessionById(sessionId: string): Promise<PresentationSessionRecord | null>;
  getSessionByCode(code: string): Promise<PresentationSessionRecord | null>;
  transitionSession(input: {
    workspaceId: string;
    sessionId: string;
    expectedRevision: number;
    phase: PresentationSessionPhase;
    currentBlockIndex: number;
    status: "active" | "finished";
    retentionExpiresAt?: Date;
    event: Omit<
      PresentationSessionTimelineRecord,
      "id" | "workspaceId" | "sessionId" | "sequence" | "occurredAt"
    >;
  }): Promise<PresentationSessionRecord | null>;
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
  listResponses(sessionId: string): Promise<PresentationSessionResponseRecord[]>;
  listTimeline(sessionId: string): Promise<PresentationSessionTimelineRecord[]>;
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

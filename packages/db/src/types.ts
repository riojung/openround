import type { BrandTheme, QuizDraft, Report } from "@openround/contracts";
import type { EngineAnswer, GameState } from "@openround/game-engine";

export type Segment = "education" | "workplace";
export type Plan = "free" | "pro" | "team";

export interface BillingProfile {
  plan: Plan;
  status: string;
  customerId: string | null;
  subscriptionId: string | null;
}

export interface BillingEventInput {
  providerEventId: string;
  eventType: string;
  providerCreatedAt: Date;
  workspaceId?: string;
  plan?: Plan;
  status?: string;
  customerId?: string;
  subscriptionId?: string;
}

export interface CreatorContext {
  userId: string;
  workspaceId: string;
  email: string;
  segment: Segment;
  role: "owner" | "editor" | "viewer";
  plan: Plan;
}

export interface MagicTokenRecord {
  id: string;
  email: string;
  segment: Segment;
  tokenHash: string;
  policyVersion: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface QuizRecord {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  status: "draft" | "published" | "archived";
  draft: QuizDraft;
  currentVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuizVersionRecord {
  id: string;
  workspaceId: string;
  quizId: string;
  version: number;
  content: QuizDraft;
  contentHash: string;
  publishedAt: Date;
}

export interface StoredSession {
  id: string;
  workspaceId: string;
  quizVersionId: string;
  hostId: string;
  hostTokenHash: string;
  state: GameState;
  /** Last instant at which host and participant credentials may use the live session. */
  expiresAt: Date;
  /** Instant at which the full session, answers, and report may be permanently purged. */
  retentionExpiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export class SessionVersionConflictError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly expectedVersion: number,
  ) {
    super(`Session ${sessionId} no longer has expected version ${expectedVersion}`);
    this.name = "SessionVersionConflictError";
  }
}

export class SessionCodeConflictError extends Error {
  constructor(public readonly code: string) {
    super(`Session code ${code} is already active`);
    this.name = "SessionCodeConflictError";
  }
}

export class PublishedQuizLimitError extends Error {
  constructor(public readonly limit: number) {
    super(`This plan supports ${limit} published quizzes`);
    this.name = "PublishedQuizLimitError";
  }
}

export interface ParticipantRecord {
  id: string;
  sessionId: string;
  nickname: string;
  tokenHash: string;
  status: "active" | "disconnected" | "kicked";
  joinedAt: Date;
}

export type MediaScanStatus = "pending" | "clean" | "rejected";

export interface MediaAssetRecord {
  id: string;
  workspaceId: string;
  objectKey: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  sizeBytes: number;
  scanStatus: MediaScanStatus;
  altText: string;
  createdAt: Date;
}

export interface AuditInput {
  workspaceId: string | null;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  requestId: string;
  metadata?: Record<string, unknown>;
}

export interface OperationalFeaturesRecord {
  signups: boolean;
  sessionCreation: boolean;
  mediaUploads: boolean;
  updatedAt: Date | null;
}

export type OperationalFeaturesUpdate = Partial<
  Pick<OperationalFeaturesRecord, "signups" | "sessionCreation" | "mediaUploads">
>;

export interface Repository {
  initialize(): Promise<void>;
  close(): Promise<void>;
  getOperationalFeatures(): Promise<OperationalFeaturesRecord>;
  updateOperationalFeatures(
    input: OperationalFeaturesUpdate,
    requestId: string,
  ): Promise<OperationalFeaturesRecord>;
  createMagicToken(input: MagicTokenRecord): Promise<void>;
  consumeMagicToken(tokenHash: string, now: Date): Promise<CreatorContext | null>;
  createCreatorSession(input: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  getCreatorBySession(tokenHash: string, now: Date): Promise<CreatorContext | null>;
  revokeCreatorSession(tokenHash: string): Promise<void>;
  listQuizzes(workspaceId: string, includeArchived?: boolean): Promise<QuizRecord[]>;
  createQuiz(input: QuizRecord): Promise<QuizRecord>;
  getQuiz(workspaceId: string, quizId: string): Promise<QuizRecord | null>;
  updateQuiz(workspaceId: string, quizId: string, draft: QuizDraft): Promise<QuizRecord | null>;
  archiveQuiz(
    workspaceId: string,
    quizId: string,
    archived: boolean,
    maxPublishedQuizzes?: number | null,
  ): Promise<QuizRecord | null>;
  duplicateQuiz(input: QuizRecord): Promise<QuizRecord>;
  publishQuiz(
    input: QuizVersionRecord,
    maxPublishedQuizzes?: number | null,
  ): Promise<QuizVersionRecord>;
  getQuizVersion(workspaceId: string, versionId: string): Promise<QuizVersionRecord | null>;
  countPublishedQuizzes(workspaceId: string): Promise<number>;
  getBrandTheme(workspaceId: string): Promise<BrandTheme | null>;
  updateBrandTheme(workspaceId: string, theme: BrandTheme | null): Promise<BrandTheme | null>;
  createSession(input: StoredSession): Promise<void>;
  getSessionById(sessionId: string): Promise<StoredSession | null>;
  getSessionByCode(code: string): Promise<StoredSession | null>;
  listSessionIds(workspaceId: string): Promise<string[]>;
  saveSession(input: StoredSession, expectedVersion: number, report?: Report): Promise<void>;
  deleteSession(workspaceId: string, sessionId: string): Promise<boolean>;
  createParticipant(input: ParticipantRecord): Promise<void>;
  commitParticipants(
    session: StoredSession,
    participants: ParticipantRecord[],
    expectedVersion: number,
  ): Promise<void>;
  getParticipantByToken(tokenHash: string): Promise<ParticipantRecord | null>;
  getParticipants(sessionId: string): Promise<ParticipantRecord[]>;
  createMediaAsset(input: MediaAssetRecord): Promise<MediaAssetRecord>;
  getMediaAsset(workspaceId: string, mediaId: string): Promise<MediaAssetRecord | null>;
  listMediaAssets(workspaceId: string): Promise<MediaAssetRecord[]>;
  listStaleMedia(cutoff: Date, limit?: number): Promise<MediaAssetRecord[]>;
  updateMediaAsset(
    workspaceId: string,
    mediaId: string,
    update: { objectKey?: string; scanStatus: MediaScanStatus },
  ): Promise<MediaAssetRecord | null>;
  deleteMediaAsset(workspaceId: string, mediaId: string): Promise<boolean>;
  persistAnswer(
    workspaceId: string,
    sessionId: string,
    answer: EngineAnswer,
  ): Promise<EngineAnswer>;
  commitAnswer(
    session: StoredSession,
    answer: EngineAnswer,
    expectedVersion: number,
  ): Promise<EngineAnswer>;
  commitAnswers(
    session: StoredSession,
    answers: EngineAnswer[],
    expectedVersion: number,
  ): Promise<EngineAnswer[]>;
  saveReport(workspaceId: string, report: Report): Promise<void>;
  getReport(workspaceId: string, reportId: string): Promise<Report | null>;
  getReportBySession(workspaceId: string, sessionId: string): Promise<Report | null>;
  getPlan(workspaceId: string): Promise<Plan>;
  getBillingProfile(workspaceId: string): Promise<BillingProfile>;
  setPlan(
    workspaceId: string,
    plan: Plan,
    provider?: { customerId?: string; subscriptionId?: string; status?: string },
  ): Promise<void>;
  recordBillingEvent(providerEventId: string, eventType: string): Promise<boolean>;
  applyBillingEvent(input: BillingEventInput): Promise<boolean>;
  recordAudit(input: AuditInput): Promise<void>;
  exportAccount(userId: string): Promise<Record<string, unknown>>;
  deleteAccount(userId: string): Promise<void>;
  expireLiveSessions(now: Date): Promise<string[]>;
  purgeExpired(now: Date): Promise<string[]>;
}

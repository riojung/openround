import type {
  BrandTheme,
  AuthoringDraft,
  AuthoringSourceType,
  ConfidenceValue,
  FollowupTimeMode,
  IdentityRequirement,
  InstitutionCapabilities,
  InstitutionContractStatus,
  QuizDraft,
  Report,
  ResponsePayload,
  TimeMultiplier,
} from "@openround/contracts";
import type {
  EngineAnswer,
  EngineIntervention,
  EngineRound,
  GameState,
} from "@openround/game-engine";

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

export interface WorkspaceSummaryRecord {
  id: string;
  name: string;
  segment: Segment;
  role: CreatorContext["role"];
  homeRegion: string;
}

export interface WorkspaceMemberRecord {
  userId: string;
  email: string;
  role: CreatorContext["role"];
  joinedAt: Date | null;
}

export interface WorkspaceInvitationRecord {
  id: string;
  workspaceId: string;
  email: string;
  role: Exclude<CreatorContext["role"], "owner">;
  tokenHash: string;
  invitedBy: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface InstitutionPolicyRecord {
  workspaceId: string;
  contractStatus: InstitutionContractStatus;
  identityRequirement: IdentityRequirement;
  capabilities: InstitutionCapabilities;
  k12Enabled: false;
  updatedAt: Date | null;
}

export interface ExternalIdentityRecord {
  id: string;
  workspaceId: string;
  userId: string;
  provider: "oidc" | "lti";
  issuer: string;
  subject: string;
  emailHint: string | null;
  linkedAt: Date;
  lastUsedAt: Date | null;
}

export interface FederatedAuthTransactionRecord {
  id: string;
  workspaceId: string;
  userId: string | null;
  mode: "login" | "link";
  stateHash: string;
  codeVerifier: string;
  nonce: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface LtiRegistrationRecord {
  id: string;
  workspaceId: string;
  name: string;
  issuer: string;
  clientId: string;
  deploymentId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string | null;
  jwksUrl: string;
  deepLinkReturnOrigins: string[];
  status: "disabled" | "active";
  createdAt: Date;
  updatedAt: Date;
}

export interface LtiLoginTransactionRecord {
  id: string;
  workspaceId: string;
  registrationId: string;
  stateHash: string;
  nonce: string;
  targetLinkUri: string;
  ltiMessageHint: string | null;
  expiresAt: Date;
  createdAt: Date;
}

export interface LtiLaunchRecord {
  id: string;
  workspaceId: string;
  registrationId: string;
  creatorUserId: string | null;
  subject: string | null;
  messageType: "LtiResourceLinkRequest" | "LtiDeepLinkingRequest";
  role: "instructor" | "learner";
  targetLinkUri: string;
  quizId: string | null;
  contextId: string | null;
  resourceLinkId: string | null;
  deepLinkReturnUrl: string | null;
  deepLinkData: string | null;
  linkTokenHash: string | null;
  responseJwt: string | null;
  completedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
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
  folderId?: string | null;
  tags?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface FolderRecord {
  id: string;
  workspaceId: string;
  name: string;
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

export interface SessionEvidence {
  answers: EngineAnswer[];
  rounds: Array<EngineRound & { id: string }>;
  interventions: EngineIntervention[];
  qna: {
    questions: number;
    answered: number;
    unresolved: number;
  };
}

export interface ReportJob {
  reportId: string;
  workspaceId: string;
  sessionId: string;
  attempts: number;
  expiresAt: Date;
}

export interface FollowupRecord {
  id: string;
  workspaceId: string;
  sourceSessionId: string;
  sourceReportId: string;
  title: string;
  content: QuizDraft;
  conceptKeys: string[];
  timeMode: FollowupTimeMode;
  genericTokenHash: string;
  opensAt: Date;
  closesAt: Date;
  expiresAt: Date;
  closedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
}

export interface FollowupAccessRecord {
  id: string;
  workspaceId: string;
  followupId: string;
  sourceParticipantId: string | null;
  kind: "personal" | "accommodation";
  label: string;
  tokenHash: string;
  timeMultiplier: TimeMultiplier;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface FollowupAttemptRecord {
  id: string;
  workspaceId: string;
  followupId: string;
  accessTokenId: string | null;
  sourceParticipantId: string | null;
  attemptTokenHash: string;
  status: "in_progress" | "completed";
  phase: "question_open" | "answer_reveal" | "completed";
  currentIndex: number;
  version: number;
  timeMultiplier: TimeMultiplier;
  questionOpenedAt: Date;
  deadlineAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FollowupAnswerRecord {
  id: string;
  workspaceId: string;
  followupId: string;
  attemptId: string;
  checkpointId: string;
  response: ResponsePayload;
  confidence: ConfidenceValue | null;
  correct: boolean | null;
  idempotencyKey: string;
  acceptedAt: Date;
}

export interface AuthoringJobRecord {
  id: string;
  workspaceId: string;
  createdBy: string | null;
  sourceType: AuthoringSourceType;
  sourceName: string;
  sourceMimeType: string | null;
  sourceText: string | null;
  sourceBlob: Buffer | null;
  sourceDigest: string;
  status: "pending" | "processing" | "ready" | "failed";
  attempts: number;
  appliedQuizId: string | null;
  availableAt: Date;
  output: AuthoringDraft | null;
  lastError: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AnswerLookup {
  participantId: string;
  roundId: string;
  idempotencyKey: string;
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

export class FollowupVersionConflictError extends Error {
  constructor(
    public readonly attemptId: string,
    public readonly expectedVersion: number,
  ) {
    super(`Follow-up attempt ${attemptId} no longer has expected version ${expectedVersion}`);
    this.name = "FollowupVersionConflictError";
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

export interface SessionStaffCredentialRecord {
  id: string;
  workspaceId: string;
  sessionId: string;
  role: "cohost" | "presenter";
  label: string;
  tokenHash: string;
  embedPolicyKeyHash?: string | null;
  embedAllowedOrigins?: string[];
  createdBy: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface QnaSettingsRecord {
  workspaceId: string;
  sessionId: string;
  enabled: boolean;
  displayMode: "anonymous_public" | "alias_public";
  moderationMode: "pre" | "post";
  participantReplies: boolean;
  updatedAt: Date;
}

export interface QnaQuestionRecord {
  id: string;
  workspaceId: string;
  sessionId: string;
  participantId: string;
  body: string;
  publicAlias: string;
  status: "pending" | "published" | "answered" | "dismissed" | "removed";
  label: string | null;
  voteCount: number;
  votedByViewer: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface QnaReplyRecord {
  id: string;
  workspaceId: string;
  sessionId: string;
  questionId: string;
  participantId: string | null;
  actorId: string | null;
  staffCredentialId: string | null;
  body: string;
  publicAlias: string;
  status: "pending" | "published" | "removed";
  createdAt: Date;
  updatedAt: Date;
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

export interface AuditEventRecord extends AuditInput {
  id: string;
  createdAt: Date;
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
    activeWorkspaceId?: string;
  }): Promise<void>;
  getCreatorBySession(tokenHash: string, now: Date): Promise<CreatorContext | null>;
  listWorkspaces(userId: string): Promise<WorkspaceSummaryRecord[]>;
  setCreatorSessionWorkspace(
    tokenHash: string,
    userId: string,
    workspaceId: string,
  ): Promise<boolean>;
  listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberRecord[]>;
  updateWorkspaceMemberRole(
    workspaceId: string,
    userId: string,
    role: Exclude<CreatorContext["role"], "owner">,
  ): Promise<WorkspaceMemberRecord | null>;
  removeWorkspaceMember(workspaceId: string, userId: string): Promise<boolean>;
  createWorkspaceInvitation(input: WorkspaceInvitationRecord): Promise<WorkspaceInvitationRecord>;
  listWorkspaceInvitations(workspaceId: string): Promise<WorkspaceInvitationRecord[]>;
  revokeWorkspaceInvitation(workspaceId: string, invitationId: string): Promise<boolean>;
  acceptWorkspaceInvitation(
    tokenHash: string,
    now: Date,
    policyVersion: string,
  ): Promise<CreatorContext | null>;
  revokeCreatorSession(tokenHash: string): Promise<void>;
  getCreatorByUserId(userId: string, workspaceId: string): Promise<CreatorContext | null>;
  listQuizzes(workspaceId: string, includeArchived?: boolean): Promise<QuizRecord[]>;
  listFolders(workspaceId: string): Promise<FolderRecord[]>;
  createFolder(input: FolderRecord): Promise<FolderRecord>;
  renameFolder(workspaceId: string, folderId: string, name: string): Promise<FolderRecord | null>;
  deleteFolder(workspaceId: string, folderId: string): Promise<boolean>;
  organizeQuiz(
    workspaceId: string,
    quizId: string,
    folderId: string | null,
    tags: string[],
  ): Promise<QuizRecord | null>;
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
  getEmbedAllowedOrigins(workspaceId: string): Promise<string[]>;
  updateEmbedAllowedOrigins(workspaceId: string, origins: string[]): Promise<string[]>;
  getInstitutionPolicy(workspaceId: string): Promise<InstitutionPolicyRecord>;
  updateInstitutionPolicy(input: InstitutionPolicyRecord, requestId: string): Promise<void>;
  createFederatedAuthTransaction(input: FederatedAuthTransactionRecord): Promise<void>;
  consumeFederatedAuthTransaction(
    stateHash: string,
    now: Date,
  ): Promise<FederatedAuthTransactionRecord | null>;
  linkExternalIdentity(input: ExternalIdentityRecord): Promise<ExternalIdentityRecord | null>;
  getExternalIdentity(
    workspaceId: string,
    provider: ExternalIdentityRecord["provider"],
    issuer: string,
    subject: string,
  ): Promise<ExternalIdentityRecord | null>;
  listExternalIdentities(workspaceId: string, userId: string): Promise<ExternalIdentityRecord[]>;
  touchExternalIdentity(identityId: string, usedAt: Date): Promise<void>;
  unlinkExternalIdentity(workspaceId: string, userId: string, identityId: string): Promise<boolean>;
  upsertLtiRegistration(input: LtiRegistrationRecord): Promise<LtiRegistrationRecord>;
  listLtiRegistrations(workspaceId: string): Promise<LtiRegistrationRecord[]>;
  getLtiRegistration(registrationId: string): Promise<LtiRegistrationRecord | null>;
  findLtiRegistration(
    issuer: string,
    clientId?: string,
    deploymentId?: string,
  ): Promise<LtiRegistrationRecord | null>;
  createLtiLoginTransaction(input: LtiLoginTransactionRecord): Promise<void>;
  consumeLtiLoginTransaction(
    stateHash: string,
    now: Date,
  ): Promise<LtiLoginTransactionRecord | null>;
  createLtiLaunch(input: LtiLaunchRecord): Promise<LtiLaunchRecord>;
  getLtiLaunch(workspaceId: string, launchId: string, now: Date): Promise<LtiLaunchRecord | null>;
  bindLtiLaunch(
    linkTokenHash: string,
    userId: string,
    identityId: string,
    now: Date,
  ): Promise<LtiLaunchRecord | null>;
  completeLtiDeepLink(
    workspaceId: string,
    launchId: string,
    userId: string,
    quizId: string,
    responseJwt: string,
    completedAt: Date,
  ): Promise<LtiLaunchRecord | null>;
  getEmbedPolicyByKey(
    policyKeyHash: string,
    sessionId: string,
    now: Date,
  ): Promise<{ allowedOrigins: string[]; expiresAt: Date } | null>;
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
  createSessionStaffCredential(
    input: SessionStaffCredentialRecord,
  ): Promise<SessionStaffCredentialRecord>;
  getSessionStaffByToken(
    tokenHash: string,
    now: Date,
  ): Promise<SessionStaffCredentialRecord | null>;
  listSessionStaff(workspaceId: string, sessionId: string): Promise<SessionStaffCredentialRecord[]>;
  revokeSessionStaff(workspaceId: string, credentialId: string): Promise<boolean>;
  getWorkspaceSegment(workspaceId: string): Promise<Segment>;
  getQnaSettings(workspaceId: string, sessionId: string): Promise<QnaSettingsRecord | null>;
  saveQnaSettings(input: QnaSettingsRecord): Promise<QnaSettingsRecord>;
  createQnaQuestion(input: QnaQuestionRecord): Promise<QnaQuestionRecord>;
  getQnaQuestion(workspaceId: string, questionId: string): Promise<QnaQuestionRecord | null>;
  listQnaQuestions(
    workspaceId: string,
    sessionId: string,
    viewerParticipantId?: string,
  ): Promise<QnaQuestionRecord[]>;
  updateQnaQuestion(
    workspaceId: string,
    questionId: string,
    update: Pick<QnaQuestionRecord, "status" | "label">,
  ): Promise<QnaQuestionRecord | null>;
  createQnaReply(input: QnaReplyRecord): Promise<QnaReplyRecord>;
  getQnaReply(workspaceId: string, replyId: string): Promise<QnaReplyRecord | null>;
  listQnaReplies(workspaceId: string, questionId: string): Promise<QnaReplyRecord[]>;
  updateQnaReply(
    workspaceId: string,
    replyId: string,
    status: QnaReplyRecord["status"],
  ): Promise<QnaReplyRecord | null>;
  setQnaVote(
    workspaceId: string,
    sessionId: string,
    questionId: string,
    participantId: string,
    voted: boolean,
  ): Promise<number>;
  isQnaBanned(workspaceId: string, sessionId: string, participantId: string): Promise<boolean>;
  banQnaParticipant(
    workspaceId: string,
    sessionId: string,
    participantId: string,
    actorId: string | null,
  ): Promise<void>;
  getSessionEvidence(workspaceId: string, sessionId: string): Promise<SessionEvidence>;
  findAnswers(
    workspaceId: string,
    sessionId: string,
    lookups: AnswerLookup[],
  ): Promise<EngineAnswer[]>;
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
  claimReportJob(now: Date, leaseUntil: Date): Promise<ReportJob | null>;
  completeReportJob(job: ReportJob, report: Report): Promise<void>;
  retryReportJob(job: ReportJob, error: string, availableAt: Date, failed: boolean): Promise<void>;
  getReport(workspaceId: string, reportId: string): Promise<Report | null>;
  getReportBySession(workspaceId: string, sessionId: string): Promise<Report | null>;
  createFollowup(input: FollowupRecord, access: FollowupAccessRecord[]): Promise<void>;
  getFollowup(workspaceId: string, followupId: string): Promise<FollowupRecord | null>;
  getFollowupByReport(workspaceId: string, reportId: string): Promise<FollowupRecord | null>;
  getFollowupByGenericToken(
    followupId: string,
    tokenHash: string,
    now: Date,
  ): Promise<FollowupRecord | null>;
  getFollowupAccessByToken(
    followupId: string,
    tokenHash: string,
    now: Date,
  ): Promise<FollowupAccessRecord | null>;
  listFollowupAccess(workspaceId: string, followupId: string): Promise<FollowupAccessRecord[]>;
  createFollowupAccess(input: FollowupAccessRecord): Promise<FollowupAccessRecord>;
  revokeFollowupAccess(
    workspaceId: string,
    followupId: string,
    accessId: string,
    revokedAt: Date,
  ): Promise<boolean>;
  closeFollowup(workspaceId: string, followupId: string, closedAt: Date): Promise<boolean>;
  createOrGetFollowupAttempt(input: FollowupAttemptRecord): Promise<FollowupAttemptRecord>;
  getFollowupAttemptByToken(
    followupId: string,
    tokenHash: string,
    now: Date,
  ): Promise<FollowupAttemptRecord | null>;
  getFollowupAnswer(attemptId: string, checkpointId: string): Promise<FollowupAnswerRecord | null>;
  commitFollowupAnswer(
    attempt: FollowupAttemptRecord,
    answer: FollowupAnswerRecord,
    expectedVersion: number,
  ): Promise<FollowupAnswerRecord>;
  advanceFollowupAttempt(attempt: FollowupAttemptRecord, expectedVersion: number): Promise<boolean>;
  createAuthoringJob(input: AuthoringJobRecord): Promise<AuthoringJobRecord>;
  createAuthoringJobWithinLimit(
    input: AuthoringJobRecord,
    since: Date,
    monthlyLimit: number | null,
  ): Promise<AuthoringJobRecord | null>;
  countAuthoringJobsSince(workspaceId: string, since: Date): Promise<number>;
  getAuthoringJob(workspaceId: string, jobId: string): Promise<AuthoringJobRecord | null>;
  listAuthoringJobs(workspaceId: string, limit: number): Promise<AuthoringJobRecord[]>;
  claimAuthoringJob(now: Date, leaseUntil: Date): Promise<AuthoringJobRecord | null>;
  completeAuthoringJob(
    jobId: string,
    expectedAttempts: number,
    output: AuthoringDraft,
    completedAt: Date,
  ): Promise<boolean>;
  applyAuthoringJobDraft(
    workspaceId: string,
    jobId: string,
    quiz: QuizRecord,
  ): Promise<QuizRecord | null>;
  retryAuthoringJob(
    jobId: string,
    expectedAttempts: number,
    error: string,
    availableAt: Date,
    failed: boolean,
  ): Promise<boolean>;
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
  listAuditEvents(
    workspaceId: string,
    since: Date | null,
    limit: number,
  ): Promise<AuditEventRecord[]>;
  purgeAuditEvents(cutoff: Date): Promise<number>;
  exportAccount(userId: string): Promise<Record<string, unknown>>;
  deleteAccount(userId: string): Promise<void>;
  expireLiveSessions(now: Date): Promise<string[]>;
  purgeExpired(now: Date): Promise<string[]>;
}

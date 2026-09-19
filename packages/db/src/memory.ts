import type { EngineAnswer } from "@openround/game-engine";
import {
  AudienceStoreError,
  FollowupVersionConflictError,
  PublishedQuizLimitError,
  SessionCodeConflictError,
  SessionNotActiveError,
  SessionVersionConflictError,
} from "./types.js";
import type {
  AudienceEventInput,
  AudienceMutation,
  AudienceOutboxRecord,
  AudienceRestrictionRecord,
  AuditEventRecord,
  AuditInput,
  AnswerLookup,
  AuthoringJobRecord,
  BillingEventInput,
  ChatMessageListOptions,
  ChatMessageRecord,
  ChatReactionRecord,
  ChatReactionSummaryRecord,
  CreatorContext,
  FolderRecord,
  FollowupAccessRecord,
  FollowupAnswerRecord,
  FollowupAttemptRecord,
  FollowupRecord,
  FollowupHistoryRecord,
  FederatedAuthTransactionRecord,
  HistoryCursor,
  ExternalIdentityRecord,
  InstitutionPolicyRecord,
  InteractionSettingsRecord,
  LtiLaunchRecord,
  LtiLoginTransactionRecord,
  LtiRegistrationRecord,
  MagicTokenRecord,
  MediaAssetRecord,
  MediaScanStatus,
  OperationalFeaturesRecord,
  OperationalFeaturesUpdate,
  ParticipantRecord,
  ParticipantSignalRecord,
  Plan,
  ProductEventRecord,
  QnaQuestionRecord,
  QnaReplyRecord,
  QnaSettingsRecord,
  QuizRecord,
  QuizVersionRecord,
  ReportJob,
  ReportHistoryRecord,
  Repository,
  SessionStaffCredentialRecord,
  SessionStaffCredentialInput,
  SessionHistoryRecord,
  StoredSession,
  WorkspaceInvitationRecord,
  WorkspaceMemberRecord,
  WorkspaceSummaryRecord,
} from "./types.js";
import {
  questionDelivery,
  type BrandTheme,
  type QuizDraft,
  type Report,
} from "@openround/contracts";

interface UserRecord extends CreatorContext {
  deletedAt: Date | null;
}

interface ConsentRecord {
  workspaceId: string;
  userId: string;
  documentType: "terms" | "privacy";
  documentVersion: string;
  acceptedAt: Date;
}

interface MemoryWorkspace {
  id: string;
  name: string;
  segment: CreatorContext["segment"];
  homeRegion: string;
  embedAllowedOrigins: string[];
}

export class MemoryRepository implements Repository {
  private nextInitialWorkspaceId: string | undefined;
  readonly magicTokens = new Map<string, MagicTokenRecord>();
  readonly creatorSessions = new Map<
    string,
    { userId: string; activeWorkspaceId: string; expiresAt: Date; revoked: boolean }
  >();
  readonly users = new Map<string, UserRecord>();
  readonly workspaces = new Map<string, MemoryWorkspace>();
  readonly workspaceMembers = new Map<
    string,
    { workspaceId: string; userId: string; role: CreatorContext["role"]; joinedAt: Date }
  >();
  readonly workspaceInvitations = new Map<string, WorkspaceInvitationRecord>();
  readonly institutionPolicies = new Map<string, InstitutionPolicyRecord>();
  readonly externalIdentities = new Map<string, ExternalIdentityRecord>();
  readonly federatedAuthTransactions = new Map<string, FederatedAuthTransactionRecord>();
  readonly ltiRegistrations = new Map<string, LtiRegistrationRecord>();
  readonly ltiLoginTransactions = new Map<string, LtiLoginTransactionRecord>();
  readonly ltiLaunches = new Map<string, LtiLaunchRecord>();
  readonly quizzes = new Map<string, QuizRecord>();
  readonly folders = new Map<string, FolderRecord>();
  readonly versions = new Map<string, QuizVersionRecord>();
  readonly sessions = new Map<string, StoredSession>();
  readonly participants = new Map<string, ParticipantRecord>();
  readonly sessionStaff = new Map<string, SessionStaffCredentialRecord>();
  readonly qnaSettings = new Map<string, QnaSettingsRecord>();
  readonly qnaQuestions = new Map<string, QnaQuestionRecord>();
  readonly qnaReplies = new Map<string, QnaReplyRecord>();
  readonly qnaVotes = new Set<string>();
  readonly qnaBans = new Set<string>();
  readonly interactionSettings = new Map<string, InteractionSettingsRecord>();
  readonly participantSignals = new Map<string, ParticipantSignalRecord>();
  readonly signalEvents: Array<{
    workspaceId: string;
    sessionId: string;
    participantId: string;
    contextKey: string;
    signal: ParticipantSignalRecord["signal"] | null;
    idempotencyKey: string;
    createdAt: Date;
  }> = [];
  readonly chatMessages = new Map<string, ChatMessageRecord>();
  readonly chatReactions = new Map<string, ChatReactionRecord>();
  readonly chatReports = new Set<string>();
  readonly audienceRestrictions = new Map<string, AudienceRestrictionRecord>();
  readonly audienceOutbox = new Map<string, AudienceOutboxRecord>();
  readonly mediaAssets = new Map<string, MediaAssetRecord>();
  readonly answers = new Map<string, EngineAnswer>();
  readonly reports = new Map<string, Report>();
  readonly reportCreatedAt = new Map<string, Date>();
  readonly followups = new Map<string, FollowupRecord>();
  readonly followupAccess = new Map<string, FollowupAccessRecord>();
  readonly followupAttempts = new Map<string, FollowupAttemptRecord>();
  readonly followupAnswers = new Map<string, FollowupAnswerRecord>();
  readonly authoringJobs = new Map<string, AuthoringJobRecord>();
  readonly reportJobs = new Map<
    string,
    { workspaceId: string; attempts: number; availableAt: Date; lastError: string | null }
  >();
  readonly expiredLiveSessions = new Set<string>();
  readonly plans = new Map<string, Plan>();
  readonly brandThemes = new Map<string, BrandTheme>();
  readonly billingProfiles = new Map<
    string,
    { status: string; customerId: string | null; subscriptionId: string | null }
  >();
  readonly billingEvents = new Set<string>();
  readonly billingEventCreatedAt = new Map<string, Date>();
  readonly audits: AuditEventRecord[] = [];
  readonly productEvents: ProductEventRecord[] = [];
  readonly consents: ConsentRecord[] = [];
  readonly operationalFeatures: OperationalFeaturesRecord = {
    signups: true,
    sessionCreation: true,
    mediaUploads: true,
    roundExperiences: true,
    audiencePulse: true,
    roomChat: true,
    updatedAt: null,
  };

  constructor(options: { initialWorkspaceId?: string } = {}) {
    this.nextInitialWorkspaceId = options.initialWorkspaceId;
  }

  async initialize() {}
  async close() {}

  async getOperationalFeatures() {
    return structuredClone(this.operationalFeatures);
  }

  async updateOperationalFeatures(input: OperationalFeaturesUpdate, requestId: string) {
    const before = structuredClone(this.operationalFeatures);
    Object.assign(this.operationalFeatures, input, { updatedAt: new Date() });
    this.audits.push({
      id: crypto.randomUUID(),
      workspaceId: null,
      actorId: null,
      action: "operations.features.update",
      targetType: "operational_features",
      targetId: "global",
      requestId,
      metadata: { before, after: structuredClone(this.operationalFeatures) },
      createdAt: new Date(),
    });
    return structuredClone(this.operationalFeatures);
  }

  async createMagicToken(input: MagicTokenRecord) {
    this.magicTokens.set(input.tokenHash, structuredClone(input));
  }

  async consumeMagicToken(tokenHash: string, now: Date) {
    const token = this.magicTokens.get(tokenHash);
    if (!token || token.consumedAt || token.expiresAt <= now) return null;
    token.consumedAt = now;
    let user = [...this.users.values()].find((candidate) => candidate.email === token.email);
    if (!user) {
      const userId = crypto.randomUUID();
      const workspaceId =
        this.nextInitialWorkspaceId && !this.workspaces.has(this.nextInitialWorkspaceId)
          ? this.nextInitialWorkspaceId
          : crypto.randomUUID();
      this.nextInitialWorkspaceId = undefined;
      user = {
        userId,
        workspaceId,
        email: token.email,
        segment: token.segment,
        role: "owner",
        plan: "free",
        deletedAt: null,
      };
      this.users.set(userId, user);
      this.plans.set(user.workspaceId, "free");
      this.workspaces.set(user.workspaceId, {
        id: user.workspaceId,
        name: `${token.email.split("@")[0]}'s workspace`,
        segment: token.segment,
        homeRegion: "ca-central-1",
        embedAllowedOrigins: [],
      });
      this.workspaceMembers.set(`${user.workspaceId}:${userId}`, {
        workspaceId: user.workspaceId,
        userId,
        role: "owner",
        joinedAt: now,
      });
    }
    for (const documentType of ["terms", "privacy"] as const) {
      if (
        !this.consents.some(
          (record) =>
            record.workspaceId === user!.workspaceId &&
            record.userId === user!.userId &&
            record.documentType === documentType &&
            record.documentVersion === token.policyVersion,
        )
      ) {
        this.consents.push({
          workspaceId: user.workspaceId,
          userId: user.userId,
          documentType,
          documentVersion: token.policyVersion,
          acceptedAt: now,
        });
      }
    }
    return this.contextFor(user);
  }

  async createCreatorSession(input: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    activeWorkspaceId?: string;
  }) {
    const user = this.users.get(input.userId);
    if (!user) throw new Error("Creator not found");
    this.creatorSessions.set(input.tokenHash, {
      userId: input.userId,
      activeWorkspaceId: input.activeWorkspaceId ?? user.workspaceId,
      expiresAt: input.expiresAt,
      revoked: false,
    });
  }

  async getCreatorBySession(tokenHash: string, now: Date) {
    const session = this.creatorSessions.get(tokenHash);
    if (!session || session.revoked || session.expiresAt <= now) return null;
    const user = this.users.get(session.userId);
    return user && !user.deletedAt ? this.contextFor(user, session.activeWorkspaceId) : null;
  }

  async listWorkspaces(userId: string): Promise<WorkspaceSummaryRecord[]> {
    const user = this.users.get(userId);
    if (!user || user.deletedAt) return [];
    const memberships = [...this.workspaceMembers.values()].filter(
      (membership) => membership.userId === userId,
    );
    if (!memberships.some((membership) => membership.workspaceId === user.workspaceId)) {
      memberships.push({
        workspaceId: user.workspaceId,
        userId,
        role: user.role,
        joinedAt: new Date(),
      });
    }
    return memberships
      .map((membership) => {
        const workspace = this.workspaces.get(membership.workspaceId);
        if (!workspace) return null;
        return {
          id: workspace.id,
          name: workspace.name,
          segment: workspace.segment,
          role: workspace.id === user.workspaceId ? user.role : membership.role,
          homeRegion: workspace.homeRegion,
        } satisfies WorkspaceSummaryRecord;
      })
      .filter((workspace): workspace is WorkspaceSummaryRecord => workspace !== null)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async setCreatorSessionWorkspace(tokenHash: string, userId: string, workspaceId: string) {
    const session = this.creatorSessions.get(tokenHash);
    const user = this.users.get(userId);
    if (!session || session.userId !== userId || !user) return false;
    const member =
      user.workspaceId === workspaceId || this.workspaceMembers.has(`${workspaceId}:${userId}`);
    if (!member) return false;
    session.activeWorkspaceId = workspaceId;
    return true;
  }

  async listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberRecord[]> {
    return [...this.workspaceMembers.values()]
      .filter((membership) => membership.workspaceId === workspaceId)
      .flatMap((membership): WorkspaceMemberRecord[] => {
        const user = this.users.get(membership.userId);
        return user && !user.deletedAt
          ? [
              {
                userId: user.userId,
                email: user.email,
                role: user.workspaceId === workspaceId ? user.role : membership.role,
                joinedAt: membership.joinedAt,
              },
            ]
          : [];
      })
      .sort((left, right) => left.email.localeCompare(right.email));
  }

  async updateWorkspaceMemberRole(workspaceId: string, userId: string, role: "editor" | "viewer") {
    const membership = this.workspaceMembers.get(`${workspaceId}:${userId}`);
    const user = this.users.get(userId);
    if (!membership || membership.role === "owner" || !user) return null;
    membership.role = role;
    if (user.workspaceId === workspaceId) user.role = role;
    return { userId, email: user.email, role, joinedAt: membership.joinedAt };
  }

  async removeWorkspaceMember(workspaceId: string, userId: string) {
    const key = `${workspaceId}:${userId}`;
    const membership = this.workspaceMembers.get(key);
    if (!membership || membership.role === "owner") return false;
    this.workspaceMembers.delete(key);
    for (const session of this.creatorSessions.values()) {
      if (session.userId === userId && session.activeWorkspaceId === workspaceId) {
        const fallback = [...this.workspaceMembers.values()].find(
          (candidate) => candidate.userId === userId,
        );
        if (fallback) session.activeWorkspaceId = fallback.workspaceId;
        else session.revoked = true;
      }
    }
    return true;
  }

  async createWorkspaceInvitation(input: WorkspaceInvitationRecord) {
    const duplicate = [...this.workspaceInvitations.values()].find(
      (invitation) =>
        invitation.workspaceId === input.workspaceId &&
        invitation.email === input.email &&
        !invitation.acceptedAt &&
        !invitation.revokedAt,
    );
    if (duplicate) throw Object.assign(new Error("Invitation already exists"), { code: "23505" });
    this.workspaceInvitations.set(input.id, structuredClone(input));
    return structuredClone(input);
  }

  async listWorkspaceInvitations(workspaceId: string) {
    return [...this.workspaceInvitations.values()]
      .filter((invitation) => invitation.workspaceId === workspaceId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map((invitation) => structuredClone(invitation));
  }

  async revokeWorkspaceInvitation(workspaceId: string, invitationId: string) {
    const invitation = this.workspaceInvitations.get(invitationId);
    if (
      !invitation ||
      invitation.workspaceId !== workspaceId ||
      invitation.acceptedAt ||
      invitation.revokedAt
    )
      return false;
    invitation.revokedAt = new Date();
    return true;
  }

  async acceptWorkspaceInvitation(tokenHash: string, now: Date, policyVersion: string) {
    const invitation = [...this.workspaceInvitations.values()].find(
      (candidate) =>
        candidate.tokenHash === tokenHash &&
        !candidate.acceptedAt &&
        !candidate.revokedAt &&
        candidate.expiresAt > now,
    );
    if (!invitation) return null;
    let user = [...this.users.values()].find(
      (candidate) => candidate.email === invitation.email && !candidate.deletedAt,
    );
    if (!user) {
      const workspace = this.workspaces.get(invitation.workspaceId);
      if (!workspace) return null;
      user = {
        userId: crypto.randomUUID(),
        workspaceId: invitation.workspaceId,
        email: invitation.email,
        segment: workspace.segment,
        role: invitation.role,
        plan: this.plans.get(invitation.workspaceId) ?? "free",
        deletedAt: null,
      };
      this.users.set(user.userId, user);
    }
    const key = `${invitation.workspaceId}:${user.userId}`;
    const existing = this.workspaceMembers.get(key);
    if (!existing) {
      this.workspaceMembers.set(key, {
        workspaceId: invitation.workspaceId,
        userId: user.userId,
        role: invitation.role,
        joinedAt: now,
      });
    }
    invitation.acceptedAt = now;
    for (const documentType of ["terms", "privacy"] as const) {
      if (
        !this.consents.some(
          (record) =>
            record.workspaceId === invitation.workspaceId &&
            record.userId === user!.userId &&
            record.documentType === documentType &&
            record.documentVersion === policyVersion,
        )
      ) {
        this.consents.push({
          workspaceId: invitation.workspaceId,
          userId: user.userId,
          documentType,
          documentVersion: policyVersion,
          acceptedAt: now,
        });
      }
    }
    return this.contextFor(user, invitation.workspaceId);
  }

  async revokeCreatorSession(tokenHash: string) {
    const session = this.creatorSessions.get(tokenHash);
    if (session) session.revoked = true;
  }

  async getCreatorByUserId(userId: string, workspaceId: string) {
    const user = this.users.get(userId);
    return user && !user.deletedAt ? this.contextFor(user, workspaceId) : null;
  }

  private contextFor(user: UserRecord, workspaceId = user.workspaceId): CreatorContext | null {
    const workspace = this.workspaces.get(workspaceId);
    const membership = this.workspaceMembers.get(`${workspaceId}:${user.userId}`);
    if (!workspace || !membership) return null;
    return {
      userId: user.userId,
      workspaceId,
      email: user.email,
      segment: workspace.segment,
      role: workspaceId === user.workspaceId ? user.role : membership.role,
      plan: this.plans.get(workspaceId) ?? "free",
    };
  }

  async listQuizzes(workspaceId: string, includeArchived = false) {
    const quizIdByVersionId = new Map(
      [...this.versions.values()]
        .filter((version) => version.workspaceId === workspaceId)
        .map((version) => [version.id, version.quizId]),
    );
    const lastHostedAtByQuizId = new Map<string, Date>();
    for (const session of this.sessions.values()) {
      if (session.workspaceId !== workspaceId) continue;
      const quizId = quizIdByVersionId.get(session.quizVersionId);
      if (!quizId) continue;
      const current = lastHostedAtByQuizId.get(quizId);
      if (!current || session.createdAt > current) {
        lastHostedAtByQuizId.set(quizId, session.createdAt);
      }
    }
    return [...this.quizzes.values()]
      .filter(
        (quiz) =>
          quiz.workspaceId === workspaceId && (includeArchived || quiz.status !== "archived"),
      )
      .sort(
        (left, right) =>
          right.updatedAt.getTime() - left.updatedAt.getTime() ||
          (left.id === right.id ? 0 : left.id < right.id ? 1 : -1),
      )
      .map((quiz) => ({
        ...structuredClone(quiz),
        lastHostedAt: structuredClone(lastHostedAtByQuizId.get(quiz.id) ?? null),
      }));
  }

  async listFolders(workspaceId: string) {
    return [...this.folders.values()]
      .filter((folder) => folder.workspaceId === workspaceId)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((folder) => structuredClone(folder));
  }

  async createFolder(input: FolderRecord) {
    const duplicate = [...this.folders.values()].some(
      (folder) =>
        folder.workspaceId === input.workspaceId &&
        folder.name.toLocaleLowerCase() === input.name.toLocaleLowerCase(),
    );
    if (duplicate) {
      const error = new Error("A folder with this name already exists") as Error & {
        code?: string;
      };
      error.code = "23505";
      throw error;
    }
    this.folders.set(input.id, structuredClone(input));
    return structuredClone(input);
  }

  async renameFolder(workspaceId: string, folderId: string, name: string) {
    const folder = this.folders.get(folderId);
    if (!folder || folder.workspaceId !== workspaceId) return null;
    const duplicate = [...this.folders.values()].some(
      (candidate) =>
        candidate.id !== folderId &&
        candidate.workspaceId === workspaceId &&
        candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (duplicate) {
      const error = new Error("A folder with this name already exists") as Error & {
        code?: string;
      };
      error.code = "23505";
      throw error;
    }
    folder.name = name;
    folder.updatedAt = new Date();
    return structuredClone(folder);
  }

  async deleteFolder(workspaceId: string, folderId: string) {
    const folder = this.folders.get(folderId);
    if (!folder || folder.workspaceId !== workspaceId) return false;
    this.folders.delete(folderId);
    for (const quiz of this.quizzes.values()) {
      if (quiz.workspaceId === workspaceId && quiz.folderId === folderId) {
        quiz.folderId = null;
        quiz.updatedAt = new Date();
      }
    }
    return true;
  }

  async organizeQuiz(workspaceId: string, quizId: string, folderId: string | null, tags: string[]) {
    const quiz = this.quizzes.get(quizId);
    if (!quiz || quiz.workspaceId !== workspaceId) return null;
    if (folderId && this.folders.get(folderId)?.workspaceId !== workspaceId) return null;
    quiz.folderId = folderId;
    quiz.tags = [...tags];
    quiz.updatedAt = new Date();
    return structuredClone(quiz);
  }

  async createQuiz(input: QuizRecord) {
    const normalized = { ...input, folderId: input.folderId ?? null, tags: input.tags ?? [] };
    this.quizzes.set(input.id, structuredClone(normalized));
    return structuredClone(normalized);
  }

  async getQuiz(workspaceId: string, quizId: string) {
    const quiz = this.quizzes.get(quizId);
    return quiz?.workspaceId === workspaceId ? structuredClone(quiz) : null;
  }

  async updateQuiz(workspaceId: string, quizId: string, draft: QuizDraft) {
    const quiz = this.quizzes.get(quizId);
    if (!quiz || quiz.workspaceId !== workspaceId || quiz.status === "archived") return null;
    Object.assign(quiz, {
      title: draft.title,
      description: draft.description,
      draft: structuredClone(draft),
      updatedAt: new Date(),
    });
    return structuredClone(quiz);
  }

  async archiveQuiz(
    workspaceId: string,
    quizId: string,
    archived: boolean,
    maxPublishedQuizzes: number | null = null,
  ) {
    const quiz = this.quizzes.get(quizId);
    if (!quiz || quiz.workspaceId !== workspaceId) return null;
    const restoresPublishedQuiz = !archived && quiz.status === "archived" && quiz.currentVersionId;
    const publishedQuizCount = [...this.quizzes.values()].filter(
      (candidate) => candidate.workspaceId === workspaceId && candidate.status === "published",
    ).length;
    if (
      restoresPublishedQuiz &&
      maxPublishedQuizzes !== null &&
      publishedQuizCount >= maxPublishedQuizzes
    ) {
      throw new PublishedQuizLimitError(maxPublishedQuizzes);
    }
    quiz.status = archived ? "archived" : quiz.currentVersionId ? "published" : "draft";
    quiz.updatedAt = new Date();
    return structuredClone(quiz);
  }

  async duplicateQuiz(input: QuizRecord) {
    return this.createQuiz(input);
  }

  async publishQuiz(input: QuizVersionRecord, maxPublishedQuizzes: number | null = null) {
    const quiz = this.quizzes.get(input.quizId);
    if (!quiz || quiz.workspaceId !== input.workspaceId) throw new Error("Quiz not found");
    const publishedQuizCount = [...this.quizzes.values()].filter(
      (candidate) =>
        candidate.workspaceId === input.workspaceId && candidate.status === "published",
    ).length;
    if (
      quiz.status !== "published" &&
      maxPublishedQuizzes !== null &&
      publishedQuizCount >= maxPublishedQuizzes
    ) {
      throw new PublishedQuizLimitError(maxPublishedQuizzes);
    }
    this.versions.set(input.id, structuredClone(input));
    quiz.currentVersionId = input.id;
    quiz.status = "published";
    quiz.updatedAt = new Date();
    return structuredClone(input);
  }

  async getQuizVersion(workspaceId: string, versionId: string) {
    const version = this.versions.get(versionId);
    return version?.workspaceId === workspaceId ? structuredClone(version) : null;
  }

  async countPublishedQuizzes(workspaceId: string) {
    return [...this.quizzes.values()].filter(
      (quiz) => quiz.workspaceId === workspaceId && quiz.status === "published",
    ).length;
  }

  async getBrandTheme(workspaceId: string) {
    const theme = this.brandThemes.get(workspaceId);
    return theme ? structuredClone(theme) : null;
  }

  async updateBrandTheme(workspaceId: string, theme: BrandTheme | null) {
    if (theme) this.brandThemes.set(workspaceId, structuredClone(theme));
    else this.brandThemes.delete(workspaceId);
    return theme ? structuredClone(theme) : null;
  }

  async getEmbedAllowedOrigins(workspaceId: string) {
    return [...(this.workspaces.get(workspaceId)?.embedAllowedOrigins ?? [])];
  }

  async updateEmbedAllowedOrigins(workspaceId: string, origins: string[]) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return [];
    workspace.embedAllowedOrigins = [...origins];
    return [...workspace.embedAllowedOrigins];
  }

  async getInstitutionPolicy(workspaceId: string): Promise<InstitutionPolicyRecord> {
    const policy = this.institutionPolicies.get(workspaceId);
    return policy
      ? structuredClone(policy)
      : {
          workspaceId,
          contractStatus: "disabled",
          identityRequirement: "guest",
          capabilities: {
            oidc: false,
            managedSso: false,
            scim: false,
            lti: false,
            nrps: false,
            ags: false,
            auditExports: false,
            residencyControls: false,
          },
          k12Enabled: false,
          updatedAt: null,
        };
  }

  async updateInstitutionPolicy(input: InstitutionPolicyRecord, requestId: string) {
    if (!this.workspaces.has(input.workspaceId)) throw new Error("Workspace not found");
    const before = await this.getInstitutionPolicy(input.workspaceId);
    this.institutionPolicies.set(input.workspaceId, structuredClone(input));
    this.audits.push({
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      actorId: null,
      action: "institution.policy.update",
      targetType: "workspace",
      targetId: input.workspaceId,
      requestId,
      metadata: { before, after: structuredClone(input) },
      createdAt: new Date(),
    });
  }

  async createFederatedAuthTransaction(input: FederatedAuthTransactionRecord) {
    this.federatedAuthTransactions.set(input.stateHash, structuredClone(input));
  }

  async consumeFederatedAuthTransaction(stateHash: string, now: Date) {
    const transaction = this.federatedAuthTransactions.get(stateHash);
    if (!transaction || transaction.expiresAt <= now) return null;
    this.federatedAuthTransactions.delete(stateHash);
    return structuredClone(transaction);
  }

  async linkExternalIdentity(input: ExternalIdentityRecord) {
    const subjectConflict = [...this.externalIdentities.values()].find(
      (identity) =>
        identity.workspaceId === input.workspaceId &&
        identity.provider === input.provider &&
        identity.issuer === input.issuer &&
        identity.subject === input.subject,
    );
    if (subjectConflict) {
      return subjectConflict.userId === input.userId ? structuredClone(subjectConflict) : null;
    }
    const userConflict = [...this.externalIdentities.values()].some(
      (identity) =>
        identity.workspaceId === input.workspaceId &&
        identity.provider === input.provider &&
        identity.issuer === input.issuer &&
        identity.userId === input.userId,
    );
    if (userConflict) return null;
    this.externalIdentities.set(input.id, structuredClone(input));
    return structuredClone(input);
  }

  async getExternalIdentity(
    workspaceId: string,
    provider: ExternalIdentityRecord["provider"],
    issuer: string,
    subject: string,
  ) {
    const identity = [...this.externalIdentities.values()].find(
      (candidate) =>
        candidate.workspaceId === workspaceId &&
        candidate.provider === provider &&
        candidate.issuer === issuer &&
        candidate.subject === subject,
    );
    return identity ? structuredClone(identity) : null;
  }

  async listExternalIdentities(workspaceId: string, userId: string) {
    return [...this.externalIdentities.values()]
      .filter((identity) => identity.workspaceId === workspaceId && identity.userId === userId)
      .sort((left, right) => left.linkedAt.getTime() - right.linkedAt.getTime())
      .map((identity) => structuredClone(identity));
  }

  async touchExternalIdentity(identityId: string, usedAt: Date) {
    const identity = this.externalIdentities.get(identityId);
    if (identity) identity.lastUsedAt = new Date(usedAt);
  }

  async unlinkExternalIdentity(workspaceId: string, userId: string, identityId: string) {
    const identity = this.externalIdentities.get(identityId);
    if (!identity || identity.workspaceId !== workspaceId || identity.userId !== userId)
      return false;
    return this.externalIdentities.delete(identityId);
  }

  async upsertLtiRegistration(input: LtiRegistrationRecord) {
    if (!this.workspaces.has(input.workspaceId)) throw new Error("Workspace not found");
    const duplicate = [...this.ltiRegistrations.values()].find(
      (registration) =>
        registration.id !== input.id &&
        registration.workspaceId === input.workspaceId &&
        registration.issuer === input.issuer &&
        registration.clientId === input.clientId &&
        registration.deploymentId === input.deploymentId,
    );
    if (duplicate) throw new Error("LTI registration already exists");
    this.ltiRegistrations.set(input.id, structuredClone(input));
    return structuredClone(input);
  }

  async listLtiRegistrations(workspaceId: string) {
    return [...this.ltiRegistrations.values()]
      .filter((registration) => registration.workspaceId === workspaceId)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((registration) => structuredClone(registration));
  }

  async getLtiRegistration(registrationId: string) {
    const registration = this.ltiRegistrations.get(registrationId);
    return registration ? structuredClone(registration) : null;
  }

  async findLtiRegistration(issuer: string, clientId?: string, deploymentId?: string) {
    const matches = [...this.ltiRegistrations.values()].filter(
      (registration) =>
        registration.status === "active" &&
        registration.issuer === issuer &&
        (!clientId || registration.clientId === clientId) &&
        (!deploymentId || registration.deploymentId === deploymentId),
    );
    return matches.length === 1 ? structuredClone(matches[0]!) : null;
  }

  async createLtiLoginTransaction(input: LtiLoginTransactionRecord) {
    this.ltiLoginTransactions.set(input.stateHash, structuredClone(input));
  }

  async consumeLtiLoginTransaction(stateHash: string, now: Date) {
    const transaction = this.ltiLoginTransactions.get(stateHash);
    if (!transaction || transaction.expiresAt <= now) return null;
    this.ltiLoginTransactions.delete(stateHash);
    return structuredClone(transaction);
  }

  async createLtiLaunch(input: LtiLaunchRecord) {
    this.ltiLaunches.set(input.id, structuredClone(input));
    return structuredClone(input);
  }

  async getLtiLaunch(workspaceId: string, launchId: string, now: Date) {
    const launch = this.ltiLaunches.get(launchId);
    return launch && launch.workspaceId === workspaceId && launch.expiresAt > now
      ? structuredClone(launch)
      : null;
  }

  async bindLtiLaunch(linkTokenHash: string, userId: string, identityId: string, now: Date) {
    const launch = [...this.ltiLaunches.values()].find(
      (candidate) => candidate.linkTokenHash === linkTokenHash && candidate.expiresAt > now,
    );
    const registration = launch ? this.ltiRegistrations.get(launch.registrationId) : null;
    if (
      !launch ||
      !registration ||
      !launch.subject ||
      !this.workspaceMembers.has(`${launch.workspaceId}:${userId}`)
    ) {
      return null;
    }
    const existingSubject = [...this.externalIdentities.values()].find(
      (identity) =>
        identity.workspaceId === launch.workspaceId &&
        identity.provider === "lti" &&
        identity.issuer === registration.issuer &&
        identity.subject === launch.subject,
    );
    if (existingSubject && existingSubject.userId !== userId) return null;
    const existingUser = [...this.externalIdentities.values()].find(
      (identity) =>
        identity.workspaceId === launch.workspaceId &&
        identity.provider === "lti" &&
        identity.issuer === registration.issuer &&
        identity.userId === userId,
    );
    if (existingUser && existingUser.subject !== launch.subject) return null;
    if (!existingSubject) {
      this.externalIdentities.set(identityId, {
        id: identityId,
        workspaceId: launch.workspaceId,
        userId,
        provider: "lti",
        issuer: registration.issuer,
        subject: launch.subject,
        emailHint: null,
        linkedAt: new Date(now),
        lastUsedAt: new Date(now),
      });
    }
    launch.creatorUserId = userId;
    launch.linkTokenHash = null;
    return structuredClone(launch);
  }

  async completeLtiDeepLink(
    workspaceId: string,
    launchId: string,
    userId: string,
    quizId: string,
    responseJwt: string,
    completedAt: Date,
  ) {
    const launch = this.ltiLaunches.get(launchId);
    if (
      !launch ||
      launch.workspaceId !== workspaceId ||
      launch.creatorUserId !== userId ||
      launch.messageType !== "LtiDeepLinkingRequest" ||
      launch.expiresAt <= completedAt
    ) {
      return null;
    }
    if (!launch.responseJwt) {
      launch.quizId = quizId;
      launch.responseJwt = responseJwt;
      launch.completedAt = new Date(completedAt);
    }
    return structuredClone(launch);
  }

  async getEmbedPolicyByKey(policyKeyHash: string, sessionId: string, now: Date) {
    const credential = [...this.sessionStaff.values()].find(
      (candidate) =>
        candidate.embedPolicyKeyHash === policyKeyHash &&
        candidate.sessionId === sessionId &&
        candidate.role === "presenter" &&
        !candidate.revokedAt &&
        candidate.expiresAt > now,
    );
    return credential
      ? {
          allowedOrigins: [...(credential.embedAllowedOrigins ?? [])],
          expiresAt: new Date(credential.expiresAt),
        }
      : null;
  }

  async createSession(input: StoredSession) {
    const now = Date.now();
    const conflict = [...this.sessions.values()].some(
      (session) =>
        session.state.code === input.state.code &&
        session.state.phase !== "finished" &&
        session.expiresAt.getTime() > now,
    );
    if (conflict) throw new SessionCodeConflictError(input.state.code);
    this.sessions.set(input.id, structuredClone(input));
    this.interactionSettings.set(input.id, {
      workspaceId: input.workspaceId,
      sessionId: input.id,
      signalsEnabled: true,
      chatEnabled: false,
      chatIdentityMode: "alias_public",
      slowModeSeconds: 5,
      presenterFeedMode: "pinned",
      audienceSeq: 0,
      closedAt: null,
      updatedAt: new Date(input.createdAt),
    });
  }

  async getSessionById(sessionId: string) {
    const value = this.sessions.get(sessionId);
    return value ? structuredClone(value) : null;
  }

  async getSessionByCode(code: string) {
    const now = Date.now();
    const value = [...this.sessions.values()].find(
      (session) =>
        session.state.code === code &&
        session.state.phase !== "finished" &&
        session.expiresAt.getTime() > now,
    );
    return value ? structuredClone(value) : null;
  }

  async listSessionIds(workspaceId: string) {
    return [...this.sessions.values()]
      .filter((session) => session.workspaceId === workspaceId)
      .map((session) => session.id)
      .sort();
  }

  async listSessionHistory(
    workspaceId: string,
    options: {
      cursor?: HistoryCursor;
      limit: number;
      status?: SessionHistoryRecord["status"];
      quizId?: string;
      from?: Date;
      to?: Date;
      now: Date;
    },
  ) {
    const records = [...this.sessions.values()]
      .filter((session) => session.workspaceId === workspaceId)
      .flatMap((session): SessionHistoryRecord[] => {
        const version = this.versions.get(session.quizVersionId);
        if (!version) return [];
        const quiz = this.quizzes.get(version.quizId);
        if (!quiz) return [];
        const status: SessionHistoryRecord["status"] =
          session.state.phase === "finished"
            ? "finished"
            : session.expiresAt <= options.now
              ? "expired"
              : "active";
        const questionIndex =
          session.state.questionIndex === null
            ? null
            : session.state.roundKind === "main"
              ? session.state.questionIndex
              : session.state.sourceRoundId
                ? (session.state.rounds[session.state.sourceRoundId]?.position ??
                  session.state.questionIndex)
                : session.state.questionIndex;
        return [
          {
            id: session.id,
            quizId: version.quizId,
            title: session.state.quiz.title,
            status,
            phase: session.state.phase,
            code: session.state.code,
            participantCount: Object.values(session.state.participants).filter(
              (participant) => !participant.kicked,
            ).length,
            answerCount: [...this.answers.keys()].filter((key) => key.startsWith(`${session.id}:`))
              .length,
            questionCount: session.state.quiz.questions.filter(
              (question) => questionDelivery(question) === "main",
            ).length,
            questionPosition:
              questionIndex === null
                ? null
                : session.state.quiz.questions
                    .slice(0, questionIndex + 1)
                    .filter((question) => questionDelivery(question) === "main").length,
            createdAt: new Date(session.createdAt),
            updatedAt: new Date(session.updatedAt),
            expiresAt: new Date(session.expiresAt),
            reportId:
              [...this.reports.values()].find((report) => report.sessionId === session.id)?.id ??
              null,
          },
        ];
      })
      .filter((item) => !options.status || item.status === options.status)
      .filter((item) => !options.quizId || item.quizId === options.quizId)
      .filter((item) => !options.from || item.createdAt >= options.from)
      .filter((item) => !options.to || item.createdAt <= options.to)
      .filter(
        (item) =>
          !options.cursor ||
          item.createdAt < options.cursor.createdAt ||
          (item.createdAt.getTime() === options.cursor.createdAt.getTime() &&
            item.id < options.cursor.id),
      )
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id),
      );
    return {
      items: structuredClone(records.slice(0, options.limit)),
      hasMore: records.length > options.limit,
    };
  }

  async saveSession(input: StoredSession, expectedVersion: number, report?: Report) {
    const current = this.sessions.get(input.id);
    if (!current || current.state.version !== expectedVersion) {
      throw new SessionVersionConflictError(input.id, expectedVersion);
    }
    if (report && report.sessionId !== input.id) throw new Error("Report session does not match");
    const storedSession = structuredClone({ ...input, updatedAt: new Date() });
    const storedReport = report ? structuredClone(report) : undefined;
    this.sessions.set(input.id, storedSession);
    if (storedSession.state.phase === "finished") {
      const settings = this.interactionSettings.get(input.id);
      if (settings) {
        settings.closedAt ??= new Date();
        settings.signalsEnabled = false;
        settings.chatEnabled = false;
        settings.updatedAt = new Date();
      }
    }
    if (storedReport) {
      const prior = [...this.reports.entries()].find(
        ([, candidate]) => candidate.sessionId === storedReport.sessionId,
      );
      const createdAt = prior ? (this.reportCreatedAt.get(prior[0]) ?? new Date()) : new Date();
      if (prior) {
        this.reports.delete(prior[0]);
        this.reportJobs.delete(prior[0]);
        this.reportCreatedAt.delete(prior[0]);
      }
      this.reports.set(storedReport.id, storedReport);
      this.reportCreatedAt.set(storedReport.id, createdAt);
      if (storedReport.status === "pending") {
        this.reportJobs.set(storedReport.id, {
          workspaceId: input.workspaceId,
          attempts: 0,
          availableAt: new Date(0),
          lastError: null,
        });
      }
    }
  }

  async deleteSession(workspaceId: string, sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session || session.workspaceId !== workspaceId) return false;
    this.deleteSessionTree(sessionId);
    return true;
  }

  private deleteSessionTree(sessionId: string) {
    for (const [followupId, followup] of this.followups) {
      if (followup.sourceSessionId === sessionId) this.deleteFollowupTree(followupId);
    }
    this.sessions.delete(sessionId);
    this.expiredLiveSessions.delete(sessionId);
    for (const [key, participant] of this.participants) {
      if (participant.sessionId === sessionId) this.participants.delete(key);
    }
    for (const [key, credential] of this.sessionStaff) {
      if (credential.sessionId === sessionId) this.sessionStaff.delete(key);
    }
    this.qnaSettings.delete(sessionId);
    for (const [id, question] of this.qnaQuestions) {
      if (question.sessionId === sessionId) this.qnaQuestions.delete(id);
    }
    for (const [id, reply] of this.qnaReplies) {
      if (reply.sessionId === sessionId) this.qnaReplies.delete(id);
    }
    for (const vote of this.qnaVotes) {
      if (vote.startsWith(`${sessionId}:`)) this.qnaVotes.delete(vote);
    }
    for (const ban of this.qnaBans) {
      if (ban.startsWith(`${sessionId}:`)) this.qnaBans.delete(ban);
    }
    this.interactionSettings.delete(sessionId);
    for (const [key, signal] of this.participantSignals) {
      if (signal.sessionId === sessionId) this.participantSignals.delete(key);
    }
    for (let index = this.signalEvents.length - 1; index >= 0; index -= 1) {
      if (this.signalEvents[index]?.sessionId === sessionId) this.signalEvents.splice(index, 1);
    }
    const chatMessageIds = new Set<string>();
    for (const [id, message] of this.chatMessages) {
      if (message.sessionId === sessionId) {
        chatMessageIds.add(id);
        this.chatMessages.delete(id);
      }
    }
    for (const [key, reaction] of this.chatReactions) {
      if (reaction.sessionId === sessionId) this.chatReactions.delete(key);
    }
    for (const report of this.chatReports) {
      if (chatMessageIds.has(report.split(":", 1)[0]!)) this.chatReports.delete(report);
    }
    for (const [key, restriction] of this.audienceRestrictions) {
      if (restriction.sessionId === sessionId) this.audienceRestrictions.delete(key);
    }
    for (const [id, event] of this.audienceOutbox) {
      if (event.sessionId === sessionId) this.audienceOutbox.delete(id);
    }
    for (const key of this.answers.keys()) {
      if (key.startsWith(`${sessionId}:`)) this.answers.delete(key);
    }
    for (const [id, report] of this.reports) {
      if (report.sessionId === sessionId) {
        this.reports.delete(id);
        this.reportJobs.delete(id);
        this.reportCreatedAt.delete(id);
      }
    }
  }

  private deleteFollowupTree(followupId: string) {
    this.followups.delete(followupId);
    const accessIds = new Set<string>();
    for (const [tokenHash, access] of this.followupAccess) {
      if (access.followupId === followupId) {
        accessIds.add(access.id);
        this.followupAccess.delete(tokenHash);
      }
    }
    const attemptIds = new Set<string>();
    for (const [tokenHash, attempt] of this.followupAttempts) {
      if (
        attempt.followupId === followupId ||
        (attempt.accessTokenId && accessIds.has(attempt.accessTokenId))
      ) {
        attemptIds.add(attempt.id);
        this.followupAttempts.delete(tokenHash);
      }
    }
    for (const [key, answer] of this.followupAnswers) {
      if (answer.followupId === followupId || attemptIds.has(answer.attemptId)) {
        this.followupAnswers.delete(key);
      }
    }
  }

  async createParticipant(input: ParticipantRecord) {
    this.participants.set(input.tokenHash, structuredClone(input));
  }

  async commitParticipants(
    session: StoredSession,
    participants: ParticipantRecord[],
    expectedVersion: number,
  ) {
    const current = this.sessions.get(session.id);
    if (!current || current.state.version !== expectedVersion) {
      throw new SessionVersionConflictError(session.id, expectedVersion);
    }
    const existingIds = new Set([...this.participants.values()].map(({ id }) => id));
    for (const participant of participants) {
      if (this.participants.has(participant.tokenHash) || existingIds.has(participant.id)) {
        throw new Error("Participant state changed during persistence");
      }
      existingIds.add(participant.id);
    }
    for (const participant of participants) {
      this.participants.set(participant.tokenHash, structuredClone(participant));
    }
    await this.saveSession(session, expectedVersion);
  }

  async getParticipantByToken(tokenHash: string) {
    const value = this.participants.get(tokenHash);
    return value ? structuredClone(value) : null;
  }

  async getParticipants(sessionId: string) {
    return [...this.participants.values()]
      .filter((participant) => participant.sessionId === sessionId)
      .map((participant) => structuredClone(participant));
  }

  async createSessionStaffCredential(input: SessionStaffCredentialInput) {
    const normalized = {
      ...input,
      purpose: input.purpose ?? "collaboration",
      embedPolicyKeyHash: input.embedPolicyKeyHash ?? null,
      embedAllowedOrigins: input.embedAllowedOrigins ?? [],
    };
    this.sessionStaff.set(input.tokenHash, structuredClone(normalized));
    return structuredClone(normalized);
  }

  async replaceCreatorResumeCredential(input: SessionStaffCredentialRecord) {
    if (input.purpose !== "creator_resume" || input.role !== "cohost") {
      throw new Error("A creator resume credential must be a cohost credential");
    }
    const session = this.sessions.get(input.sessionId);
    const checkedAt = new Date();
    if (
      !session ||
      session.workspaceId !== input.workspaceId ||
      session.state.phase === "finished" ||
      session.expiresAt <= checkedAt
    ) {
      throw new SessionNotActiveError(input.sessionId);
    }
    const revokedCredentialIds: string[] = [];
    for (const credential of this.sessionStaff.values()) {
      if (
        credential.workspaceId === input.workspaceId &&
        credential.sessionId === input.sessionId &&
        credential.createdBy === input.createdBy &&
        credential.purpose === "creator_resume" &&
        !credential.revokedAt
      ) {
        credential.revokedAt = new Date(input.createdAt);
        revokedCredentialIds.push(credential.id);
      }
    }
    return {
      credential: await this.createSessionStaffCredential(input),
      revokedCredentialIds,
    };
  }

  async getSessionStaffByToken(tokenHash: string, now: Date) {
    const credential = this.sessionStaff.get(tokenHash);
    return credential && !credential.revokedAt && credential.expiresAt > now
      ? structuredClone(credential)
      : null;
  }

  async listSessionStaff(workspaceId: string, sessionId: string) {
    return [...this.sessionStaff.values()]
      .filter(
        (credential) =>
          credential.workspaceId === workspaceId && credential.sessionId === sessionId,
      )
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((credential) => structuredClone(credential));
  }

  async revokeSessionStaff(workspaceId: string, sessionId: string, credentialId: string) {
    const credential = [...this.sessionStaff.values()].find(
      (candidate) =>
        candidate.workspaceId === workspaceId &&
        candidate.sessionId === sessionId &&
        candidate.id === credentialId,
    );
    if (!credential || credential.revokedAt) return false;
    credential.revokedAt = new Date();
    return true;
  }

  async getWorkspaceSegment(workspaceId: string) {
    return (
      [...this.users.values()].find((user) => user.workspaceId === workspaceId)?.segment ??
      "workplace"
    );
  }

  async getQnaSettings(workspaceId: string, sessionId: string) {
    const settings = this.qnaSettings.get(sessionId);
    return settings?.workspaceId === workspaceId ? structuredClone(settings) : null;
  }

  async saveQnaSettings(input: QnaSettingsRecord) {
    this.qnaSettings.set(input.sessionId, structuredClone(input));
    return structuredClone(input);
  }

  async createQnaQuestion(input: QnaQuestionRecord) {
    this.qnaQuestions.set(input.id, structuredClone(input));
    return structuredClone(input);
  }

  async getQnaQuestion(workspaceId: string, questionId: string) {
    const question = this.qnaQuestions.get(questionId);
    if (!question || question.workspaceId !== workspaceId) return null;
    const voteCount = [...this.qnaVotes].filter((vote) => vote.includes(`:${questionId}:`)).length;
    return structuredClone({ ...question, voteCount });
  }

  async listQnaQuestions(workspaceId: string, sessionId: string, viewerParticipantId?: string) {
    return [...this.qnaQuestions.values()]
      .filter(
        (question) => question.workspaceId === workspaceId && question.sessionId === sessionId,
      )
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id),
      )
      .map((question) => {
        const prefix = `${sessionId}:${question.id}:`;
        const voteCount = [...this.qnaVotes].filter((vote) => vote.startsWith(prefix)).length;
        return structuredClone({
          ...question,
          voteCount,
          votedByViewer: viewerParticipantId
            ? this.qnaVotes.has(`${prefix}${viewerParticipantId}`)
            : false,
        });
      });
  }

  async updateQnaQuestion(
    workspaceId: string,
    questionId: string,
    update: Pick<QnaQuestionRecord, "status" | "label">,
  ) {
    const question = this.qnaQuestions.get(questionId);
    if (!question || question.workspaceId !== workspaceId) return null;
    Object.assign(question, update, { updatedAt: new Date() });
    return structuredClone(question);
  }

  async createQnaReply(input: QnaReplyRecord) {
    this.qnaReplies.set(input.id, structuredClone(input));
    return structuredClone(input);
  }

  async getQnaReply(workspaceId: string, replyId: string) {
    const reply = this.qnaReplies.get(replyId);
    return reply?.workspaceId === workspaceId ? structuredClone(reply) : null;
  }

  async listQnaReplies(workspaceId: string, questionId: string) {
    return [...this.qnaReplies.values()]
      .filter((reply) => reply.workspaceId === workspaceId && reply.questionId === questionId)
      .sort(
        (left, right) =>
          left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
      )
      .map((reply) => structuredClone(reply));
  }

  async updateQnaReply(workspaceId: string, replyId: string, status: QnaReplyRecord["status"]) {
    const reply = this.qnaReplies.get(replyId);
    if (!reply || reply.workspaceId !== workspaceId) return null;
    reply.status = status;
    reply.updatedAt = new Date();
    return structuredClone(reply);
  }

  async setQnaVote(
    workspaceId: string,
    sessionId: string,
    questionId: string,
    participantId: string,
    voted: boolean,
  ) {
    const question = this.qnaQuestions.get(questionId);
    if (!question || question.workspaceId !== workspaceId || question.sessionId !== sessionId) {
      throw new Error("Q&A question not found");
    }
    const key = `${sessionId}:${questionId}:${participantId}`;
    if (voted) this.qnaVotes.add(key);
    else this.qnaVotes.delete(key);
    return [...this.qnaVotes].filter((vote) => vote.startsWith(`${sessionId}:${questionId}:`))
      .length;
  }

  async isQnaBanned(workspaceId: string, sessionId: string, participantId: string) {
    const session = this.sessions.get(sessionId);
    return (
      session?.workspaceId === workspaceId && this.qnaBans.has(`${sessionId}:${participantId}`)
    );
  }

  async banQnaParticipant(
    workspaceId: string,
    sessionId: string,
    participantId: string,
    _actorId: string | null,
  ) {
    const session = this.sessions.get(sessionId);
    if (session?.workspaceId !== workspaceId) throw new Error("Session not found");
    this.qnaBans.add(`${sessionId}:${participantId}`);
  }

  private findAudienceEvent(sessionId: string, idempotencyKey: string) {
    return [...this.audienceOutbox.values()].find(
      (event) => event.sessionId === sessionId && event.idempotencyKey === idempotencyKey,
    );
  }

  private requireOpenInteractionSettings(workspaceId: string, sessionId: string) {
    const settings = this.interactionSettings.get(sessionId);
    if (!settings || settings.workspaceId !== workspaceId) {
      throw new AudienceStoreError("NOT_FOUND", "Audience interaction settings were not found");
    }
    if (settings.closedAt) {
      throw new AudienceStoreError(
        "CONFLICT",
        "Audience interactions are closed because this live round has finished",
      );
    }
    return settings;
  }

  private allocateAudienceEvent(
    workspaceId: string,
    sessionId: string,
    input: AudienceEventInput,
    createdAt: Date,
  ) {
    const settings = this.requireOpenInteractionSettings(workspaceId, sessionId);
    settings.audienceSeq += 1;
    settings.updatedAt = createdAt;
    const event: AudienceOutboxRecord = {
      eventId: input.eventId,
      workspaceId,
      sessionId,
      audienceSeq: settings.audienceSeq,
      type: input.type,
      idempotencyKey: input.idempotencyKey,
      payload: structuredClone(input.payload),
      attempts: 0,
      claimedAt: null,
      deliveredAt: null,
      createdAt,
    };
    this.audienceOutbox.set(event.eventId, structuredClone(event));
    return event;
  }

  async getInteractionSettings(workspaceId: string, sessionId: string) {
    const settings = this.interactionSettings.get(sessionId);
    return settings?.workspaceId === workspaceId ? structuredClone(settings) : null;
  }

  async appendAudienceEvent(
    workspaceId: string,
    sessionId: string,
    eventInput: AudienceEventInput,
    createdAt: Date,
  ): Promise<AudienceMutation<null>> {
    const existing = this.findAudienceEvent(sessionId, eventInput.idempotencyKey);
    if (existing) {
      return { record: null, event: structuredClone(existing), duplicate: true };
    }
    const event = this.allocateAudienceEvent(workspaceId, sessionId, eventInput, createdAt);
    return { record: null, event: structuredClone(event), duplicate: false };
  }

  async saveInteractionSettings(
    input: Omit<InteractionSettingsRecord, "audienceSeq" | "closedAt">,
    eventInput: AudienceEventInput,
  ): Promise<AudienceMutation<InteractionSettingsRecord>> {
    const existingEvent = this.findAudienceEvent(input.sessionId, eventInput.idempotencyKey);
    const existing = this.interactionSettings.get(input.sessionId);
    const session = this.sessions.get(input.sessionId);
    if (!session || session.workspaceId !== input.workspaceId) {
      throw new AudienceStoreError("NOT_FOUND", "Live round not found");
    }
    if (session.state.phase === "finished" || existing?.closedAt) {
      throw new AudienceStoreError(
        "CONFLICT",
        "Audience interactions are closed because this live round has finished",
      );
    }
    if (existingEvent && existing) {
      return {
        record: structuredClone(existing),
        event: structuredClone(existingEvent),
        duplicate: true,
      };
    }
    const base: InteractionSettingsRecord = {
      ...structuredClone(input),
      audienceSeq: existing?.audienceSeq ?? 0,
      closedAt: null,
    };
    this.interactionSettings.set(input.sessionId, base);
    const event = this.allocateAudienceEvent(
      input.workspaceId,
      input.sessionId,
      eventInput,
      input.updatedAt,
    );
    const saved = this.interactionSettings.get(input.sessionId)!;
    return { record: structuredClone(saved), event: structuredClone(event), duplicate: false };
  }

  async listParticipantSignals(workspaceId: string, sessionId: string, contextKey: string) {
    return [...this.participantSignals.values()]
      .filter(
        (signal) =>
          signal.workspaceId === workspaceId &&
          signal.sessionId === sessionId &&
          signal.contextKey === contextKey,
      )
      .map((signal) => structuredClone(signal));
  }

  async countRecentSignalEvents(workspaceId: string, sessionId: string, since: Date) {
    return this.signalEvents.filter(
      (event) =>
        event.workspaceId === workspaceId &&
        event.sessionId === sessionId &&
        event.createdAt >= since,
    ).length;
  }

  async setParticipantSignal(
    input: {
      workspaceId: string;
      sessionId: string;
      contextKey: string;
      participantId: string;
      signal: ParticipantSignalRecord["signal"] | null;
      now: Date;
    },
    eventInput: AudienceEventInput,
  ): Promise<AudienceMutation<ParticipantSignalRecord | null>> {
    this.requireOpenInteractionSettings(input.workspaceId, input.sessionId);
    const key = `${input.sessionId}:${input.contextKey}:${input.participantId}`;
    const existingEvent = this.findAudienceEvent(input.sessionId, eventInput.idempotencyKey);
    if (existingEvent) {
      return {
        record: structuredClone(this.participantSignals.get(key) ?? null),
        event: structuredClone(existingEvent),
        duplicate: true,
      };
    }
    const recentSignals = this.signalEvents.filter(
      (candidate) =>
        candidate.sessionId === input.sessionId &&
        candidate.participantId === input.participantId &&
        input.now.getTime() - candidate.createdAt.getTime() < 60_000,
    );
    if (recentSignals.length >= 30) {
      throw new AudienceStoreError(
        "SIGNAL_RATE_LIMITED",
        "Too many pulse changes; wait before trying again",
      );
    }
    const record = input.signal
      ? {
          workspaceId: input.workspaceId,
          sessionId: input.sessionId,
          contextKey: input.contextKey,
          participantId: input.participantId,
          signal: input.signal,
          updatedAt: input.now,
        }
      : null;
    if (record) this.participantSignals.set(key, structuredClone(record));
    else this.participantSignals.delete(key);
    this.signalEvents.push({
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      participantId: input.participantId,
      contextKey: input.contextKey,
      signal: input.signal,
      idempotencyKey: eventInput.idempotencyKey,
      createdAt: input.now,
    });
    const event = this.allocateAudienceEvent(
      input.workspaceId,
      input.sessionId,
      eventInput,
      input.now,
    );
    return {
      record: structuredClone(record),
      event: structuredClone(event),
      duplicate: false,
    };
  }

  async getChatMessage(workspaceId: string, messageId: string) {
    const message = this.chatMessages.get(messageId);
    return message?.workspaceId === workspaceId ? structuredClone(message) : null;
  }

  async listChatMessages(
    workspaceId: string,
    sessionId: string,
    options: ChatMessageListOptions = {},
  ) {
    const messages = [...this.chatMessages.values()]
      .filter((message) => message.workspaceId === workspaceId && message.sessionId === sessionId)
      .filter((message) => !options.pinnedOnly || message.pinned)
      .filter(
        (message) =>
          !options.cursor ||
          message.createdAt < options.cursor.createdAt ||
          (message.createdAt.getTime() === options.cursor.createdAt.getTime() &&
            message.id.localeCompare(options.cursor.id) < 0),
      )
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id),
      );
    return messages
      .slice(0, options.limit ?? messages.length)
      .map((message) => structuredClone(message));
  }

  async createChatMessage(
    input: Omit<ChatMessageRecord, "audienceSeq">,
    eventInput: AudienceEventInput,
  ): Promise<AudienceMutation<ChatMessageRecord>> {
    this.requireOpenInteractionSettings(input.workspaceId, input.sessionId);
    const existingEvent = this.findAudienceEvent(input.sessionId, eventInput.idempotencyKey);
    const existingMessage = [...this.chatMessages.values()].find(
      (message) =>
        message.sessionId === input.sessionId &&
        message.idempotencyKey === eventInput.idempotencyKey,
    );
    if (existingEvent && existingMessage) {
      return {
        record: structuredClone(existingMessage),
        event: structuredClone(existingEvent),
        duplicate: true,
      };
    }
    const settings = this.interactionSettings.get(input.sessionId);
    if (!settings?.chatEnabled) {
      throw new AudienceStoreError("CHAT_DISABLED", "Chat is disabled for this live round");
    }
    if (input.replyToId) {
      const parent = this.chatMessages.get(input.replyToId);
      if (!parent || parent.sessionId !== input.sessionId || parent.status === "removed") {
        throw new AudienceStoreError(
          "NOT_FOUND",
          "The chat message being replied to was not found",
        );
      }
      if (parent.replyToId) {
        throw new AudienceStoreError("CONFLICT", "Chat supports one level of replies");
      }
    }
    const sessionMessages = [...this.chatMessages.values()].filter(
      (message) => message.sessionId === input.sessionId,
    );
    if (sessionMessages.length >= 10_000) {
      throw new AudienceStoreError(
        "CHAT_CAPACITY_REACHED",
        "This round has reached its chat message limit",
      );
    }
    if (input.participantId) {
      const restriction = this.audienceRestrictions.get(
        `${input.sessionId}:${input.participantId}`,
      );
      if (restriction?.bannedAt) {
        throw new AudienceStoreError("AUDIENCE_BANNED", "Audience interaction access was revoked");
      }
      if (restriction?.mutedUntil && restriction.mutedUntil > input.createdAt) {
        throw new AudienceStoreError(
          "CHAT_MUTED",
          "Chat is temporarily muted for this participant",
        );
      }
      const mine = sessionMessages.filter(
        (message) => message.participantId === input.participantId,
      );
      if (mine.length >= 200) {
        throw new AudienceStoreError(
          "CHAT_CAPACITY_REACHED",
          "This participant has reached the session chat limit",
        );
      }
      const minuteCount = mine.filter(
        (message) => input.createdAt.getTime() - message.createdAt.getTime() < 60_000,
      ).length;
      if (minuteCount >= 12) {
        throw new AudienceStoreError(
          "CHAT_RATE_LIMITED",
          "Too many messages; wait before posting again",
        );
      }
      const latest = mine.sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
      )[0];
      if (
        latest &&
        input.createdAt.getTime() - latest.createdAt.getTime() < settings.slowModeSeconds * 1_000
      ) {
        throw new AudienceStoreError(
          "CHAT_RATE_LIMITED",
          `Slow mode allows one message every ${settings.slowModeSeconds} seconds`,
        );
      }
    }
    const event = this.allocateAudienceEvent(
      input.workspaceId,
      input.sessionId,
      eventInput,
      input.createdAt,
    );
    const message = { ...structuredClone(input), audienceSeq: event.audienceSeq };
    this.chatMessages.set(message.id, message);
    return { record: structuredClone(message), event: structuredClone(event), duplicate: false };
  }

  async updateChatMessage(
    workspaceId: string,
    sessionId: string,
    messageId: string,
    update: { status?: ChatMessageRecord["status"]; pinned?: boolean },
    eventInput: AudienceEventInput,
    updatedAt: Date,
  ): Promise<AudienceMutation<ChatMessageRecord>> {
    this.requireOpenInteractionSettings(workspaceId, sessionId);
    const existingEvent = this.findAudienceEvent(sessionId, eventInput.idempotencyKey);
    const message = this.chatMessages.get(messageId);
    if (!message || message.workspaceId !== workspaceId || message.sessionId !== sessionId) {
      throw new AudienceStoreError("NOT_FOUND", "Chat message not found");
    }
    if (existingEvent) {
      return {
        record: structuredClone(message),
        event: structuredClone(existingEvent),
        duplicate: true,
      };
    }
    if (update.status) message.status = update.status;
    if (update.pinned !== undefined) message.pinned = update.pinned;
    message.updatedAt = updatedAt;
    const event = this.allocateAudienceEvent(workspaceId, sessionId, eventInput, updatedAt);
    message.audienceSeq = event.audienceSeq;
    return { record: structuredClone(message), event: structuredClone(event), duplicate: false };
  }

  async listChatReactions(workspaceId: string, sessionId: string, messageIds?: string[]) {
    const selected = messageIds ? new Set(messageIds) : null;
    return [...this.chatReactions.values()]
      .filter(
        (reaction) => reaction.workspaceId === workspaceId && reaction.sessionId === sessionId,
      )
      .filter((reaction) => !selected || selected.has(reaction.messageId))
      .map((reaction) => structuredClone(reaction));
  }

  async getChatActivitySummary(workspaceId: string, sessionId: string, since: Date) {
    const messages = [...this.chatMessages.values()].filter(
      (message) => message.workspaceId === workspaceId && message.sessionId === sessionId,
    );
    const contributorKeys = messages
      .filter((message) => message.status === "published")
      .map(
        (message) =>
          message.participantId ??
          (message.actorId ? `actor:${message.actorId}` : `staff:${message.staffCredentialId}`),
      );
    return {
      messagesLastMinute: messages.filter(
        (message) => message.status === "published" && message.createdAt >= since,
      ).length,
      uniqueContributors: new Set(contributorKeys).size,
      removedMessages: messages.filter((message) => message.status === "removed").length,
      reportCount: await this.countChatReports(workspaceId, sessionId),
    };
  }

  async listParticipantChatActivity(workspaceId: string, sessionId: string) {
    const activity = new Map<
      string,
      { participantId: string; messageCount: number; latestMessageAt: Date | null }
    >();
    for (const message of this.chatMessages.values()) {
      if (
        message.workspaceId !== workspaceId ||
        message.sessionId !== sessionId ||
        !message.participantId
      )
        continue;
      const current = activity.get(message.participantId) ?? {
        participantId: message.participantId,
        messageCount: 0,
        latestMessageAt: null,
      };
      current.messageCount += 1;
      if (!current.latestMessageAt || message.createdAt > current.latestMessageAt) {
        current.latestMessageAt = new Date(message.createdAt);
      }
      activity.set(message.participantId, current);
    }
    return [...activity.values()].map((record) => structuredClone(record));
  }

  private chatReactionSummary(messageId: string, participantId: string) {
    const records = [...this.chatReactions.values()].filter(
      (reaction) => reaction.messageId === messageId,
    );
    const counts: ChatReactionSummaryRecord["counts"] = {};
    for (const record of records) counts[record.reaction] = (counts[record.reaction] ?? 0) + 1;
    return {
      messageId,
      counts,
      viewerReaction:
        records.find((record) => record.participantId === participantId)?.reaction ?? null,
    };
  }

  async setChatReaction(
    input: {
      workspaceId: string;
      sessionId: string;
      messageId: string;
      participantId: string;
      reaction: ChatReactionRecord["reaction"] | null;
      now: Date;
    },
    eventInput: AudienceEventInput,
  ): Promise<AudienceMutation<ChatReactionSummaryRecord>> {
    this.requireOpenInteractionSettings(input.workspaceId, input.sessionId);
    const existingEvent = this.findAudienceEvent(input.sessionId, eventInput.idempotencyKey);
    if (existingEvent) {
      return {
        record: this.chatReactionSummary(input.messageId, input.participantId),
        event: structuredClone(existingEvent),
        duplicate: true,
      };
    }
    const message = this.chatMessages.get(input.messageId);
    if (!message || message.sessionId !== input.sessionId) {
      throw new AudienceStoreError("NOT_FOUND", "Chat message not found");
    }
    if (message.status === "removed") {
      throw new AudienceStoreError("MESSAGE_REMOVED", "Removed messages cannot receive reactions");
    }
    const key = `${input.messageId}:${input.participantId}`;
    if (input.reaction) {
      this.chatReactions.set(key, {
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        messageId: input.messageId,
        participantId: input.participantId,
        reaction: input.reaction,
        updatedAt: input.now,
      });
    } else this.chatReactions.delete(key);
    const event = this.allocateAudienceEvent(
      input.workspaceId,
      input.sessionId,
      eventInput,
      input.now,
    );
    return {
      record: this.chatReactionSummary(input.messageId, input.participantId),
      event: structuredClone(event),
      duplicate: false,
    };
  }

  async reportChatMessage(
    workspaceId: string,
    sessionId: string,
    messageId: string,
    participantId: string,
    now: Date,
    eventInput: AudienceEventInput,
  ): Promise<AudienceMutation<number>> {
    this.requireOpenInteractionSettings(workspaceId, sessionId);
    const existingEvent = this.findAudienceEvent(sessionId, eventInput.idempotencyKey);
    const prefix = `${messageId}:`;
    if (existingEvent) {
      return {
        record: [...this.chatReports].filter((key) => key.startsWith(prefix)).length,
        event: structuredClone(existingEvent),
        duplicate: true,
      };
    }
    const message = this.chatMessages.get(messageId);
    if (!message || message.workspaceId !== workspaceId || message.sessionId !== sessionId) {
      throw new AudienceStoreError("NOT_FOUND", "Chat message not found");
    }
    this.chatReports.add(`${messageId}:${participantId}`);
    const event = this.allocateAudienceEvent(workspaceId, sessionId, eventInput, now);
    return {
      record: [...this.chatReports].filter((key) => key.startsWith(prefix)).length,
      event: structuredClone(event),
      duplicate: false,
    };
  }

  async countChatReports(workspaceId: string, sessionId: string) {
    const messageIds = new Set(
      [...this.chatMessages.values()]
        .filter((message) => message.workspaceId === workspaceId && message.sessionId === sessionId)
        .map((message) => message.id),
    );
    return [...this.chatReports].filter((key) => messageIds.has(key.split(":", 1)[0]!)).length;
  }

  async getAudienceRestriction(workspaceId: string, sessionId: string, participantId: string) {
    const restriction = this.audienceRestrictions.get(`${sessionId}:${participantId}`);
    return restriction?.workspaceId === workspaceId ? structuredClone(restriction) : null;
  }

  async listAudienceRestrictions(workspaceId: string, sessionId: string) {
    return [...this.audienceRestrictions.values()]
      .filter(
        (restriction) =>
          restriction.workspaceId === workspaceId && restriction.sessionId === sessionId,
      )
      .map((restriction) => structuredClone(restriction));
  }

  async saveAudienceRestriction(
    input: AudienceRestrictionRecord,
    eventInput: AudienceEventInput,
  ): Promise<AudienceMutation<AudienceRestrictionRecord>> {
    this.requireOpenInteractionSettings(input.workspaceId, input.sessionId);
    const existingEvent = this.findAudienceEvent(input.sessionId, eventInput.idempotencyKey);
    const key = `${input.sessionId}:${input.participantId}`;
    const existing = this.audienceRestrictions.get(key);
    if (existingEvent && existing) {
      return {
        record: structuredClone(existing),
        event: structuredClone(existingEvent),
        duplicate: true,
      };
    }
    this.audienceRestrictions.set(key, structuredClone(input));
    const qnaBanKey = `${input.sessionId}:${input.participantId}`;
    if (input.bannedAt) this.qnaBans.add(qnaBanKey);
    else this.qnaBans.delete(qnaBanKey);
    const event = this.allocateAudienceEvent(
      input.workspaceId,
      input.sessionId,
      eventInput,
      input.updatedAt,
    );
    return { record: structuredClone(input), event: structuredClone(event), duplicate: false };
  }

  async claimAudienceOutbox(now: Date, staleBefore: Date) {
    const event = [...this.audienceOutbox.values()]
      .filter(
        (candidate) =>
          !candidate.deliveredAt &&
          (!candidate.claimedAt || candidate.claimedAt.getTime() < staleBefore.getTime()),
      )
      .sort(
        (left, right) =>
          left.createdAt.getTime() - right.createdAt.getTime() ||
          left.eventId.localeCompare(right.eventId),
      )[0];
    if (!event) return null;
    event.claimedAt = now;
    event.attempts += 1;
    return structuredClone(event);
  }

  async completeAudienceOutbox(eventId: string, deliveredAt: Date) {
    const event = this.audienceOutbox.get(eventId);
    if (!event) return false;
    event.deliveredAt = deliveredAt;
    event.claimedAt = null;
    return true;
  }

  async getAudienceOutboxStatus() {
    const pending = [...this.audienceOutbox.values()]
      .filter((event) => !event.deliveredAt)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    const now = new Date();
    const chatEnabledSessions = [...this.interactionSettings.values()].filter((settings) => {
      const session = this.sessions.get(settings.sessionId);
      return Boolean(
        settings.chatEnabled &&
        session &&
        session.state.phase !== "finished" &&
        session.expiresAt > now,
      );
    }).length;
    return {
      pending: pending.length,
      oldestCreatedAt: pending[0]?.createdAt ?? null,
      chatEnabledSessions,
    };
  }

  async getSessionEvidence(workspaceId: string, sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session || session.workspaceId !== workspaceId) {
      return {
        answers: [],
        rounds: [],
        interventions: [],
        qna: { questions: 0, answered: 0, unresolved: 0 },
        interactions: {
          signalEvents: [],
          chatMessages: [],
          reactions: [],
          reports: 0,
          moderationActions: 0,
        },
      };
    }
    const qnaQuestions = [...this.qnaQuestions.values()].filter(
      (question) => question.workspaceId === workspaceId && question.sessionId === sessionId,
    );
    return {
      answers: [...this.answers.entries()]
        .filter(([key]) => key.startsWith(`${sessionId}:`))
        .map(([, answer]) => structuredClone(answer)),
      rounds: Object.entries(session.state.rounds).map(([id, round]) => ({
        id,
        ...structuredClone(round),
      })),
      interventions: Object.values(session.state.interventions).map((intervention) =>
        structuredClone(intervention),
      ),
      qna: {
        questions: qnaQuestions.filter((question) => question.status !== "removed").length,
        answered: qnaQuestions.filter((question) => question.status === "answered").length,
        unresolved: qnaQuestions.filter((question) =>
          ["pending", "published"].includes(question.status),
        ).length,
      },
      interactions: {
        signalEvents: this.signalEvents
          .filter((event) => event.workspaceId === workspaceId && event.sessionId === sessionId)
          .map((event) => ({
            contextKey: event.contextKey,
            participantId: event.participantId,
            signal: event.signal,
            createdAt: new Date(event.createdAt),
          })),
        chatMessages: [...this.chatMessages.values()]
          .filter(
            (message) => message.workspaceId === workspaceId && message.sessionId === sessionId,
          )
          .map((message) => structuredClone(message)),
        reactions: [...this.chatReactions.values()]
          .filter(
            (reaction) => reaction.workspaceId === workspaceId && reaction.sessionId === sessionId,
          )
          .map((reaction) => structuredClone(reaction)),
        reports: await this.countChatReports(workspaceId, sessionId),
        moderationActions: [...this.audienceOutbox.values()].filter(
          (event) =>
            event.workspaceId === workspaceId &&
            event.sessionId === sessionId &&
            (event.type === "audience.moderation.updated" || event.type === "chat.message.removed"),
        ).length,
      },
    };
  }

  async findAnswers(workspaceId: string, sessionId: string, lookups: AnswerLookup[]) {
    const session = this.sessions.get(sessionId);
    if (!session || session.workspaceId !== workspaceId || lookups.length === 0) return [];
    return [...this.answers.entries()]
      .filter(
        ([key, answer]) =>
          key.startsWith(`${sessionId}:`) &&
          lookups.some(
            (lookup) =>
              lookup.idempotencyKey === answer.idempotencyKey ||
              (lookup.participantId === answer.participantId && lookup.roundId === answer.roundId),
          ),
      )
      .map(([, answer]) => structuredClone(answer));
  }

  async findParticipantIdsWithAnswers(
    workspaceId: string,
    sessionId: string,
    participantIds: string[],
  ) {
    const session = this.sessions.get(sessionId);
    if (!session || session.workspaceId !== workspaceId || participantIds.length === 0) return [];
    const requested = new Set(participantIds);
    return [
      ...new Set(
        [...this.answers.entries()]
          .filter(
            ([key, answer]) =>
              key.startsWith(`${sessionId}:`) && requested.has(answer.participantId),
          )
          .map(([, answer]) => answer.participantId),
      ),
    ];
  }

  async createMediaAsset(input: MediaAssetRecord) {
    this.mediaAssets.set(input.id, structuredClone(input));
    return structuredClone(input);
  }

  async getMediaAsset(workspaceId: string, mediaId: string) {
    const asset = this.mediaAssets.get(mediaId);
    return asset?.workspaceId === workspaceId ? structuredClone(asset) : null;
  }

  async listMediaAssets(workspaceId: string) {
    return [...this.mediaAssets.values()]
      .filter((asset) => asset.workspaceId === workspaceId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((asset) => structuredClone(asset));
  }

  async listStaleMedia(cutoff: Date, limit = 100) {
    return [...this.mediaAssets.values()]
      .filter((asset) => asset.scanStatus !== "clean" && asset.createdAt <= cutoff)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .slice(0, limit)
      .map((asset) => structuredClone(asset));
  }

  async updateMediaAsset(
    workspaceId: string,
    mediaId: string,
    update: { objectKey?: string; scanStatus: MediaScanStatus },
  ) {
    const asset = this.mediaAssets.get(mediaId);
    if (!asset || asset.workspaceId !== workspaceId) return null;
    asset.scanStatus = update.scanStatus;
    if (update.objectKey) asset.objectKey = update.objectKey;
    return structuredClone(asset);
  }

  async deleteMediaAsset(workspaceId: string, mediaId: string) {
    const asset = this.mediaAssets.get(mediaId);
    if (!asset || asset.workspaceId !== workspaceId) return false;
    return this.mediaAssets.delete(mediaId);
  }

  async persistAnswer(_workspaceId: string, sessionId: string, answer: EngineAnswer) {
    const duplicate = [...this.answers.values()].find(
      (candidate) =>
        candidate.idempotencyKey === answer.idempotencyKey ||
        (candidate.roundId === answer.roundId && candidate.participantId === answer.participantId),
    );
    if (duplicate) return structuredClone(duplicate);
    this.answers.set(`${sessionId}:${answer.answerId}`, structuredClone(answer));
    return structuredClone(answer);
  }

  async commitAnswer(session: StoredSession, answer: EngineAnswer, expectedVersion: number) {
    return (await this.commitAnswers(session, [answer], expectedVersion))[0]!;
  }

  async commitAnswers(session: StoredSession, answers: EngineAnswer[], expectedVersion: number) {
    const current = this.sessions.get(session.id);
    if (!current || current.state.version !== expectedVersion) {
      throw new SessionVersionConflictError(session.id, expectedVersion);
    }
    const persisted: EngineAnswer[] = [];
    const staged = new Map<string, EngineAnswer>();
    for (const answer of answers) {
      const result = [...this.answers.values(), ...staged.values()].find(
        (candidate) =>
          candidate.idempotencyKey === answer.idempotencyKey ||
          (candidate.roundId === answer.roundId &&
            candidate.participantId === answer.participantId),
      );
      const committed = result ?? structuredClone(answer);
      if (!result) staged.set(`${session.id}:${answer.answerId}`, committed);
      persisted.push(committed);
    }
    if (persisted.some((answer, index) => answer.answerId !== answers[index]?.answerId)) {
      throw new Error("Answer state changed during persistence");
    }
    for (const [key, answer] of staged) this.answers.set(key, answer);
    if (staged.size > 0) {
      this.sessions.set(session.id, structuredClone({ ...session, updatedAt: new Date() }));
    }
    return persisted;
  }

  async saveReport(_workspaceId: string, report: Report) {
    const prior = [...this.reports.entries()].find(
      ([id, candidate]) => id !== report.id && candidate.sessionId === report.sessionId,
    );
    const createdAt = prior ? (this.reportCreatedAt.get(prior[0]) ?? new Date()) : new Date();
    if (prior) {
      this.reports.delete(prior[0]);
      this.reportJobs.delete(prior[0]);
      this.reportCreatedAt.delete(prior[0]);
    }
    this.reports.set(report.id, structuredClone(report));
    if (!this.reportCreatedAt.has(report.id)) this.reportCreatedAt.set(report.id, createdAt);
    if (report.status === "pending") {
      this.reportJobs.set(report.id, {
        workspaceId: _workspaceId,
        attempts: 0,
        availableAt: new Date(0),
        lastError: null,
      });
    } else {
      this.reportJobs.delete(report.id);
    }
  }

  async claimReportJob(now: Date, leaseUntil: Date) {
    const candidate = [...this.reportJobs.entries()]
      .filter(([id, job]) => this.reports.get(id)?.status === "pending" && job.availableAt <= now)
      .sort((left, right) => left[1].availableAt.getTime() - right[1].availableAt.getTime())[0];
    if (!candidate) return null;
    const [reportId, metadata] = candidate;
    const report = this.reports.get(reportId)!;
    metadata.attempts += 1;
    metadata.availableAt = leaseUntil;
    return {
      reportId,
      workspaceId: metadata.workspaceId,
      sessionId: report.sessionId,
      attempts: metadata.attempts,
      expiresAt: new Date(report.expiresAt),
    };
  }

  async completeReportJob(job: ReportJob, report: Report) {
    if (job.reportId !== report.id || job.sessionId !== report.sessionId) {
      throw new Error("Completed report does not match the claimed job");
    }
    this.reports.set(report.id, structuredClone(report));
    if (!this.reportCreatedAt.has(report.id)) this.reportCreatedAt.set(report.id, new Date());
    this.reportJobs.delete(report.id);
  }

  async retryReportJob(job: ReportJob, error: string, availableAt: Date, failed: boolean) {
    const report = this.reports.get(job.reportId);
    const metadata = this.reportJobs.get(job.reportId);
    if (!report || !metadata) return;
    metadata.lastError = error;
    metadata.availableAt = availableAt;
    if (failed) {
      this.reports.set(job.reportId, { ...report, status: "failed" });
      this.reportJobs.delete(job.reportId);
    }
  }

  async getReport(workspaceId: string, reportId: string) {
    const report = this.reports.get(reportId);
    const session = report ? this.sessions.get(report.sessionId) : undefined;
    return report && session?.workspaceId === workspaceId ? structuredClone(report) : null;
  }

  async getReportBySession(workspaceId: string, sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session || session.workspaceId !== workspaceId) return null;
    const report = [...this.reports.values()].find(
      (candidate) => candidate.sessionId === sessionId,
    );
    return report ? structuredClone(report) : null;
  }

  async listReportHistory(
    workspaceId: string,
    options: {
      cursor?: HistoryCursor;
      limit: number;
      status?: Report["status"];
      quizId?: string;
      from?: Date;
      to?: Date;
      now: Date;
    },
  ) {
    const records = [...this.reports.values()]
      .flatMap((report): ReportHistoryRecord[] => {
        const session = this.sessions.get(report.sessionId);
        if (!session || session.workspaceId !== workspaceId) return [];
        const version = this.versions.get(session.quizVersionId);
        if (!version) return [];
        const quiz = this.quizzes.get(version.quizId);
        if (!quiz) return [];
        const recovery = "recovery" in report ? report.recovery : [];
        const recovered = recovery.reduce((sum, item) => sum + item.recovered, 0);
        const eligible = recovery.reduce((sum, item) => sum + item.initiallyIncorrectWithBoth, 0);
        const followup = [...this.followups.values()].find(
          (candidate) => candidate.sourceReportId === report.id,
        );
        const followupStatus: ReportHistoryRecord["followupStatus"] = !followup
          ? null
          : followup.expiresAt <= options.now
            ? "expired"
            : followup.closedAt || followup.closesAt <= options.now
              ? "closed"
              : followup.opensAt > options.now
                ? "scheduled"
                : "open";
        return [
          {
            id: report.id,
            sessionId: report.sessionId,
            quizId: version.quizId,
            title: session.state.quiz.title,
            status: report.status,
            participantCount: report.metrics.participantCount,
            initialAccuracyPercent:
              "initialAccuracy" in report
                ? report.initialAccuracy.percent
                : report.metrics.accuracyPercent,
            recovery: {
              recovered,
              eligible,
              percent:
                eligible > 0
                  ? Math.min(100, Math.round((recovered / eligible) * 10_000) / 100)
                  : null,
            },
            unresolvedConceptCount:
              "unresolvedConcepts" in report
                ? report.unresolvedConcepts.filter((concept) => concept.unresolved > 0).length
                : 0,
            interventionCount: "interventions" in report ? report.interventions.length : 0,
            followupId: followup?.id ?? null,
            followupStatus,
            generatedAt: report.generatedAt ? new Date(report.generatedAt) : null,
            createdAt: new Date(this.reportCreatedAt.get(report.id) ?? session.updatedAt),
            expiresAt: new Date(report.expiresAt),
          },
        ];
      })
      .filter((item) => !options.status || item.status === options.status)
      .filter((item) => !options.quizId || item.quizId === options.quizId)
      .filter((item) => !options.from || item.createdAt.getTime() >= options.from.getTime())
      .filter((item) => !options.to || item.createdAt.getTime() <= options.to.getTime())
      .filter(
        (item) =>
          !options.cursor ||
          item.createdAt.getTime() < options.cursor.createdAt.getTime() ||
          (item.createdAt.getTime() === options.cursor.createdAt.getTime() &&
            item.id < options.cursor.id),
      )
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id),
      );
    return {
      items: structuredClone(records.slice(0, options.limit)),
      hasMore: records.length > options.limit,
    };
  }

  async createFollowup(input: FollowupRecord, access: FollowupAccessRecord[]) {
    if (this.followups.has(input.id)) throw new Error("Follow-up already exists");
    if ([...this.followups.values()].some((item) => item.sourceReportId === input.sourceReportId)) {
      throw new Error("A follow-up already exists for this report");
    }
    const session = this.sessions.get(input.sourceSessionId);
    const report = this.reports.get(input.sourceReportId);
    if (
      !session ||
      session.workspaceId !== input.workspaceId ||
      !report ||
      report.sessionId !== input.sourceSessionId
    ) {
      throw new Error("Follow-up source does not exist");
    }
    this.followups.set(input.id, structuredClone(input));
    for (const item of access) {
      if (this.followupAccess.has(item.tokenHash)) throw new Error("Duplicate follow-up token");
      this.followupAccess.set(item.tokenHash, structuredClone(item));
    }
  }

  async getFollowup(workspaceId: string, followupId: string) {
    const followup = this.followups.get(followupId);
    return followup?.workspaceId === workspaceId ? structuredClone(followup) : null;
  }

  async getFollowupByReport(workspaceId: string, reportId: string) {
    const followup = [...this.followups.values()].find(
      (candidate) => candidate.workspaceId === workspaceId && candidate.sourceReportId === reportId,
    );
    return followup ? structuredClone(followup) : null;
  }

  async listFollowupHistory(
    workspaceId: string,
    options: {
      cursor?: HistoryCursor;
      limit: number;
      status?: FollowupHistoryRecord["status"];
      quizId?: string;
      from?: Date;
      to?: Date;
      now: Date;
    },
  ) {
    const records = [...this.followups.values()]
      .filter((followup) => followup.workspaceId === workspaceId)
      .flatMap((followup): FollowupHistoryRecord[] => {
        const session = this.sessions.get(followup.sourceSessionId);
        const version = session ? this.versions.get(session.quizVersionId) : undefined;
        if (!version || (options.quizId && version.quizId !== options.quizId)) return [];
        const attempts = [...this.followupAttempts.values()].filter(
          (attempt) => attempt.followupId === followup.id,
        );
        const status: FollowupHistoryRecord["status"] =
          followup.expiresAt <= options.now
            ? "expired"
            : followup.closedAt || followup.closesAt <= options.now
              ? "closed"
              : followup.opensAt > options.now
                ? "scheduled"
                : "open";
        return [
          {
            id: followup.id,
            sourceSessionId: followup.sourceSessionId,
            sourceReportId: followup.sourceReportId,
            quizId: version.quizId,
            title: followup.title,
            status,
            conceptKeys: [...followup.conceptKeys],
            checkpointCount: followup.content.questions.length,
            attemptCount: attempts.length,
            completedAttemptCount: attempts.filter((attempt) => attempt.status === "completed")
              .length,
            opensAt: new Date(followup.opensAt),
            closesAt: new Date(followup.closesAt),
            expiresAt: new Date(followup.expiresAt),
            createdAt: new Date(followup.createdAt),
          },
        ];
      })
      .filter((item) => !options.status || item.status === options.status)
      .filter((item) => !options.from || item.createdAt.getTime() >= options.from.getTime())
      .filter((item) => !options.to || item.createdAt.getTime() <= options.to.getTime())
      .filter(
        (item) =>
          !options.cursor ||
          item.createdAt.getTime() < options.cursor.createdAt.getTime() ||
          (item.createdAt.getTime() === options.cursor.createdAt.getTime() &&
            item.id < options.cursor.id),
      )
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id),
      );
    return {
      items: structuredClone(records.slice(0, options.limit)),
      hasMore: records.length > options.limit,
    };
  }

  async getFollowupByGenericToken(followupId: string, tokenHash: string, now: Date) {
    const followup = this.followups.get(followupId);
    return followup && followup.genericTokenHash === tokenHash && followup.expiresAt > now
      ? structuredClone(followup)
      : null;
  }

  async getFollowupAccessByToken(followupId: string, tokenHash: string, now: Date) {
    const access = this.followupAccess.get(tokenHash);
    return access && access.followupId === followupId && !access.revokedAt && access.expiresAt > now
      ? structuredClone(access)
      : null;
  }

  async listFollowupAccess(workspaceId: string, followupId: string) {
    if ((await this.getFollowup(workspaceId, followupId)) === null) return [];
    return [...this.followupAccess.values()]
      .filter((item) => item.followupId === followupId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((item) => structuredClone(item));
  }

  async createFollowupAccess(input: FollowupAccessRecord) {
    const followup = this.followups.get(input.followupId);
    if (!followup || followup.workspaceId !== input.workspaceId) {
      throw new Error("Follow-up not found");
    }
    if (this.followupAccess.has(input.tokenHash)) throw new Error("Duplicate follow-up token");
    this.followupAccess.set(input.tokenHash, structuredClone(input));
    return structuredClone(input);
  }

  async revokeFollowupAccess(
    workspaceId: string,
    followupId: string,
    accessId: string,
    revokedAt: Date,
  ) {
    const item = [...this.followupAccess.values()].find(
      (candidate) =>
        candidate.workspaceId === workspaceId &&
        candidate.followupId === followupId &&
        candidate.id === accessId,
    );
    if (!item) return false;
    item.revokedAt = revokedAt;
    return true;
  }

  async closeFollowup(workspaceId: string, followupId: string, closedAt: Date) {
    const followup = this.followups.get(followupId);
    if (!followup || followup.workspaceId !== workspaceId) return false;
    followup.closedAt ??= closedAt;
    return true;
  }

  async createOrGetFollowupAttempt(input: FollowupAttemptRecord) {
    const byToken = this.followupAttempts.get(input.attemptTokenHash);
    if (byToken) return structuredClone(byToken);
    if (input.accessTokenId) {
      const byAccess = [...this.followupAttempts.values()].find(
        (candidate) => candidate.accessTokenId === input.accessTokenId,
      );
      if (byAccess) return structuredClone(byAccess);
    }
    this.followupAttempts.set(input.attemptTokenHash, structuredClone(input));
    return structuredClone(input);
  }

  async getFollowupAttemptByToken(followupId: string, tokenHash: string, now: Date) {
    const attempt = this.followupAttempts.get(tokenHash);
    if (!attempt || attempt.followupId !== followupId) return null;
    if (attempt.accessTokenId) {
      const access = [...this.followupAccess.values()].find(
        (candidate) => candidate.id === attempt.accessTokenId,
      );
      if (!access || access.revokedAt || access.expiresAt <= now) return null;
    }
    return structuredClone(attempt);
  }

  async getFollowupAnswer(attemptId: string, checkpointId: string) {
    const answer = this.followupAnswers.get(`${attemptId}:${checkpointId}`);
    return answer ? structuredClone(answer) : null;
  }

  async commitFollowupAnswer(
    attempt: FollowupAttemptRecord,
    answer: FollowupAnswerRecord,
    expectedVersion: number,
  ) {
    const duplicate = [...this.followupAnswers.values()].find(
      (candidate) =>
        candidate.attemptId === answer.attemptId &&
        candidate.idempotencyKey === answer.idempotencyKey,
    );
    if (duplicate) return structuredClone(duplicate);
    const current = this.followupAttempts.get(attempt.attemptTokenHash);
    if (!current || current.version !== expectedVersion) {
      throw new FollowupVersionConflictError(attempt.id, expectedVersion);
    }
    const key = `${answer.attemptId}:${answer.checkpointId}`;
    if (this.followupAnswers.has(key)) throw new Error("This checkpoint was already answered");
    this.followupAnswers.set(key, structuredClone(answer));
    this.followupAttempts.set(attempt.attemptTokenHash, structuredClone(attempt));
    return structuredClone(answer);
  }

  async advanceFollowupAttempt(attempt: FollowupAttemptRecord, expectedVersion: number) {
    const current = this.followupAttempts.get(attempt.attemptTokenHash);
    if (!current || current.version !== expectedVersion) return false;
    this.followupAttempts.set(attempt.attemptTokenHash, structuredClone(attempt));
    return true;
  }

  async createAuthoringJob(input: AuthoringJobRecord) {
    if (this.authoringJobs.has(input.id)) throw new Error("Authoring job already exists");
    this.authoringJobs.set(input.id, structuredClone(input));
    return structuredClone(input);
  }

  async createAuthoringJobWithinLimit(
    input: AuthoringJobRecord,
    since: Date,
    monthlyLimit: number | null,
  ) {
    const used = [...this.authoringJobs.values()].filter(
      (job) => job.workspaceId === input.workspaceId && job.createdAt >= since,
    ).length;
    if (monthlyLimit !== null && used >= monthlyLimit) return null;
    return this.createAuthoringJob(input);
  }

  async countAuthoringJobsSince(workspaceId: string, since: Date) {
    return [...this.authoringJobs.values()].filter(
      (job) => job.workspaceId === workspaceId && job.createdAt >= since,
    ).length;
  }

  async getAuthoringJob(workspaceId: string, jobId: string) {
    const job = this.authoringJobs.get(jobId);
    return job?.workspaceId === workspaceId ? structuredClone(job) : null;
  }

  async listAuthoringJobs(workspaceId: string, limit: number) {
    return [...this.authoringJobs.values()]
      .filter((job) => job.workspaceId === workspaceId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, limit)
      .map((job) => structuredClone(job));
  }

  async claimAuthoringJob(now: Date, leaseUntil: Date) {
    const job = [...this.authoringJobs.values()]
      .filter(
        (candidate) =>
          (candidate.status === "pending" || candidate.status === "processing") &&
          candidate.availableAt <= now,
      )
      .sort((left, right) => left.availableAt.getTime() - right.availableAt.getTime())[0];
    if (!job) return null;
    job.status = "processing";
    job.attempts += 1;
    job.availableAt = leaseUntil;
    job.updatedAt = now;
    return structuredClone(job);
  }

  async completeAuthoringJob(
    jobId: string,
    expectedAttempts: number,
    output: NonNullable<AuthoringJobRecord["output"]>,
    completedAt: Date,
  ) {
    const job = this.authoringJobs.get(jobId);
    if (!job || !output || job.status !== "processing" || job.attempts !== expectedAttempts) {
      return false;
    }
    job.status = "ready";
    job.output = structuredClone(output);
    job.sourceText = null;
    job.sourceBlob = null;
    job.lastError = null;
    job.updatedAt = completedAt;
    return true;
  }

  async applyAuthoringJobDraft(workspaceId: string, jobId: string, quiz: QuizRecord) {
    const job = this.authoringJobs.get(jobId);
    if (!job || job.workspaceId !== workspaceId || job.status !== "ready" || !job.output) {
      return null;
    }
    if (job.appliedQuizId) {
      const existing = this.quizzes.get(job.appliedQuizId);
      return existing?.workspaceId === workspaceId ? structuredClone(existing) : null;
    }
    const created = await this.createQuiz(quiz);
    job.appliedQuizId = created.id;
    job.updatedAt = new Date();
    return created;
  }

  async retryAuthoringJob(
    jobId: string,
    expectedAttempts: number,
    error: string,
    availableAt: Date,
    failed: boolean,
  ) {
    const job = this.authoringJobs.get(jobId);
    if (!job || job.status !== "processing" || job.attempts !== expectedAttempts) return false;
    job.status = failed ? "failed" : "pending";
    job.lastError = error.slice(0, 2_000);
    job.availableAt = availableAt;
    job.updatedAt = new Date();
    if (failed) {
      job.sourceText = null;
      job.sourceBlob = null;
    }
    return true;
  }

  async getPlan(workspaceId: string) {
    return this.plans.get(workspaceId) ?? "free";
  }

  async getBillingProfile(workspaceId: string) {
    const profile = this.billingProfiles.get(workspaceId);
    return {
      plan: this.plans.get(workspaceId) ?? "free",
      status: profile?.status ?? "free",
      customerId: profile?.customerId ?? null,
      subscriptionId: profile?.subscriptionId ?? null,
    };
  }

  async setPlan(
    workspaceId: string,
    plan: Plan,
    provider: { customerId?: string; subscriptionId?: string; status?: string } = {},
  ) {
    this.plans.set(workspaceId, plan);
    const previous = this.billingProfiles.get(workspaceId);
    this.billingProfiles.set(workspaceId, {
      status: provider.status ?? previous?.status ?? (plan === "free" ? "free" : "active"),
      customerId: provider.customerId ?? previous?.customerId ?? null,
      subscriptionId: provider.subscriptionId ?? previous?.subscriptionId ?? null,
    });
  }

  async recordBillingEvent(providerEventId: string, _eventType: string) {
    if (this.billingEvents.has(providerEventId)) return false;
    this.billingEvents.add(providerEventId);
    return true;
  }

  async applyBillingEvent(input: BillingEventInput) {
    if (!(await this.recordBillingEvent(input.providerEventId, input.eventType))) return false;
    if (input.workspaceId && input.plan) {
      const lastCreatedAt = this.billingEventCreatedAt.get(input.workspaceId);
      if (!lastCreatedAt || input.providerCreatedAt >= lastCreatedAt) {
        await this.setPlan(input.workspaceId, input.plan, {
          customerId: input.customerId,
          subscriptionId: input.subscriptionId,
          status: input.status,
        });
        this.billingEventCreatedAt.set(input.workspaceId, input.providerCreatedAt);
      }
    }
    return true;
  }

  async recordAudit(input: AuditInput) {
    this.audits.push({ id: crypto.randomUUID(), ...structuredClone(input), createdAt: new Date() });
  }

  async listAuditEvents(workspaceId: string, since: Date | null, limit: number) {
    return this.audits
      .filter(
        (event) =>
          event.workspaceId === workspaceId &&
          (!since || event.createdAt.getTime() >= since.getTime()),
      )
      .sort((left, right) => {
        const byTime = left.createdAt.getTime() - right.createdAt.getTime();
        return byTime || left.id.localeCompare(right.id);
      })
      .slice(0, limit)
      .map((event) => structuredClone(event));
  }

  async purgeAuditEvents(cutoff: Date) {
    let purged = 0;
    for (let index = this.audits.length - 1; index >= 0; index -= 1) {
      if (this.audits[index]!.createdAt <= cutoff) {
        this.audits.splice(index, 1);
        purged += 1;
      }
    }
    return purged;
  }

  async recordProductEvents(events: ProductEventRecord[]) {
    const workspaceId = events[0]?.workspaceId;
    if (events.some((event) => event.workspaceId !== workspaceId)) {
      throw new Error("Product event batches cannot span workspaces");
    }
    const ids = new Set(this.productEvents.map((event) => event.id));
    for (const event of events) {
      if (ids.has(event.id)) throw new Error("Product event already exists");
      ids.add(event.id);
    }
    this.productEvents.push(...structuredClone(events));
  }

  async purgeProductEvents(now: Date) {
    let purged = 0;
    for (let index = this.productEvents.length - 1; index >= 0; index -= 1) {
      if (this.productEvents[index]!.expiresAt <= now) {
        this.productEvents.splice(index, 1);
        purged += 1;
      }
    }
    return purged;
  }

  async exportAccount(userId: string) {
    const user = this.users.get(userId);
    if (!user || user.deletedAt) return {};
    const workspaceMemberships = await this.listWorkspaces(userId);
    const ownedWorkspaceIds = new Set(
      workspaceMemberships
        .filter((membership) => membership.role === "owner")
        .map((membership) => membership.id),
    );
    const sessions = [...this.sessions.values()].filter((session) =>
      ownedWorkspaceIds.has(session.workspaceId),
    );
    const sessionIds = new Set(sessions.map((session) => session.id));
    const participants = [...this.participants.values()].filter((participant) =>
      sessionIds.has(participant.sessionId),
    );
    const ownedWorkspaceIdList = [...ownedWorkspaceIds];
    return {
      profile: { id: user.userId, email: user.email, segment: user.segment },
      workspaceMemberships,
      workspaces: await Promise.all(
        ownedWorkspaceIdList.map(async (workspaceId) => ({
          ...this.workspaces.get(workspaceId)!,
          role: "owner",
          brandTheme: await this.getBrandTheme(workspaceId),
        })),
      ),
      folders: (
        await Promise.all(ownedWorkspaceIdList.map((workspaceId) => this.listFolders(workspaceId)))
      ).flat(),
      quizzes: (
        await Promise.all(
          ownedWorkspaceIdList.map((workspaceId) => this.listQuizzes(workspaceId, true)),
        )
      ).flat(),
      quizVersions: [...this.versions.values()].filter((version) =>
        ownedWorkspaceIds.has(version.workspaceId),
      ),
      mediaAssets: (
        await Promise.all(
          ownedWorkspaceIdList.map((workspaceId) => this.listMediaAssets(workspaceId)),
        )
      ).flat(),
      sessions: sessions.map(({ hostTokenHash: _hostTokenHash, ...session }) => session),
      participants: participants.map(({ tokenHash: _tokenHash, ...participant }) => participant),
      answers: [...this.answers.entries()]
        .filter(([key]) => sessionIds.has(key.split(":", 1)[0]!))
        .map(([, answer]) => structuredClone(answer)),
      reports: [...this.reports.values()].filter((report) => sessionIds.has(report.sessionId)),
      interactionSettings: [...this.interactionSettings.values()].filter((settings) =>
        sessionIds.has(settings.sessionId),
      ),
      participantSignals: [...this.participantSignals.values()].filter((signal) =>
        sessionIds.has(signal.sessionId),
      ),
      signalEvents: this.signalEvents.filter((event) => sessionIds.has(event.sessionId)),
      chatMessages: [...this.chatMessages.values()].filter((message) =>
        sessionIds.has(message.sessionId),
      ),
      chatReactions: [...this.chatReactions.values()].filter((reaction) =>
        sessionIds.has(reaction.sessionId),
      ),
      chatReports: [...this.chatReports]
        .map((report) => {
          const separator = report.indexOf(":");
          return {
            messageId: report.slice(0, separator),
            participantId: report.slice(separator + 1),
          };
        })
        .filter((report) =>
          [...this.chatMessages.values()].some(
            (message) => message.id === report.messageId && sessionIds.has(message.sessionId),
          ),
        ),
      audienceRestrictions: [...this.audienceRestrictions.values()].filter((restriction) =>
        sessionIds.has(restriction.sessionId),
      ),
      followups: [...this.followups.values()]
        .filter((followup) => ownedWorkspaceIds.has(followup.workspaceId))
        .map(({ genericTokenHash: _genericTokenHash, ...followup }) => structuredClone(followup)),
      followupAccess: [...this.followupAccess.values()]
        .filter((access) => ownedWorkspaceIds.has(access.workspaceId))
        .map(({ tokenHash: _tokenHash, ...access }) => structuredClone(access)),
      followupAttempts: [...this.followupAttempts.values()]
        .filter((attempt) => ownedWorkspaceIds.has(attempt.workspaceId))
        .map(({ attemptTokenHash: _attemptTokenHash, ...attempt }) => structuredClone(attempt)),
      followupAnswers: [...this.followupAnswers.values()].filter((answer) =>
        ownedWorkspaceIds.has(answer.workspaceId),
      ),
      authoringJobs: [...this.authoringJobs.values()]
        .filter((job) => ownedWorkspaceIds.has(job.workspaceId))
        .map(({ sourceBlob, ...job }) => ({
          ...structuredClone(job),
          sourceBlobBase64: sourceBlob?.toString("base64") ?? null,
        })),
      institutionPolicies: await Promise.all(
        ownedWorkspaceIdList.map((workspaceId) => this.getInstitutionPolicy(workspaceId)),
      ),
      externalIdentities: [...this.externalIdentities.values()].filter(
        (identity) => identity.userId === userId,
      ),
      ltiRegistrations: (
        await Promise.all(
          ownedWorkspaceIdList.map((workspaceId) => this.listLtiRegistrations(workspaceId)),
        )
      ).flat(),
      ltiLaunches: [...this.ltiLaunches.values()]
        .filter((launch) => ownedWorkspaceIds.has(launch.workspaceId))
        .map(({ linkTokenHash: _linkTokenHash, responseJwt: _responseJwt, ...launch }) =>
          structuredClone(launch),
        ),
      billing: await Promise.all(
        ownedWorkspaceIdList.map(async (workspaceId) => ({
          workspaceId,
          ...(await this.getBillingProfile(workspaceId)),
        })),
      ),
      consentRecords: this.consents.filter((record) => record.userId === userId),
      auditEvents: this.audits.filter(
        (audit) => audit.workspaceId !== null && ownedWorkspaceIds.has(audit.workspaceId),
      ),
    };
  }

  async deleteAccount(userId: string) {
    const user = this.users.get(userId);
    if (!user) return;
    const originalEmail = user.email;
    const ownedWorkspaceIds = new Set(
      (await this.listWorkspaces(userId))
        .filter((workspace) => workspace.role === "owner")
        .map((workspace) => workspace.id),
    );
    user.deletedAt = new Date();
    user.email = `deleted-${userId.slice(0, 8)}@invalid.local`;
    for (const [tokenHash, session] of this.creatorSessions) {
      if (session.userId === userId) this.creatorSessions.delete(tokenHash);
    }
    for (const [tokenHash, token] of this.magicTokens) {
      if (token.email === originalEmail) this.magicTokens.delete(tokenHash);
    }
    for (const [id, quiz] of this.quizzes) {
      if (ownedWorkspaceIds.has(quiz.workspaceId)) this.quizzes.delete(id);
    }
    for (const [id, folder] of this.folders) {
      if (ownedWorkspaceIds.has(folder.workspaceId)) this.folders.delete(id);
    }
    for (const [id, version] of this.versions) {
      if (ownedWorkspaceIds.has(version.workspaceId)) this.versions.delete(id);
    }
    const deletedSessionIds = new Set<string>();
    for (const [id, session] of this.sessions) {
      if (ownedWorkspaceIds.has(session.workspaceId)) {
        deletedSessionIds.add(id);
        this.deleteSessionTree(id);
      }
    }
    for (const [tokenHash, participant] of this.participants) {
      if (deletedSessionIds.has(participant.sessionId)) this.participants.delete(tokenHash);
    }
    for (const key of this.answers.keys()) {
      if (deletedSessionIds.has(key.split(":", 1)[0]!)) this.answers.delete(key);
    }
    for (const [id, report] of this.reports) {
      if (deletedSessionIds.has(report.sessionId)) this.reports.delete(id);
    }
    for (const [id, asset] of this.mediaAssets) {
      if (ownedWorkspaceIds.has(asset.workspaceId)) this.mediaAssets.delete(id);
    }
    for (const [id, job] of this.authoringJobs) {
      if (ownedWorkspaceIds.has(job.workspaceId)) this.authoringJobs.delete(id);
    }
    for (let index = this.productEvents.length - 1; index >= 0; index -= 1) {
      if (ownedWorkspaceIds.has(this.productEvents[index]!.workspaceId)) {
        this.productEvents.splice(index, 1);
      }
    }
    for (const workspaceId of ownedWorkspaceIds) {
      this.institutionPolicies.delete(workspaceId);
      this.plans.delete(workspaceId);
      this.brandThemes.delete(workspaceId);
      this.billingProfiles.delete(workspaceId);
      this.billingEventCreatedAt.delete(workspaceId);
      this.workspaces.delete(workspaceId);
    }
    for (const [id, identity] of this.externalIdentities) {
      if (ownedWorkspaceIds.has(identity.workspaceId) || identity.userId === userId)
        this.externalIdentities.delete(id);
    }
    for (const [stateHash, transaction] of this.federatedAuthTransactions) {
      if (ownedWorkspaceIds.has(transaction.workspaceId) || transaction.userId === userId)
        this.federatedAuthTransactions.delete(stateHash);
    }
    for (const [id, registration] of this.ltiRegistrations) {
      if (ownedWorkspaceIds.has(registration.workspaceId)) this.ltiRegistrations.delete(id);
    }
    for (const [stateHash, transaction] of this.ltiLoginTransactions) {
      if (ownedWorkspaceIds.has(transaction.workspaceId))
        this.ltiLoginTransactions.delete(stateHash);
    }
    for (const [id, launch] of this.ltiLaunches) {
      if (ownedWorkspaceIds.has(launch.workspaceId)) this.ltiLaunches.delete(id);
    }
    for (const [key, membership] of this.workspaceMembers) {
      if (membership.userId === userId || ownedWorkspaceIds.has(membership.workspaceId)) {
        this.workspaceMembers.delete(key);
      }
    }
    for (const [id, invitation] of this.workspaceInvitations) {
      if (ownedWorkspaceIds.has(invitation.workspaceId)) this.workspaceInvitations.delete(id);
    }
    for (let index = this.consents.length - 1; index >= 0; index -= 1) {
      if (this.consents[index]?.userId === userId) this.consents.splice(index, 1);
    }
    for (const audit of this.audits) {
      if (audit.workspaceId !== null && ownedWorkspaceIds.has(audit.workspaceId)) {
        audit.workspaceId = null;
        audit.actorId = null;
        audit.metadata = {};
      }
    }
  }

  async purgeExpired(now: Date) {
    const purged: string[] = [];
    for (const [id, session] of this.sessions) {
      if (session.retentionExpiresAt <= now) {
        this.deleteSessionTree(id);
        purged.push(id);
      }
    }
    for (const [tokenHash, token] of this.magicTokens) {
      if (token.expiresAt <= now) this.magicTokens.delete(tokenHash);
    }
    for (const [tokenHash, session] of this.creatorSessions) {
      if (session.expiresAt <= now) this.creatorSessions.delete(tokenHash);
    }
    for (const [id, job] of this.authoringJobs) {
      if (job.expiresAt <= now) this.authoringJobs.delete(id);
    }
    for (const [stateHash, transaction] of this.federatedAuthTransactions) {
      if (transaction.expiresAt <= now) this.federatedAuthTransactions.delete(stateHash);
    }
    for (const [stateHash, transaction] of this.ltiLoginTransactions) {
      if (transaction.expiresAt <= now) this.ltiLoginTransactions.delete(stateHash);
    }
    for (const [id, launch] of this.ltiLaunches) {
      if (launch.expiresAt <= now) this.ltiLaunches.delete(id);
    }
    return purged;
  }

  async expireLiveSessions(now: Date) {
    const expired: string[] = [];
    for (const [id, session] of this.sessions) {
      if (
        session.expiresAt <= now &&
        session.state.phase !== "finished" &&
        !this.expiredLiveSessions.has(id)
      ) {
        this.expiredLiveSessions.add(id);
        expired.push(id);
      }
    }
    return expired;
  }
}

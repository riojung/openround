import type { EngineAnswer } from "@openround/game-engine";
import {
  FollowupVersionConflictError,
  PublishedQuizLimitError,
  SessionCodeConflictError,
  SessionVersionConflictError,
} from "./types.js";
import type {
  AuditEventRecord,
  AuditInput,
  AnswerLookup,
  AuthoringJobRecord,
  BillingEventInput,
  CreatorContext,
  FolderRecord,
  FollowupAccessRecord,
  FollowupAnswerRecord,
  FollowupAttemptRecord,
  FollowupRecord,
  FederatedAuthTransactionRecord,
  ExternalIdentityRecord,
  InstitutionPolicyRecord,
  LtiLaunchRecord,
  LtiLoginTransactionRecord,
  LtiRegistrationRecord,
  MagicTokenRecord,
  MediaAssetRecord,
  MediaScanStatus,
  OperationalFeaturesRecord,
  OperationalFeaturesUpdate,
  ParticipantRecord,
  Plan,
  QnaQuestionRecord,
  QnaReplyRecord,
  QnaSettingsRecord,
  QuizRecord,
  QuizVersionRecord,
  ReportJob,
  Repository,
  SessionStaffCredentialRecord,
  StoredSession,
  WorkspaceInvitationRecord,
  WorkspaceMemberRecord,
  WorkspaceSummaryRecord,
} from "./types.js";
import type { BrandTheme, QuizDraft, Report } from "@openround/contracts";

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
  readonly mediaAssets = new Map<string, MediaAssetRecord>();
  readonly answers = new Map<string, EngineAnswer>();
  readonly reports = new Map<string, Report>();
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
  readonly consents: ConsentRecord[] = [];
  readonly operationalFeatures: OperationalFeaturesRecord = {
    signups: true,
    sessionCreation: true,
    mediaUploads: true,
    updatedAt: null,
  };

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
      user = {
        userId,
        workspaceId: crypto.randomUUID(),
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
    return [...this.quizzes.values()]
      .filter(
        (quiz) =>
          quiz.workspaceId === workspaceId && (includeArchived || quiz.status !== "archived"),
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map((quiz) => structuredClone(quiz));
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

  async saveSession(input: StoredSession, expectedVersion: number, report?: Report) {
    const current = this.sessions.get(input.id);
    if (!current || current.state.version !== expectedVersion) {
      throw new SessionVersionConflictError(input.id, expectedVersion);
    }
    if (report && report.sessionId !== input.id) throw new Error("Report session does not match");
    const storedSession = structuredClone({ ...input, updatedAt: new Date() });
    const storedReport = report ? structuredClone(report) : undefined;
    this.sessions.set(input.id, storedSession);
    if (storedReport) {
      const prior = [...this.reports.entries()].find(
        ([, candidate]) => candidate.sessionId === storedReport.sessionId,
      );
      if (prior) {
        this.reports.delete(prior[0]);
        this.reportJobs.delete(prior[0]);
      }
      this.reports.set(storedReport.id, storedReport);
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
    for (const key of this.answers.keys()) {
      if (key.startsWith(`${sessionId}:`)) this.answers.delete(key);
    }
    for (const [id, report] of this.reports) {
      if (report.sessionId === sessionId) {
        this.reports.delete(id);
        this.reportJobs.delete(id);
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

  async createSessionStaffCredential(input: SessionStaffCredentialRecord) {
    const normalized = {
      ...input,
      embedPolicyKeyHash: input.embedPolicyKeyHash ?? null,
      embedAllowedOrigins: input.embedAllowedOrigins ?? [],
    };
    this.sessionStaff.set(input.tokenHash, structuredClone(normalized));
    return structuredClone(normalized);
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

  async revokeSessionStaff(workspaceId: string, credentialId: string) {
    const credential = [...this.sessionStaff.values()].find(
      (candidate) => candidate.workspaceId === workspaceId && candidate.id === credentialId,
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

  async getSessionEvidence(workspaceId: string, sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session || session.workspaceId !== workspaceId) {
      return {
        answers: [],
        rounds: [],
        interventions: [],
        qna: { questions: 0, answered: 0, unresolved: 0 },
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
    this.reports.set(report.id, structuredClone(report));
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

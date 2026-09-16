import type { EngineAnswer } from "@openround/game-engine";
import {
  PublishedQuizLimitError,
  SessionCodeConflictError,
  SessionVersionConflictError,
} from "./types.js";
import type {
  AuditInput,
  BillingEventInput,
  CreatorContext,
  MagicTokenRecord,
  MediaAssetRecord,
  MediaScanStatus,
  OperationalFeaturesRecord,
  OperationalFeaturesUpdate,
  ParticipantRecord,
  Plan,
  QuizRecord,
  QuizVersionRecord,
  Repository,
  StoredSession,
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

export class MemoryRepository implements Repository {
  readonly magicTokens = new Map<string, MagicTokenRecord>();
  readonly creatorSessions = new Map<
    string,
    { userId: string; expiresAt: Date; revoked: boolean }
  >();
  readonly users = new Map<string, UserRecord>();
  readonly quizzes = new Map<string, QuizRecord>();
  readonly versions = new Map<string, QuizVersionRecord>();
  readonly sessions = new Map<string, StoredSession>();
  readonly participants = new Map<string, ParticipantRecord>();
  readonly mediaAssets = new Map<string, MediaAssetRecord>();
  readonly answers = new Map<string, EngineAnswer>();
  readonly reports = new Map<string, Report>();
  readonly expiredLiveSessions = new Set<string>();
  readonly plans = new Map<string, Plan>();
  readonly brandThemes = new Map<string, BrandTheme>();
  readonly billingProfiles = new Map<
    string,
    { status: string; customerId: string | null; subscriptionId: string | null }
  >();
  readonly billingEvents = new Set<string>();
  readonly billingEventCreatedAt = new Map<string, Date>();
  readonly audits: AuditInput[] = [];
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
      workspaceId: null,
      actorId: null,
      action: "operations.features.update",
      targetType: "operational_features",
      targetId: "global",
      requestId,
      metadata: { before, after: structuredClone(this.operationalFeatures) },
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
  }) {
    this.creatorSessions.set(input.tokenHash, {
      userId: input.userId,
      expiresAt: input.expiresAt,
      revoked: false,
    });
  }

  async getCreatorBySession(tokenHash: string, now: Date) {
    const session = this.creatorSessions.get(tokenHash);
    if (!session || session.revoked || session.expiresAt <= now) return null;
    const user = this.users.get(session.userId);
    return user && !user.deletedAt ? this.contextFor(user) : null;
  }

  async revokeCreatorSession(tokenHash: string) {
    const session = this.creatorSessions.get(tokenHash);
    if (session) session.revoked = true;
  }

  private contextFor(user: UserRecord): CreatorContext {
    return { ...user, plan: this.plans.get(user.workspaceId) ?? "free" };
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

  async createQuiz(input: QuizRecord) {
    this.quizzes.set(input.id, structuredClone(input));
    return structuredClone(input);
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
      if (prior) this.reports.delete(prior[0]);
      this.reports.set(storedReport.id, storedReport);
    }
  }

  async deleteSession(workspaceId: string, sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session || session.workspaceId !== workspaceId) return false;
    this.deleteSessionTree(sessionId);
    return true;
  }

  private deleteSessionTree(sessionId: string) {
    this.sessions.delete(sessionId);
    this.expiredLiveSessions.delete(sessionId);
    for (const [key, participant] of this.participants) {
      if (participant.sessionId === sessionId) this.participants.delete(key);
    }
    for (const key of this.answers.keys()) {
      if (key.startsWith(`${sessionId}:`)) this.answers.delete(key);
    }
    for (const [id, report] of this.reports) {
      if (report.sessionId === sessionId) this.reports.delete(id);
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
    this.audits.push(structuredClone(input));
  }

  async exportAccount(userId: string) {
    const user = this.users.get(userId);
    if (!user || user.deletedAt) return {};
    const workspaceId = user.workspaceId;
    const sessions = [...this.sessions.values()].filter(
      (session) => session.workspaceId === workspaceId,
    );
    const sessionIds = new Set(sessions.map((session) => session.id));
    const participants = [...this.participants.values()].filter((participant) =>
      sessionIds.has(participant.sessionId),
    );
    return {
      profile: { id: user.userId, email: user.email, segment: user.segment },
      workspaces: [
        {
          id: workspaceId,
          segment: user.segment,
          role: user.role,
          brandTheme: await this.getBrandTheme(workspaceId),
        },
      ],
      quizzes: await this.listQuizzes(workspaceId, true),
      quizVersions: [...this.versions.values()].filter(
        (version) => version.workspaceId === workspaceId,
      ),
      mediaAssets: await this.listMediaAssets(workspaceId),
      sessions: sessions.map(({ hostTokenHash: _hostTokenHash, ...session }) => session),
      participants: participants.map(({ tokenHash: _tokenHash, ...participant }) => participant),
      answers: [...this.answers.entries()]
        .filter(([key]) => sessionIds.has(key.split(":", 1)[0]!))
        .map(([, answer]) => structuredClone(answer)),
      reports: [...this.reports.values()].filter((report) => sessionIds.has(report.sessionId)),
      billing: await this.getBillingProfile(workspaceId),
      consentRecords: this.consents.filter((record) => record.userId === userId),
      auditEvents: this.audits.filter((audit) => audit.workspaceId === workspaceId),
    };
  }

  async deleteAccount(userId: string) {
    const user = this.users.get(userId);
    if (!user) return;
    const originalEmail = user.email;
    const workspaceId = user.workspaceId;
    user.deletedAt = new Date();
    user.email = `deleted-${userId.slice(0, 8)}@invalid.local`;
    for (const [tokenHash, session] of this.creatorSessions) {
      if (session.userId === userId) this.creatorSessions.delete(tokenHash);
    }
    for (const [tokenHash, token] of this.magicTokens) {
      if (token.email === originalEmail) this.magicTokens.delete(tokenHash);
    }
    for (const [id, quiz] of this.quizzes) {
      if (quiz.workspaceId === workspaceId) this.quizzes.delete(id);
    }
    for (const [id, version] of this.versions) {
      if (version.workspaceId === workspaceId) this.versions.delete(id);
    }
    const deletedSessionIds = new Set<string>();
    for (const [id, session] of this.sessions) {
      if (session.workspaceId === workspaceId) {
        deletedSessionIds.add(id);
        this.sessions.delete(id);
        this.expiredLiveSessions.delete(id);
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
      if (asset.workspaceId === workspaceId) this.mediaAssets.delete(id);
    }
    this.plans.delete(workspaceId);
    this.brandThemes.delete(workspaceId);
    this.billingProfiles.delete(workspaceId);
    this.billingEventCreatedAt.delete(workspaceId);
    for (let index = this.consents.length - 1; index >= 0; index -= 1) {
      if (this.consents[index]?.userId === userId) this.consents.splice(index, 1);
    }
    for (const audit of this.audits) {
      if (audit.workspaceId === workspaceId) {
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

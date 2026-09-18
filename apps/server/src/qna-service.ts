import { randomUUID } from "node:crypto";
import type { QnaPage, QnaQuestion, QnaReply, QnaSettings } from "@openround/contracts";
import type {
  ParticipantRecord,
  QnaQuestionRecord,
  QnaReplyRecord,
  QnaSettingsRecord,
  Repository,
  SessionStaffCredentialRecord,
  StoredSession,
} from "@openround/db";
import { cleanPlainText, hashToken, safeHashEqual } from "./security.js";
import type { SessionService } from "./session-service.js";
import type { InteractionService } from "./interaction-service.js";

type QnaQuestionStatus = QnaQuestionRecord["status"];
type QnaReplyStatus = QnaReplyRecord["status"];

type ParticipantActor = {
  kind: "participant";
  participant: ParticipantRecord;
  session: StoredSession;
};

type StaffActor = {
  kind: "staff";
  rootHost: boolean;
  credential: SessionStaffCredentialRecord | null;
  session: StoredSession;
};

type QnaActor = ParticipantActor | StaffActor;

export class QnaError extends Error {
  constructor(
    public readonly code:
      | "QNA_DISABLED"
      | "MODERATION_REQUIRED"
      | "QNA_RATE_LIMITED"
      | "UNAUTHORIZED"
      | "NOT_FOUND"
      | "CONFLICT",
    message: string,
  ) {
    super(message);
  }
}

function cursorFor(question: QnaQuestionRecord) {
  return Buffer.from(JSON.stringify([question.createdAt.toISOString(), question.id])).toString(
    "base64url",
  );
}

function decodeCursor(cursor: string) {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== "string" ||
      typeof parsed[1] !== "string"
    ) {
      throw new Error("invalid cursor");
    }
    const createdAt = new Date(parsed[0]);
    if (Number.isNaN(createdAt.getTime())) throw new Error("invalid cursor date");
    return { createdAt, id: parsed[1] };
  } catch {
    throw new QnaError("CONFLICT", "The Q&A pagination cursor is invalid");
  }
}

function publicQuestionStatus(status: QnaQuestionStatus) {
  return status === "published" || status === "answered";
}

export class QnaService {
  private readonly rateLimits = new Map<string, { startedAt: number; count: number }>();

  constructor(
    private readonly repository: Repository,
    private readonly sessions: SessionService,
    private readonly interactions: InteractionService,
  ) {}

  private async publishRealtime(
    session: StoredSession,
    type: `qna.${string}`,
    payload: Record<string, unknown>,
  ) {
    await this.interactions.publishCompatibilityEvent(
      session,
      type,
      payload,
      `qna-compatibility:${randomUUID()}`,
    );
    await this.sessions.publishAuxiliary({ sessionId: session.id, type, payload });
  }

  private consumeRateLimit(key: string, maximum: number) {
    const now = Date.now();
    const bucket = this.rateLimits.get(key);
    if (!bucket || now - bucket.startedAt >= 60_000) {
      this.rateLimits.set(key, { startedAt: now, count: 1 });
      return;
    }
    bucket.count += 1;
    if (bucket.count > maximum) {
      throw new QnaError("QNA_RATE_LIMITED", "Too many Q&A actions; wait before trying again");
    }
  }

  private async authenticate(sessionId: string, token: string): Promise<QnaActor> {
    const session = await this.repository.getSessionById(sessionId);
    if (!session || session.expiresAt <= new Date()) {
      throw new QnaError("NOT_FOUND", "Live round not found");
    }
    const tokenHash = hashToken(token);
    const participant = await this.repository.getParticipantByToken(tokenHash);
    if (participant?.sessionId === sessionId) {
      const runtimeParticipant = session.state.participants[participant.id];
      if (!runtimeParticipant || runtimeParticipant.kicked || participant.status === "kicked") {
        throw new QnaError("UNAUTHORIZED", "Participant access has been revoked");
      }
      return { kind: "participant", participant, session };
    }
    if (safeHashEqual(session.hostTokenHash, tokenHash)) {
      return { kind: "staff", rootHost: true, credential: null, session };
    }
    const credential = await this.repository.getSessionStaffByToken(tokenHash, new Date());
    if (credential?.sessionId !== sessionId) {
      throw new QnaError("UNAUTHORIZED", "Session credential is invalid or expired");
    }
    return { kind: "staff", rootHost: false, credential, session };
  }

  private canModerate(actor: QnaActor): actor is StaffActor {
    return actor.kind === "staff" && (actor.rootHost || actor.credential?.role === "cohost");
  }

  private async ensureOpen(session: StoredSession) {
    const [current, interactionSettings] = await Promise.all([
      this.repository.getSessionById(session.id),
      this.repository.getInteractionSettings(session.workspaceId, session.id),
    ]);
    if (!current || current.workspaceId !== session.workspaceId) {
      throw new QnaError("NOT_FOUND", "Live round not found");
    }
    if (current.state.phase === "finished" || interactionSettings?.closedAt) {
      throw new QnaError("QNA_DISABLED", "Q&A is closed because this live round has finished");
    }
  }

  private async settingsFor(session: StoredSession): Promise<QnaSettingsRecord> {
    const existing = await this.repository.getQnaSettings(session.workspaceId, session.id);
    if (existing) return existing;
    const segment = await this.repository.getWorkspaceSegment(session.workspaceId);
    return this.repository.saveQnaSettings({
      workspaceId: session.workspaceId,
      sessionId: session.id,
      enabled: true,
      displayMode: segment === "education" ? "anonymous_public" : "alias_public",
      moderationMode: segment === "education" ? "pre" : "post",
      participantReplies: segment === "workplace",
      updatedAt: new Date(),
    });
  }

  private async repliesFor(
    question: QnaQuestionRecord,
    actor: QnaActor,
    settings: QnaSettingsRecord,
  ): Promise<QnaReply[]> {
    const replies = await this.repository.listQnaReplies(question.workspaceId, question.id);
    return replies
      .filter((reply) => {
        if (this.canModerate(actor)) return true;
        if (reply.status === "published") return true;
        return actor.kind === "participant" && reply.participantId === actor.participant.id;
      })
      .map((reply) => this.replyView(reply, actor, settings));
  }

  private replyView(reply: QnaReplyRecord, actor: QnaActor, settings: QnaSettingsRecord): QnaReply {
    const mine =
      actor.kind === "participant"
        ? reply.participantId === actor.participant.id
        : (actor.rootHost && reply.actorId === actor.session.hostId) ||
          Boolean(actor.credential && reply.staffCredentialId === actor.credential.id);
    const staffReply = Boolean(reply.actorId || reply.staffCredentialId);
    const displayName = staffReply
      ? reply.publicAlias
      : mine
        ? "You"
        : settings.displayMode === "anonymous_public"
          ? "Anonymous"
          : reply.publicAlias;
    return {
      id: reply.id,
      questionId: reply.questionId,
      body: reply.body,
      status: reply.status,
      author: { displayName, kind: staffReply ? "staff" : "participant", mine },
      createdAt: reply.createdAt.toISOString(),
    };
  }

  private async questionView(
    question: QnaQuestionRecord,
    actor: QnaActor,
    settings: QnaSettingsRecord,
  ): Promise<QnaQuestion> {
    const mine = actor.kind === "participant" && question.participantId === actor.participant.id;
    return {
      id: question.id,
      body: question.body,
      status: question.status,
      label: question.label,
      author: {
        displayName: this.canModerate(actor)
          ? question.publicAlias
          : mine
            ? "You"
            : settings.displayMode === "anonymous_public"
              ? "Anonymous"
              : question.publicAlias,
        mine,
      },
      voteCount: question.voteCount,
      votedByMe: question.votedByViewer,
      replies: await this.repliesFor(question, actor, settings),
      createdAt: question.createdAt.toISOString(),
      ...(this.canModerate(actor) ? { moderationParticipantId: question.participantId } : {}),
    };
  }

  async list(
    sessionId: string,
    token: string,
    options: { cursor?: string; limit: number },
  ): Promise<QnaPage> {
    const actor = await this.authenticate(sessionId, token);
    const settings = await this.settingsFor(actor.session);
    if (!settings.enabled) throw new QnaError("QNA_DISABLED", "Q&A is disabled for this round");
    const questions = await this.repository.listQnaQuestions(
      actor.session.workspaceId,
      sessionId,
      actor.kind === "participant" ? actor.participant.id : undefined,
    );
    const visible = questions.filter((question) => {
      if (this.canModerate(actor)) return true;
      if (publicQuestionStatus(question.status)) return true;
      return actor.kind === "participant" && question.participantId === actor.participant.id;
    });
    const cursor = options.cursor ? decodeCursor(options.cursor) : null;
    const afterCursor = cursor
      ? visible.filter(
          (question) =>
            question.createdAt < cursor.createdAt ||
            (question.createdAt.getTime() === cursor.createdAt.getTime() &&
              question.id.localeCompare(cursor.id) < 0),
        )
      : visible;
    const page = afterCursor.slice(0, options.limit);
    return {
      questions: await Promise.all(
        page.map((question) => this.questionView(question, actor, settings)),
      ),
      nextCursor:
        afterCursor.length > options.limit && page.length > 0 ? cursorFor(page.at(-1)!) : null,
      settings: {
        enabled: settings.enabled,
        displayMode: settings.displayMode,
        moderationMode: settings.moderationMode,
        participantReplies: settings.participantReplies,
      },
    };
  }

  async createQuestion(sessionId: string, token: string, body: string) {
    const actor = await this.authenticate(sessionId, token);
    if (actor.kind !== "participant") {
      throw new QnaError("UNAUTHORIZED", "Only participants can submit audience questions");
    }
    await this.ensureOpen(actor.session);
    const settings = await this.settingsFor(actor.session);
    if (!settings.enabled) throw new QnaError("QNA_DISABLED", "Q&A is disabled for this round");
    if (
      await this.repository.isQnaBanned(actor.session.workspaceId, sessionId, actor.participant.id)
    ) {
      throw new QnaError("UNAUTHORIZED", "Q&A access has been revoked");
    }
    this.consumeRateLimit(`question:${hashToken(token)}`, 5);
    const clean = cleanPlainText(body.normalize("NFKC"), 1_000);
    if (!clean) throw new QnaError("CONFLICT", "Enter a question before submitting");
    const now = new Date();
    const created = await this.repository.createQnaQuestion({
      id: randomUUID(),
      workspaceId: actor.session.workspaceId,
      sessionId,
      participantId: actor.participant.id,
      body: clean,
      publicAlias: actor.participant.nickname,
      status: settings.moderationMode === "pre" ? "pending" : "published",
      label: null,
      voteCount: 0,
      votedByViewer: false,
      createdAt: now,
      updatedAt: now,
    });
    await this.publishRealtime(actor.session, "qna.question.created", {
      questionId: created.id,
    });
    return this.questionView(created, actor, settings);
  }

  async createReply(sessionId: string, questionId: string, token: string, body: string) {
    const actor = await this.authenticate(sessionId, token);
    await this.ensureOpen(actor.session);
    const settings = await this.settingsFor(actor.session);
    if (!settings.enabled) throw new QnaError("QNA_DISABLED", "Q&A is disabled for this round");
    const question = await this.repository.getQnaQuestion(actor.session.workspaceId, questionId);
    if (!question || question.sessionId !== sessionId) {
      throw new QnaError("NOT_FOUND", "Q&A question not found");
    }
    const moderator = this.canModerate(actor);
    if (actor.kind === "staff" && !moderator) {
      throw new QnaError("UNAUTHORIZED", "Presenter credentials are read-only");
    }
    if (actor.kind === "participant") {
      if (!settings.participantReplies) {
        throw new QnaError("QNA_DISABLED", "Participant replies are disabled");
      }
      if (!publicQuestionStatus(question.status)) {
        throw new QnaError("MODERATION_REQUIRED", "This question is awaiting moderation");
      }
      if (
        await this.repository.isQnaBanned(
          actor.session.workspaceId,
          sessionId,
          actor.participant.id,
        )
      ) {
        throw new QnaError("UNAUTHORIZED", "Q&A access has been revoked");
      }
    }
    this.consumeRateLimit(
      `reply:${actor.kind === "participant" ? actor.participant.id : hashToken(token)}`,
      10,
    );
    const clean = cleanPlainText(body.normalize("NFKC"), 1_000);
    if (!clean) throw new QnaError("CONFLICT", "Enter a reply before submitting");
    const now = new Date();
    const reply = await this.repository.createQnaReply({
      id: randomUUID(),
      workspaceId: actor.session.workspaceId,
      sessionId,
      questionId,
      participantId: actor.kind === "participant" ? actor.participant.id : null,
      actorId: actor.kind === "staff" && actor.rootHost ? actor.session.hostId : null,
      staffCredentialId:
        actor.kind === "staff" && !actor.rootHost ? (actor.credential?.id ?? null) : null,
      body: clean,
      publicAlias:
        actor.kind === "participant"
          ? actor.participant.nickname
          : actor.credential?.label || "Facilitator",
      status:
        actor.kind === "participant" && settings.moderationMode === "pre" ? "pending" : "published",
      createdAt: now,
      updatedAt: now,
    });
    if (actor.kind === "staff") {
      await this.repository.updateQnaQuestion(actor.session.workspaceId, questionId, {
        status: "answered",
        label: question.label,
      });
      await this.repository.recordAudit({
        workspaceId: actor.session.workspaceId,
        actorId: actor.rootHost ? actor.session.hostId : null,
        action: "qna.reply.create",
        targetType: "qna_reply",
        targetId: reply.id,
        requestId: randomUUID(),
        metadata: actor.credential ? { staffCredentialId: actor.credential.id } : {},
      });
    }
    await this.publishRealtime(actor.session, "qna.reply.created", {
      questionId,
      replyId: reply.id,
    });
    return this.replyView(reply, actor, settings);
  }

  async setVote(sessionId: string, questionId: string, token: string, voted: boolean) {
    const actor = await this.authenticate(sessionId, token);
    if (actor.kind !== "participant") {
      throw new QnaError("UNAUTHORIZED", "Only participants can vote on questions");
    }
    await this.ensureOpen(actor.session);
    const settings = await this.settingsFor(actor.session);
    if (!settings.enabled) throw new QnaError("QNA_DISABLED", "Q&A is disabled for this round");
    const question = await this.repository.getQnaQuestion(actor.session.workspaceId, questionId);
    if (!question || question.sessionId !== sessionId) {
      throw new QnaError("NOT_FOUND", "Q&A question not found");
    }
    if (!publicQuestionStatus(question.status)) {
      throw new QnaError("MODERATION_REQUIRED", "This question is awaiting moderation");
    }
    if (
      await this.repository.isQnaBanned(actor.session.workspaceId, sessionId, actor.participant.id)
    ) {
      throw new QnaError("UNAUTHORIZED", "Q&A access has been revoked");
    }
    this.consumeRateLimit(`vote:${actor.participant.id}`, 30);
    const voteCount = await this.repository.setQnaVote(
      actor.session.workspaceId,
      sessionId,
      questionId,
      actor.participant.id,
      voted,
    );
    await this.publishRealtime(actor.session, "qna.vote.updated", { questionId, voteCount });
    return { questionId, voteCount, voted };
  }

  async updateSettings(
    sessionId: string,
    token: string,
    update: Partial<QnaSettings>,
    requestId: string,
  ) {
    const actor = await this.authenticate(sessionId, token);
    if (!this.canModerate(actor)) {
      throw new QnaError("UNAUTHORIZED", "Only a host or cohost can change Q&A settings");
    }
    await this.ensureOpen(actor.session);
    const current = await this.settingsFor(actor.session);
    const saved = await this.repository.saveQnaSettings({
      ...current,
      ...update,
      updatedAt: new Date(),
    });
    await this.repository.recordAudit({
      workspaceId: actor.session.workspaceId,
      actorId: actor.rootHost ? actor.session.hostId : null,
      action: "qna.settings.update",
      targetType: "game_session",
      targetId: sessionId,
      requestId,
      metadata: actor.credential ? { staffCredentialId: actor.credential.id, update } : { update },
    });
    await this.publishRealtime(actor.session, "qna.settings.updated", {});
    return saved;
  }

  async moderateQuestion(
    sessionId: string,
    questionId: string,
    token: string,
    update: { status: QnaQuestionStatus; label?: string | null; banParticipant: boolean },
    requestId: string,
  ) {
    const actor = await this.authenticate(sessionId, token);
    if (!this.canModerate(actor)) {
      throw new QnaError("UNAUTHORIZED", "Only a host or cohost can moderate Q&A");
    }
    await this.ensureOpen(actor.session);
    const current = await this.repository.getQnaQuestion(actor.session.workspaceId, questionId);
    if (!current || current.sessionId !== sessionId) {
      throw new QnaError("NOT_FOUND", "Q&A question not found");
    }
    const updated = await this.repository.updateQnaQuestion(actor.session.workspaceId, questionId, {
      status: update.status,
      label: update.label === undefined ? current.label : update.label,
    });
    if (update.banParticipant) {
      await this.repository.banQnaParticipant(
        actor.session.workspaceId,
        sessionId,
        current.participantId,
        actor.rootHost ? actor.session.hostId : null,
      );
    }
    await this.repository.recordAudit({
      workspaceId: actor.session.workspaceId,
      actorId: actor.rootHost ? actor.session.hostId : null,
      action: "qna.question.moderate",
      targetType: "qna_question",
      targetId: questionId,
      requestId,
      metadata: {
        status: update.status,
        banParticipant: update.banParticipant,
        ...(actor.credential ? { staffCredentialId: actor.credential.id } : {}),
      },
    });
    await this.publishRealtime(actor.session, "qna.question.updated", { questionId });
    if (!updated) throw new QnaError("NOT_FOUND", "Q&A question not found");
    return this.questionView(updated, actor, await this.settingsFor(actor.session));
  }

  async moderateReply(
    sessionId: string,
    replyId: string,
    token: string,
    status: QnaReplyStatus,
    requestId: string,
  ) {
    const actor = await this.authenticate(sessionId, token);
    if (!this.canModerate(actor)) {
      throw new QnaError("UNAUTHORIZED", "Only a host or cohost can moderate Q&A");
    }
    await this.ensureOpen(actor.session);
    const current = await this.repository.getQnaReply(actor.session.workspaceId, replyId);
    if (!current || current.sessionId !== sessionId) {
      throw new QnaError("NOT_FOUND", "Q&A reply not found");
    }
    const updated = await this.repository.updateQnaReply(
      actor.session.workspaceId,
      replyId,
      status,
    );
    if (!updated) throw new QnaError("NOT_FOUND", "Q&A reply not found");
    await this.repository.recordAudit({
      workspaceId: actor.session.workspaceId,
      actorId: actor.rootHost ? actor.session.hostId : null,
      action: "qna.reply.moderate",
      targetType: "qna_reply",
      targetId: replyId,
      requestId,
      metadata: {
        status,
        ...(actor.credential ? { staffCredentialId: actor.credential.id } : {}),
      },
    });
    await this.publishRealtime(actor.session, "qna.reply.updated", {
      questionId: updated.questionId,
      replyId,
    });
    return this.replyView(updated, actor, await this.settingsFor(actor.session));
  }
}

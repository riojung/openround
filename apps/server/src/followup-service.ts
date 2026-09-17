import { randomUUID } from "node:crypto";
import {
  FollowupSchema,
  FollowupSnapshotSchema,
  QuizContentSchema,
  canonicalizeResponse,
  questionConfidence,
  questionDelivery,
  type CreateFollowup,
  type FollowupAnswerSubmit,
  type Followup,
  type FollowupSnapshot,
  type QuestionDraft,
  type TimeMultiplier,
} from "@openround/contracts";
import {
  FollowupVersionConflictError,
  type CreatorContext,
  type FollowupAccessRecord,
  type FollowupAnswerRecord,
  type FollowupAttemptRecord,
  type FollowupRecord,
  type Repository,
} from "@openround/db";
import {
  EngineError,
  correctResponse,
  evaluateResponse,
  publicQuestion,
} from "@openround/game-engine";
import { hashToken, opaqueToken } from "./security.js";

export class FollowupError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "UNAUTHORIZED"
      | "CONFLICT"
      | "ANSWER_INVALID"
      | "ANSWER_LATE"
      | "STALE_VERSION"
      | "FOLLOWUP_NOT_OPEN"
      | "FOLLOWUP_CLOSED"
      | "FOLLOWUP_COMPLETED",
    message: string,
  ) {
    super(message);
    this.name = "FollowupError";
  }
}

function view(record: FollowupRecord): Followup {
  return FollowupSchema.parse({
    id: record.id,
    sourceSessionId: record.sourceSessionId,
    sourceReportId: record.sourceReportId,
    title: record.title,
    conceptKeys: record.conceptKeys,
    checkpointCount: record.content.questions.length,
    timeMode: record.timeMode,
    opensAt: record.opensAt.toISOString(),
    closesAt: record.closesAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    closedAt: record.closedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  });
}

function timedDeadline(question: QuestionDraft, openedAt: Date, multiplier: TimeMultiplier) {
  return new Date(openedAt.getTime() + question.timeLimitSeconds * multiplier * 1_000);
}

function selectedFeedback(question: QuestionDraft, answer: FollowupAnswerRecord | null) {
  if (
    !answer ||
    (question.type !== "single_select" &&
      question.type !== "true_false" &&
      question.type !== "multi_select")
  ) {
    return null;
  }
  if (answer.response.kind !== "choice") return null;
  const feedback = answer.response.choiceIds
    .map((id) => question.choices.find((choice) => choice.id === id)?.feedback?.trim())
    .filter((value): value is string => Boolean(value));
  return feedback.length ? feedback.join(" ") : null;
}

function followupContent(source: FollowupRecord["content"], title: string, conceptKeys: string[]) {
  const selected = new Set(conceptKeys);
  const byId = new Map(source.questions.map((question) => [question.id, question]));
  const picked = new Map<string, QuestionDraft>();
  const covered = new Set<string>();
  for (const question of source.questions) {
    if (questionDelivery(question) !== "main") continue;
    const matchingConcepts = (question.conceptKeys ?? []).filter((key) => selected.has(key));
    if (!matchingConcepts.length) continue;
    const linked = question.linkedRecheckQuestionId
      ? byId.get(question.linkedRecheckQuestionId)
      : undefined;
    const candidate = linked && questionDelivery(linked) === "recheck" ? linked : question;
    picked.set(candidate.id, {
      ...structuredClone(candidate),
      delivery: "main",
      conceptKeys: [...new Set([...(candidate.conceptKeys ?? []), ...matchingConcepts])],
      linkedRecheckQuestionId: null,
    });
    matchingConcepts.forEach((key) => covered.add(key));
  }
  for (const question of source.questions) {
    const uncovered = (question.conceptKeys ?? []).filter(
      (key) => selected.has(key) && !covered.has(key),
    );
    if (uncovered.length) {
      picked.set(question.id, {
        ...structuredClone(question),
        delivery: "main",
        linkedRecheckQuestionId: null,
      });
      uncovered.forEach((key) => covered.add(key));
    }
  }
  return QuizContentSchema.parse({
    title,
    description: `Self-paced follow-up for ${conceptKeys.join(", ")}`,
    questions: [...picked.values()],
  });
}

export class FollowupService {
  constructor(private readonly repository: Repository) {}

  async create(creator: CreatorContext, reportId: string, input: CreateFollowup, now = new Date()) {
    const report = await this.repository.getReport(creator.workspaceId, reportId);
    if (!report) throw new FollowupError("NOT_FOUND", "Report not found");
    if (report.status !== "ready" || report.schemaVersion !== 2) {
      throw new FollowupError("CONFLICT", "A ready evidence report is required for follow-up");
    }
    const allowedConcepts = new Set(
      report.unresolvedConcepts
        .filter((concept) => concept.unresolved > 0)
        .map((concept) => concept.conceptKey),
    );
    const conceptKeys = [...new Set(input.conceptKeys)];
    if (conceptKeys.some((key) => !allowedConcepts.has(key))) {
      throw new FollowupError(
        "ANSWER_INVALID",
        "Select only concepts identified as unresolved in this report",
      );
    }
    const session = await this.repository.getSessionById(report.sessionId);
    if (!session || session.workspaceId !== creator.workspaceId) {
      throw new FollowupError("NOT_FOUND", "Source session not found");
    }
    const opensAt = input.opensAt ? new Date(input.opensAt) : now;
    const closesAt = new Date(input.closesAt);
    const expiresAt = new Date(report.expiresAt);
    if (closesAt <= now || closesAt <= opensAt) {
      throw new FollowupError("ANSWER_INVALID", "Choose a future close time after the open time");
    }
    if (closesAt > expiresAt) {
      throw new FollowupError(
        "ANSWER_INVALID",
        "The follow-up must close before the source session retention deadline",
      );
    }

    const title = input.title ?? `Follow-up: ${session.state.quiz.title}`;
    let content: FollowupRecord["content"];
    try {
      content = followupContent(session.state.quiz, title, conceptKeys);
    } catch {
      throw new FollowupError(
        "CONFLICT",
        "No complete checkpoint is tagged with the selected unresolved concepts",
      );
    }
    const genericToken = opaqueToken();
    const followup: FollowupRecord = {
      id: randomUUID(),
      workspaceId: creator.workspaceId,
      sourceSessionId: report.sessionId,
      sourceReportId: report.id,
      title,
      content,
      conceptKeys,
      timeMode: input.timeMode,
      genericTokenHash: hashToken(genericToken),
      opensAt,
      closesAt,
      expiresAt,
      closedAt: null,
      createdBy: creator.userId,
      createdAt: now,
    };
    const participants = (await this.repository.getParticipants(report.sessionId)).filter(
      (participant) => participant.status !== "kicked",
    );
    const personal = participants.map((participant) => {
      const token = opaqueToken();
      const access: FollowupAccessRecord = {
        id: randomUUID(),
        workspaceId: creator.workspaceId,
        followupId: followup.id,
        sourceParticipantId: participant.id,
        kind: "personal",
        label: participant.nickname,
        tokenHash: hashToken(token),
        timeMultiplier: 1,
        expiresAt: closesAt,
        revokedAt: null,
        createdAt: now,
      };
      return { access, token, nickname: participant.nickname };
    });
    try {
      await this.repository.createFollowup(
        followup,
        personal.map((item) => item.access),
      );
    } catch (error) {
      if (error instanceof Error && /already exists|duplicate|unique/i.test(error.message)) {
        throw new FollowupError("CONFLICT", "This report already has a follow-up");
      }
      throw error;
    }
    return {
      followup: view(followup),
      genericToken,
      personalAccess: personal.map(({ access, token, nickname }) => ({
        id: access.id,
        kind: access.kind,
        participantId: access.sourceParticipantId,
        nickname,
        label: access.label,
        timeMultiplier: access.timeMultiplier,
        expiresAt: access.expiresAt.toISOString(),
        revokedAt: null,
        token,
      })),
    };
  }

  async getForReport(workspaceId: string, reportId: string) {
    const followup = await this.repository.getFollowupByReport(workspaceId, reportId);
    return followup ? view(followup) : null;
  }

  async getForCreator(workspaceId: string, followupId: string) {
    const followup = await this.repository.getFollowup(workspaceId, followupId);
    if (!followup) throw new FollowupError("NOT_FOUND", "Follow-up not found");
    const access = await this.repository.listFollowupAccess(workspaceId, followupId);
    const participants = await this.repository.getParticipants(followup.sourceSessionId);
    const nicknames = new Map(
      participants.map((participant) => [participant.id, participant.nickname]),
    );
    return {
      followup: view(followup),
      access: access.map((item) => ({
        id: item.id,
        kind: item.kind,
        participantId: item.sourceParticipantId,
        nickname: item.sourceParticipantId
          ? (nicknames.get(item.sourceParticipantId) ?? null)
          : null,
        label: item.label,
        timeMultiplier: item.timeMultiplier,
        expiresAt: item.expiresAt.toISOString(),
        revokedAt: item.revokedAt?.toISOString() ?? null,
      })),
    };
  }

  async createAccommodation(
    creator: CreatorContext,
    followupId: string,
    input: { label: string; timeMultiplier: 1.5 | 2 },
    now = new Date(),
  ) {
    const followup = await this.repository.getFollowup(creator.workspaceId, followupId);
    if (!followup) throw new FollowupError("NOT_FOUND", "Follow-up not found");
    this.assertAvailable(followup, now, false);
    const token = opaqueToken();
    const access: FollowupAccessRecord = {
      id: randomUUID(),
      workspaceId: creator.workspaceId,
      followupId,
      sourceParticipantId: null,
      kind: "accommodation",
      label: input.label,
      tokenHash: hashToken(token),
      timeMultiplier: input.timeMultiplier,
      expiresAt: followup.closesAt,
      revokedAt: null,
      createdAt: now,
    };
    await this.repository.createFollowupAccess(access);
    return {
      access: {
        id: access.id,
        kind: access.kind,
        participantId: null,
        nickname: null,
        label: access.label,
        timeMultiplier: access.timeMultiplier,
        expiresAt: access.expiresAt.toISOString(),
        revokedAt: null,
        token,
      },
    };
  }

  async revokeAccess(workspaceId: string, followupId: string, accessId: string, now = new Date()) {
    const revoked = await this.repository.revokeFollowupAccess(
      workspaceId,
      followupId,
      accessId,
      now,
    );
    if (!revoked) throw new FollowupError("NOT_FOUND", "Follow-up access pass not found");
  }

  async close(workspaceId: string, followupId: string, now = new Date()) {
    const closed = await this.repository.closeFollowup(workspaceId, followupId, now);
    if (!closed) throw new FollowupError("NOT_FOUND", "Follow-up not found");
  }

  async start(
    followupId: string,
    accessToken: string,
    requestedAttemptToken: string | undefined,
    now = new Date(),
  ) {
    const access = await this.repository.getFollowupAccessByToken(
      followupId,
      hashToken(accessToken),
      now,
    );
    const followup = access
      ? await this.repository.getFollowup(access.workspaceId, followupId)
      : await this.repository.getFollowupByGenericToken(followupId, hashToken(accessToken), now);
    if (!followup)
      throw new FollowupError("UNAUTHORIZED", "This follow-up link is invalid or expired");
    this.assertAvailable(followup, now, true);
    const attemptToken = access ? accessToken : (requestedAttemptToken ?? opaqueToken());
    const question = followup.content.questions[0]!;
    const attempt: FollowupAttemptRecord = {
      id: randomUUID(),
      workspaceId: followup.workspaceId,
      followupId,
      accessTokenId: access?.id ?? null,
      sourceParticipantId: access?.sourceParticipantId ?? null,
      attemptTokenHash: hashToken(attemptToken),
      status: "in_progress",
      phase: "question_open",
      currentIndex: 0,
      version: 0,
      timeMultiplier: access?.timeMultiplier ?? 1,
      questionOpenedAt: now,
      deadlineAt:
        followup.timeMode === "timed"
          ? timedDeadline(question, now, access?.timeMultiplier ?? 1)
          : null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const stored = await this.repository.createOrGetFollowupAttempt(attempt);
    return {
      attemptToken,
      snapshot: await this.snapshot(followup, stored),
    };
  }

  async resume(followupId: string, attemptToken: string, now = new Date()) {
    const { followup, attempt } = await this.authorizeAttempt(followupId, attemptToken, now);
    const timed = await this.revealTimedOutAttempt(attempt, now);
    return this.snapshot(followup, timed.attempt);
  }

  async authorizeMedia(
    followupId: string,
    attemptToken: string,
    mediaId: string,
    now = new Date(),
  ) {
    const { followup, attempt } = await this.authorizeAttempt(followupId, attemptToken, now);
    const question =
      attempt.status === "in_progress" ? followup.content.questions[attempt.currentIndex] : null;
    if (!question || question.mediaId !== mediaId) {
      throw new FollowupError("NOT_FOUND", "Media is not part of the current checkpoint");
    }
    return followup.workspaceId;
  }

  async answer(
    followupId: string,
    attemptToken: string,
    input: FollowupAnswerSubmit,
    now = new Date(),
  ) {
    const authorized = await this.authorizeAttempt(followupId, attemptToken, now);
    const { followup } = authorized;
    this.assertAvailable(followup, now, true);
    const timed = await this.revealTimedOutAttempt(authorized.attempt, now);
    const attempt = timed.attempt;
    if (attempt.status === "completed") {
      throw new FollowupError("FOLLOWUP_COMPLETED", "This follow-up attempt is complete");
    }
    const question = followup.content.questions[attempt.currentIndex];
    if (!question) throw new FollowupError("CONFLICT", "Current checkpoint was not found");
    if (timed.expired) return this.snapshot(followup, attempt);
    const existing = await this.repository.getFollowupAnswer(attempt.id, question.id);
    if (existing?.idempotencyKey === input.idempotencyKey) return this.snapshot(followup, attempt);
    if (existing || attempt.phase !== "question_open") {
      throw new FollowupError("CONFLICT", "This checkpoint was already answered");
    }
    const confidenceMode = questionConfidence(question);
    if (confidenceMode === "required" && input.confidence === undefined) {
      throw new FollowupError("ANSWER_INVALID", "Choose a confidence level before submitting");
    }
    let evaluated: ReturnType<typeof evaluateResponse>;
    try {
      evaluated = evaluateResponse(question, canonicalizeResponse(input.response));
    } catch (error) {
      if (error instanceof EngineError) throw new FollowupError("ANSWER_INVALID", error.message);
      throw error;
    }
    const answer: FollowupAnswerRecord = {
      id: randomUUID(),
      workspaceId: followup.workspaceId,
      followupId,
      attemptId: attempt.id,
      checkpointId: question.id,
      response: evaluated.response,
      confidence: confidenceMode === "off" ? null : (input.confidence ?? null),
      correct: question.type === "poll" || question.type === "rating" ? null : evaluated.correct,
      idempotencyKey: input.idempotencyKey,
      acceptedAt: now,
    };
    const nextAttempt: FollowupAttemptRecord = {
      ...attempt,
      phase: "answer_reveal",
      version: attempt.version + 1,
      updatedAt: now,
    };
    try {
      await this.repository.commitFollowupAnswer(nextAttempt, answer, attempt.version);
    } catch (error) {
      if (error instanceof FollowupVersionConflictError) {
        throw new FollowupError("STALE_VERSION", "The follow-up changed; refresh and try again");
      }
      throw error;
    }
    return this.snapshot(followup, nextAttempt, answer);
  }

  async advance(followupId: string, attemptToken: string, now = new Date()) {
    const authorized = await this.authorizeAttempt(followupId, attemptToken, now);
    const { followup } = authorized;
    this.assertAvailable(followup, now, true);
    const timed = await this.revealTimedOutAttempt(authorized.attempt, now);
    const attempt = timed.attempt;
    if (attempt.status === "completed") return this.snapshot(followup, attempt);
    if (timed.expired) return this.snapshot(followup, attempt);
    if (attempt.phase !== "answer_reveal") {
      throw new FollowupError("CONFLICT", "Answer the current checkpoint before continuing");
    }
    const last = attempt.currentIndex >= followup.content.questions.length - 1;
    const nextIndex = last ? attempt.currentIndex : attempt.currentIndex + 1;
    const nextQuestion = followup.content.questions[nextIndex]!;
    const nextAttempt: FollowupAttemptRecord = {
      ...attempt,
      status: last ? "completed" : "in_progress",
      phase: last ? "completed" : "question_open",
      currentIndex: nextIndex,
      version: attempt.version + 1,
      questionOpenedAt: now,
      deadlineAt:
        !last && followup.timeMode === "timed"
          ? timedDeadline(nextQuestion, now, attempt.timeMultiplier)
          : null,
      completedAt: last ? now : null,
      updatedAt: now,
    };
    const saved = await this.repository.advanceFollowupAttempt(nextAttempt, attempt.version);
    if (!saved)
      throw new FollowupError("STALE_VERSION", "The follow-up changed; refresh and try again");
    return this.snapshot(followup, nextAttempt);
  }

  private async authorizeAttempt(followupId: string, token: string, now: Date) {
    const attempt = await this.repository.getFollowupAttemptByToken(
      followupId,
      hashToken(token),
      now,
    );
    if (!attempt)
      throw new FollowupError("UNAUTHORIZED", "This attempt link is invalid or revoked");
    const followup = await this.repository.getFollowup(attempt.workspaceId, followupId);
    if (!followup || followup.expiresAt <= now) {
      throw new FollowupError("UNAUTHORIZED", "This follow-up has expired");
    }
    return { followup, attempt };
  }

  private async revealTimedOutAttempt(attempt: FollowupAttemptRecord, now: Date) {
    if (
      attempt.status !== "in_progress" ||
      attempt.phase !== "question_open" ||
      !attempt.deadlineAt ||
      now <= attempt.deadlineAt
    ) {
      return { attempt, expired: false } as const;
    }
    const revealedAttempt: FollowupAttemptRecord = {
      ...attempt,
      phase: "answer_reveal",
      version: attempt.version + 1,
      updatedAt: now,
    };
    const saved = await this.repository.advanceFollowupAttempt(revealedAttempt, attempt.version);
    if (!saved) {
      throw new FollowupError("STALE_VERSION", "The follow-up changed; refresh and try again");
    }
    return { attempt: revealedAttempt, expired: true } as const;
  }

  private assertAvailable(followup: FollowupRecord, now: Date, respectOpenTime: boolean) {
    if (followup.closedAt || now >= followup.closesAt) {
      throw new FollowupError("FOLLOWUP_CLOSED", "This follow-up is closed");
    }
    if (respectOpenTime && now < followup.opensAt) {
      throw new FollowupError(
        "FOLLOWUP_NOT_OPEN",
        `This follow-up opens at ${followup.opensAt.toISOString()}`,
      );
    }
  }

  private async snapshot(
    followup: FollowupRecord,
    attempt: FollowupAttemptRecord,
    suppliedAnswer?: FollowupAnswerRecord,
  ): Promise<FollowupSnapshot> {
    if (attempt.status === "completed") {
      return FollowupSnapshotSchema.parse({
        mode: "followup",
        followupId: followup.id,
        attemptId: attempt.id,
        version: attempt.version,
        title: followup.title,
        status: attempt.status,
        phase: attempt.phase,
        questionIndex: null,
        questionCount: followup.content.questions.length,
        question: null,
        deadline: null,
        timeMode: followup.timeMode,
        timeMultiplier: attempt.timeMultiplier,
        response: null,
        confidence: null,
        correct: null,
        correctResponse: null,
        explanation: null,
        feedback: null,
        completedAt: attempt.completedAt?.toISOString() ?? null,
      });
    }
    const question = followup.content.questions[attempt.currentIndex]!;
    const answer =
      suppliedAnswer ??
      (attempt.phase === "answer_reveal"
        ? await this.repository.getFollowupAnswer(attempt.id, question.id)
        : null);
    const revealed = attempt.phase === "answer_reveal";
    return FollowupSnapshotSchema.parse({
      mode: "followup",
      followupId: followup.id,
      attemptId: attempt.id,
      version: attempt.version,
      title: followup.title,
      status: attempt.status,
      phase: attempt.phase,
      questionIndex: attempt.currentIndex,
      questionCount: followup.content.questions.length,
      question: publicQuestion(question),
      deadline: attempt.deadlineAt?.toISOString() ?? null,
      timeMode: followup.timeMode,
      timeMultiplier: attempt.timeMultiplier,
      response: answer?.response ?? null,
      confidence: answer?.confidence ?? null,
      correct: revealed ? (answer?.correct ?? null) : null,
      correctResponse: revealed ? correctResponse(question) : null,
      explanation: revealed ? question.explanation : null,
      feedback: revealed ? selectedFeedback(question, answer) : null,
      completedAt: null,
    });
  }
}

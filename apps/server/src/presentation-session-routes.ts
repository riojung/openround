import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  AdvancePresentationSessionSchema,
  CreatePresentationSessionSchema,
  JoinPresentationSessionSchema,
  SubmitPresentationSessionResponseSchema,
  type PresentationBlock,
  type PresentationSessionResponse,
  type QuestionDraft,
  questionTypeDefinition,
} from "@openround/contracts";
import {
  PresentationSessionConflictError,
  type CreatorContext,
  type PresentationRepository,
  type PresentationSessionRecord,
  type PresentationSessionRepository,
  type PresentationSessionResponseRecord,
  type Repository,
} from "@openround/db";
import type { AuthService } from "./auth.js";
import type { AppConfig } from "./config.js";
import { entitlementsFor, retentionExpiry } from "./entitlements.js";
import type { StorageService } from "./storage.js";
import { professionalFeatureUnavailable } from "./workspace-rollout.js";

const IdParamsSchema = z.object({ id: z.string().uuid() });
const SessionMediaParamsSchema = z.object({
  id: z.string().uuid(),
  mediaId: z.string().uuid(),
});
const PRESENTATION_SESSION_LIFETIME_MS = 24 * 60 * 60 * 1_000;

function apiError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  requestId: string,
) {
  return reply.code(status).send({ error: { code, message, requestId } });
}

function requireEditor(creator: CreatorContext, reply: FastifyReply, requestId: string) {
  return creator.role === "owner" || creator.role === "editor"
    ? true
    : apiError(
        reply,
        403,
        "UNAUTHORIZED",
        "Your workspace role does not allow this action",
        requestId,
      );
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function bearerToken(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
}

function liveSessionExpired(session: PresentationSessionRecord, now = new Date()) {
  return session.liveExpiresAt.getTime() <= now.getTime();
}

async function uniqueJoinCode(sessions: PresentationSessionRepository) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = String(randomInt(0, 10_000_000)).padStart(7, "0");
    if (!(await sessions.getSessionByCode(code))) return code;
  }
  throw new Error("Unable to allocate a presentation join code");
}

function currentBlock(session: PresentationSessionRecord) {
  return session.currentBlockIndex >= 0
    ? (session.content.blocks[session.currentBlockIndex] ?? null)
    : null;
}

function questionDeadline(session: PresentationSessionRecord) {
  const block = currentBlock(session);
  if (session.phase !== "question_open" || block?.kind !== "question") return null;
  return new Date(session.updatedAt.getTime() + block.question.timeLimitSeconds * 1_000);
}

function responseTiming(session: PresentationSessionRecord, submittedAt: Date) {
  const block = currentBlock(session);
  if (block?.kind !== "question") return { responseMs: 0, remainingRatio: 0 };
  const durationMs = block.question.timeLimitSeconds * 1_000;
  const responseMs = Math.max(
    0,
    Math.min(durationMs, submittedAt.getTime() - session.updatedAt.getTime()),
  );
  return { responseMs, remainingRatio: Math.max(0, 1 - responseMs / durationMs) };
}

function responseScore(question: QuestionDraft, correct: boolean | null, remainingRatio: number) {
  if (!correct || !questionTypeDefinition(question.type).scored) return 0;
  return Math.round(question.basePoints * (0.5 + remainingRatio * 0.5));
}

function rankedParticipants(
  participants: Awaited<ReturnType<PresentationSessionRepository["listParticipants"]>>,
  responses: PresentationSessionResponseRecord[],
) {
  const scores = new Map<string, number>();
  for (const response of responses) {
    scores.set(response.participantId, (scores.get(response.participantId) ?? 0) + response.score);
  }
  return participants
    .map((participant) => ({
      id: participant.id,
      nickname: participant.nickname,
      joinedAt: participant.joinedAt,
      score: scores.get(participant.id) ?? 0,
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.joinedAt.getTime() - right.joinedAt.getTime() ||
        left.nickname.localeCompare(right.nickname),
    )
    .map((participant, index) => ({ ...participant, rank: index + 1 }));
}

function participantBlock(block: PresentationBlock | null) {
  if (!block) return null;
  if (block.kind === "content") {
    return {
      id: block.id,
      kind: block.kind,
      layout: block.layout,
      title: block.title,
      body: block.body,
      mediaId: block.mediaId,
      mediaAlt: block.mediaAlt,
    };
  }
  const question = block.question;
  const base = {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    confidence: question.confidence,
    timeLimitSeconds: question.timeLimitSeconds,
    mediaId: question.mediaId,
    mediaAlt: question.mediaAlt,
  };
  if (question.type === "numeric") return { id: block.id, kind: block.kind, question: base };
  if (question.type === "rating") {
    return {
      id: block.id,
      kind: block.kind,
      question: {
        ...base,
        min: question.min,
        max: question.max,
        minLabel: question.minLabel,
        maxLabel: question.maxLabel,
      },
    };
  }
  return {
    id: block.id,
    kind: block.kind,
    question: {
      ...base,
      choices: question.choices.map(({ id, label }) => ({ id, label })),
    },
  };
}

function validateResponse(question: QuestionDraft, response: PresentationSessionResponse) {
  if (question.confidence === "required" && response.confidence == null) {
    throw new Error("Choose a confidence level before submitting");
  }
  if (question.type === "numeric") {
    const value = Number(response.numericValue);
    if (
      response.numericValue === undefined ||
      response.numericValue.trim() === "" ||
      !Number.isFinite(value)
    ) {
      throw new Error("Enter a valid numeric response");
    }
    return;
  }
  if (question.type === "rating") {
    if (
      response.ratingValue === undefined ||
      response.ratingValue < question.min ||
      response.ratingValue > question.max
    ) {
      throw new Error(`Choose a rating from ${question.min} to ${question.max}`);
    }
    return;
  }
  const selected = response.choiceIds ?? [];
  const validIds = new Set(question.choices.map((choice) => choice.id));
  if (!selected.length || selected.some((choiceId) => !validIds.has(choiceId))) {
    throw new Error("Choose a valid response option");
  }
  if (question.type !== "multi_select" && selected.length !== 1) {
    throw new Error("Choose one response option");
  }
}

function responseCorrect(
  question: QuestionDraft,
  response: PresentationSessionResponse,
): boolean | null {
  if (question.type === "poll" || question.type === "rating") return null;
  if (question.type === "numeric") {
    const actual = Number(response.numericValue);
    const expected = Number(question.correctValue);
    const tolerance = Number(question.tolerance || 0);
    return Math.abs(actual - expected) <= tolerance;
  }
  const selected = new Set(response.choiceIds ?? []);
  const correct = new Set(
    question.choices.filter((choice) => choice.isCorrect).map((choice) => choice.id),
  );
  return selected.size === correct.size && [...selected].every((choiceId) => correct.has(choiceId));
}

async function hostSnapshot(
  session: PresentationSessionRecord,
  sessions: PresentationSessionRepository,
) {
  const [participants, responses] = await Promise.all([
    sessions.listParticipants(session.id),
    sessions.listResponses(session.id),
  ]);
  const block = currentBlock(session);
  const deadline = questionDeadline(session);
  const leaderboard = rankedParticipants(participants, responses);
  return {
    id: session.id,
    artifactType: "presentation" as const,
    presentationId: session.presentationId,
    presentationVersionId: session.presentationVersionId,
    title: session.title,
    code: session.code,
    status: session.status,
    phase: session.phase,
    currentBlockIndex: session.currentBlockIndex,
    blockCount: session.content.blocks.length,
    revision: session.revision,
    currentBlock: block,
    questionClosesAt: deadline?.toISOString() ?? null,
    acceptingResponses: Boolean(deadline && deadline.getTime() >= Date.now()),
    participantCount: participants.length,
    responseCount:
      block?.kind === "question"
        ? responses.filter((response) => response.blockId === block.id).length
        : 0,
    participants: leaderboard,
    leaderboard,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    finishedAt: session.finishedAt,
  };
}

async function participantSnapshot(
  session: PresentationSessionRecord,
  participantId: string,
  sessions: PresentationSessionRepository,
) {
  const [participants, responses] = await Promise.all([
    sessions.listParticipants(session.id),
    sessions.listResponses(session.id),
  ]);
  const block = currentBlock(session);
  const deadline = questionDeadline(session);
  const leaderboard = rankedParticipants(participants, responses);
  const currentResponse = block
    ? responses.find(
        (response) => response.blockId === block.id && response.participantId === participantId,
      )
    : undefined;
  const standing = leaderboard.find((entry) => entry.id === participantId);
  const resultVisible =
    session.phase === "question_reveal" ||
    session.phase === "intervention" ||
    session.phase === "finished";
  return {
    id: session.id,
    artifactType: "presentation" as const,
    title: session.title,
    status: session.status,
    phase: session.phase,
    currentBlockIndex: session.currentBlockIndex,
    blockCount: session.content.blocks.length,
    revision: session.revision,
    currentBlock: participantBlock(block),
    questionClosesAt: deadline?.toISOString() ?? null,
    acceptingResponses: Boolean(deadline && deadline.getTime() >= Date.now()),
    participantCount: participants.length,
    responseSubmitted: Boolean(currentResponse),
    // The accepted response is already scored for timing and duplicate protection. Publishing
    // the resulting rank or score while the question is open would leak correctness before the
    // reveal, so standings resume only after the question closes.
    standing:
      session.phase !== "question_open" && standing
        ? { rank: standing.rank, score: standing.score }
        : null,
    responseResult:
      resultVisible && currentResponse
        ? { correct: currentResponse.correct, score: currentResponse.score }
        : null,
    finishedAt: session.finishedAt,
  };
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

function reportFor(
  session: PresentationSessionRecord,
  responses: PresentationSessionResponseRecord[],
  participants: Awaited<ReturnType<PresentationSessionRepository["listParticipants"]>>,
  timeline: Awaited<ReturnType<PresentationSessionRepository["listTimeline"]>>,
) {
  const byBlock = new Map<string, PresentationSessionResponseRecord[]>();
  for (const response of responses) {
    const group = byBlock.get(response.blockId) ?? [];
    group.push(response);
    byBlock.set(response.blockId, group);
  }
  const evidence = session.content.blocks.map((block, blockIndex) => {
    if (block.kind === "content") {
      return {
        blockId: block.id,
        blockIndex,
        kind: "content" as const,
        title: block.title,
        assessmentStatus: "not_assessed" as const,
      };
    }
    const blockResponses = byBlock.get(block.id) ?? [];
    const assessed = blockResponses.filter((response) => response.correct !== null);
    const correct = assessed.filter((response) => response.correct).length;
    return {
      blockId: block.id,
      blockIndex,
      kind: "question" as const,
      questionId: block.question.id,
      prompt: block.question.prompt,
      questionType: block.question.type,
      questionTypeLabel: questionTypeDefinition(block.question.type).label,
      delivery: block.question.delivery ?? "main",
      respondents: blockResponses.length,
      correct: assessed.length ? correct : null,
      accuracyPercent: assessed.length ? Math.round((correct / assessed.length) * 100) : null,
      totalScore: blockResponses.reduce((total, response) => total + response.score, 0),
      averageResponseMs: blockResponses.length
        ? Math.round(
            blockResponses.reduce((total, response) => total + response.responseMs, 0) /
              blockResponses.length,
          )
        : null,
    };
  });
  const responseByParticipantQuestion = new Map(
    responses.map((response) => [`${response.participantId}:${response.questionId}`, response]),
  );
  const recovery = session.content.blocks.flatMap((block) => {
    if (block.kind !== "question" || !block.question.linkedRecheckQuestionId) return [];
    let eligible = 0;
    let recovered = 0;
    for (const participant of participants) {
      const initial = responseByParticipantQuestion.get(`${participant.id}:${block.question.id}`);
      const recheck = responseByParticipantQuestion.get(
        `${participant.id}:${block.question.linkedRecheckQuestionId}`,
      );
      if (initial?.correct === false && recheck) {
        eligible += 1;
        if (recheck.correct === true) recovered += 1;
      }
    }
    return [
      {
        sourceQuestionId: block.question.id,
        recheckQuestionId: block.question.linkedRecheckQuestionId,
        eligible,
        recovered,
        recoveryPercent: eligible ? Math.round((recovered / eligible) * 100) : null,
      },
    ];
  });
  return {
    sessionId: session.id,
    artifactType: "presentation" as const,
    presentationId: session.presentationId,
    presentationVersionId: session.presentationVersionId,
    title: session.title,
    status: session.status,
    participantCount: participants.length,
    responseCount: responses.length,
    leaderboard: rankedParticipants(participants, responses).map(
      ({ id, nickname, score, rank }) => ({ id, nickname, score, rank }),
    ),
    evidence,
    recovery,
    timeline: timeline.map((event) => ({
      sequence: event.sequence,
      type: event.type,
      blockIndex: event.blockIndex,
      blockId: event.blockId,
      occurredAt: event.occurredAt,
    })),
    evidenceNote:
      "Content slides are recorded in the facilitation timeline but are not evidence of learning.",
    createdAt: session.createdAt,
    finishedAt: session.finishedAt,
  };
}

export async function registerPresentationSessionRoutes(
  app: FastifyInstance,
  dependencies: {
    repository: Repository;
    presentations: PresentationRepository;
    presentationSessions: PresentationSessionRepository;
    auth: AuthService;
    config: Pick<
      AppConfig,
      "COMMUNITY_MODE" | "COMMUNITY_REPORT_RETENTION_DAYS" | "MAX_SESSION_PARTICIPANTS"
    >;
    storage: StorageService;
    workspaceEnabled: (workspaceId: string) => boolean;
  },
) {
  const {
    repository,
    presentations,
    presentationSessions,
    auth,
    config,
    storage,
    workspaceEnabled,
  } = dependencies;
  const requirePresentationWorkspace = (
    workspaceId: string,
    reply: FastifyReply,
    requestId: string,
  ) =>
    workspaceEnabled(workspaceId)
      ? true
      : professionalFeatureUnavailable(reply, requestId, "Presentation session not found");

  app.get("/v1/presentation-sessions", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requirePresentationWorkspace(creator.workspaceId, reply, request.id) !== true) return;
    const sessions = await presentationSessions.listSessions(creator.workspaceId);
    return {
      sessions: await Promise.all(
        sessions.map((session) => hostSnapshot(session, presentationSessions)),
      ),
    };
  });

  app.post("/v1/presentation-sessions", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requirePresentationWorkspace(creator.workspaceId, reply, request.id) !== true) return;
    if (requireEditor(creator, reply, request.id) !== true) return;
    const input = CreatePresentationSessionSchema.parse(request.body);
    const presentation = await presentations.getPresentation(
      creator.workspaceId,
      input.presentationId,
    );
    if (!presentation) {
      return apiError(reply, 404, "NOT_FOUND", "Presentation not found", request.id);
    }
    if (!presentation.currentVersionId) {
      return apiError(
        reply,
        422,
        "VALIDATION_ERROR",
        "Publish this Presentation before hosting it",
        request.id,
      );
    }
    const version = await presentations.getPresentationVersion(
      creator.workspaceId,
      presentation.currentVersionId,
    );
    if (!version) {
      return apiError(reply, 404, "NOT_FOUND", "Published Presentation not found", request.id);
    }
    const now = new Date();
    const plan = await repository.getPlan(creator.workspaceId);
    const session = await presentationSessions.createSession({
      id: randomUUID(),
      workspaceId: creator.workspaceId,
      presentationId: presentation.id,
      presentationVersionId: version.id,
      title: version.content.title,
      content: version.content,
      code: await uniqueJoinCode(presentationSessions),
      status: "active",
      phase: "lobby",
      currentBlockIndex: -1,
      revision: 0,
      createdBy: creator.userId,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      liveExpiresAt: new Date(now.getTime() + PRESENTATION_SESSION_LIFETIME_MS),
      retentionExpiresAt: retentionExpiry(now, entitlementsFor(plan, config)),
    });
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "presentation.session.create",
      targetType: "presentation_live_session",
      targetId: session.id,
      requestId: request.id,
      metadata: { presentationId: presentation.id, presentationVersionId: version.id },
    });
    return reply.code(201).send({ snapshot: await hostSnapshot(session, presentationSessions) });
  });

  app.get("/v1/presentation-sessions/:id", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requirePresentationWorkspace(creator.workspaceId, reply, request.id) !== true) return;
    const { id } = IdParamsSchema.parse(request.params);
    const session = await presentationSessions.getSessionForWorkspace(creator.workspaceId, id);
    if (!session)
      return apiError(reply, 404, "NOT_FOUND", "Presentation session not found", request.id);
    if (liveSessionExpired(session)) {
      return apiError(
        reply,
        409,
        "PHASE_CLOSED",
        "This Presentation session has expired",
        request.id,
      );
    }
    return { snapshot: await hostSnapshot(session, presentationSessions) };
  });

  app.post("/v1/presentation-sessions/:id/advance", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requirePresentationWorkspace(creator.workspaceId, reply, request.id) !== true) return;
    if (requireEditor(creator, reply, request.id) !== true) return;
    const { id } = IdParamsSchema.parse(request.params);
    const input = AdvancePresentationSessionSchema.parse(request.body);
    const session = await presentationSessions.getSessionForWorkspace(creator.workspaceId, id);
    if (!session)
      return apiError(reply, 404, "NOT_FOUND", "Presentation session not found", request.id);
    if (liveSessionExpired(session)) {
      return apiError(
        reply,
        409,
        "PHASE_CLOSED",
        "This Presentation session has expired",
        request.id,
      );
    }
    // The transition is derived from this exact snapshot. Requiring the client's fence to match
    // it prevents a future revision supplied by another host window from applying a stale action
    // after an intervening transition.
    if (input.expectedRevision !== session.revision) {
      return reply.code(409).send({
        error: {
          code: "STALE_SESSION",
          message: "This Presentation advanced in another host window. Refresh before continuing.",
          requestId: request.id,
          details: {
            expectedRevision: input.expectedRevision,
            currentRevision: session.revision,
          },
        },
      });
    }
    const transition = nextTransition(session);
    if (!transition) {
      return { snapshot: await hostSnapshot(session, presentationSessions) };
    }
    try {
      const transitionRetentionExpiresAt =
        transition.status === "finished"
          ? retentionExpiry(
              new Date(),
              entitlementsFor(await repository.getPlan(creator.workspaceId), config),
            )
          : undefined;
      const updated = await presentationSessions.transitionSession({
        workspaceId: creator.workspaceId,
        sessionId: id,
        expectedRevision: input.expectedRevision,
        ...transition,
        ...(transitionRetentionExpiresAt
          ? { retentionExpiresAt: transitionRetentionExpiresAt }
          : {}),
      });
      if (!updated) {
        return apiError(reply, 404, "NOT_FOUND", "Presentation session not found", request.id);
      }
      if (updated.status === "finished") {
        await repository.recordAudit({
          workspaceId: creator.workspaceId,
          actorId: creator.userId,
          action: "presentation.session.finish",
          targetType: "presentation_live_session",
          targetId: updated.id,
          requestId: request.id,
        });
      }
      return { snapshot: await hostSnapshot(updated, presentationSessions) };
    } catch (error) {
      if (error instanceof PresentationSessionConflictError) {
        return reply.code(409).send({
          error: {
            code: "STALE_SESSION",
            message:
              "This Presentation advanced in another host window. Refresh before continuing.",
            requestId: request.id,
            details: {
              expectedRevision: error.expectedRevision,
              currentRevision: error.currentRevision,
            },
          },
        });
      }
      throw error;
    }
  });

  app.post(
    "/v1/presentation-sessions/join",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = JoinPresentationSessionSchema.parse(request.body);
      const session = await presentationSessions.getSessionByCode(input.code);
      if (!session || session.status === "finished" || liveSessionExpired(session)) {
        return apiError(reply, 404, "NOT_FOUND", "Active Presentation not found", request.id);
      }
      if (requirePresentationWorkspace(session.workspaceId, reply, request.id) !== true) return;
      const participantToken = `${randomUUID()}.${randomBytes(24).toString("base64url")}`;
      const now = new Date();
      const plan = await repository.getPlan(session.workspaceId);
      const participantLimit = entitlementsFor(plan, config).maxParticipants;
      const joined = await presentationSessions.joinParticipantWithinLimit(
        {
          id: randomUUID(),
          workspaceId: session.workspaceId,
          sessionId: session.id,
          nickname: input.nickname,
          tokenHash: tokenHash(participantToken),
          joinedAt: now,
          lastSeenAt: now,
        },
        participantLimit,
      );
      if (joined.status === "closed") {
        return apiError(reply, 404, "NOT_FOUND", "Active Presentation not found", request.id);
      }
      if (joined.status === "full") {
        return apiError(reply, 409, "PARTICIPANT_LIMIT", "This Presentation is full", request.id);
      }
      const currentSession = await presentationSessions.getSessionById(session.id);
      if (!currentSession) {
        return apiError(reply, 404, "NOT_FOUND", "Active Presentation not found", request.id);
      }
      return reply.code(201).send({
        participantToken,
        snapshot: await participantSnapshot(
          currentSession,
          joined.participant.id,
          presentationSessions,
        ),
      });
    },
  );

  app.get("/v1/presentation-sessions/:id/participant", async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const token = bearerToken(request);
    if (!token)
      return apiError(reply, 401, "UNAUTHORIZED", "Participant credential required", request.id);
    const session = await presentationSessions.getSessionById(id);
    if (session && requirePresentationWorkspace(session.workspaceId, reply, request.id) !== true)
      return;
    if (!session || liveSessionExpired(session)) {
      return apiError(reply, 401, "UNAUTHORIZED", "Participant credential is invalid", request.id);
    }
    const participant = await presentationSessions.findParticipant(id, tokenHash(token));
    if (!participant) {
      return apiError(reply, 401, "UNAUTHORIZED", "Participant credential is invalid", request.id);
    }
    return { snapshot: await participantSnapshot(session, participant.id, presentationSessions) };
  });

  app.get("/v1/presentation-sessions/:id/media/:mediaId", async (request, reply) => {
    const { id, mediaId } = SessionMediaParamsSchema.parse(request.params);
    const token = bearerToken(request);
    if (!token) {
      return apiError(reply, 401, "UNAUTHORIZED", "Participant credential required", request.id);
    }
    const session = await presentationSessions.getSessionById(id);
    if (session && requirePresentationWorkspace(session.workspaceId, reply, request.id) !== true)
      return;
    if (!session || liveSessionExpired(session)) {
      return apiError(reply, 401, "UNAUTHORIZED", "Participant credential is invalid", request.id);
    }
    const participant = await presentationSessions.findParticipant(id, tokenHash(token));
    if (!participant) {
      return apiError(reply, 401, "UNAUTHORIZED", "Participant credential is invalid", request.id);
    }
    const referenced = session.content.blocks.some((block) =>
      block.kind === "content" ? block.mediaId === mediaId : block.question.mediaId === mediaId,
    );
    if (!referenced) {
      return apiError(reply, 404, "NOT_FOUND", "Media not found", request.id);
    }
    const asset = await repository.getMediaAsset(session.workspaceId, mediaId);
    if (!asset || asset.scanStatus !== "clean") {
      return apiError(reply, 404, "NOT_FOUND", "Media not found", request.id);
    }
    return {
      media: { id: asset.id, scanStatus: asset.scanStatus },
      downloadUrl: await storage.createDownloadUrl(asset),
    };
  });

  app.post("/v1/presentation-sessions/:id/responses", async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const input = SubmitPresentationSessionResponseSchema.parse(request.body);
    const session = await presentationSessions.getSessionById(id);
    if (session && requirePresentationWorkspace(session.workspaceId, reply, request.id) !== true)
      return;
    if (!session || liveSessionExpired(session)) {
      return apiError(reply, 401, "UNAUTHORIZED", "Participant credential is invalid", request.id);
    }
    const participant = await presentationSessions.findParticipant(
      id,
      tokenHash(input.participantToken),
    );
    if (!participant) {
      return apiError(reply, 401, "UNAUTHORIZED", "Participant credential is invalid", request.id);
    }
    const block = currentBlock(session);
    if (session.phase !== "question_open" || block?.kind !== "question") {
      return apiError(
        reply,
        409,
        "PHASE_CLOSED",
        "This question is not accepting responses",
        request.id,
      );
    }
    const deadline = questionDeadline(session);
    if (!deadline || deadline.getTime() < Date.now()) {
      return apiError(
        reply,
        409,
        "PHASE_CLOSED",
        "The response timer has ended for this question",
        request.id,
      );
    }
    try {
      validateResponse(block.question, input.response);
    } catch (error) {
      return apiError(reply, 422, "VALIDATION_ERROR", (error as Error).message, request.id);
    }
    const submittedAt = new Date();
    const correct = responseCorrect(block.question, input.response);
    const timing = responseTiming(session, submittedAt);
    const acceptance = await presentationSessions.acceptResponse(
      {
        id: randomUUID(),
        workspaceId: session.workspaceId,
        sessionId: session.id,
        participantId: participant.id,
        blockId: block.id,
        questionId: block.question.id,
        response: input.response,
        correct,
        score: responseScore(block.question, correct, timing.remainingRatio),
        responseMs: timing.responseMs,
        submittedAt,
      },
      session.revision,
    );
    if (acceptance.status === "phase_closed") {
      return apiError(
        reply,
        409,
        "PHASE_CLOSED",
        "This question is no longer accepting responses",
        request.id,
      );
    }
    if (acceptance.status === "duplicate") {
      return apiError(
        reply,
        409,
        "ALREADY_RESPONDED",
        "Your response is already saved",
        request.id,
      );
    }
    return reply.code(202).send({ accepted: true, submittedAt: acceptance.response.submittedAt });
  });

  app.get("/v1/presentation-sessions/:id/report", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requirePresentationWorkspace(creator.workspaceId, reply, request.id) !== true) return;
    const { id } = IdParamsSchema.parse(request.params);
    const session = await presentationSessions.getSessionForWorkspace(creator.workspaceId, id);
    if (!session)
      return apiError(reply, 404, "NOT_FOUND", "Presentation session not found", request.id);
    const [responses, participants, timeline] = await Promise.all([
      presentationSessions.listResponses(id),
      presentationSessions.listParticipants(id),
      presentationSessions.listTimeline(id),
    ]);
    return { report: reportFor(session, responses, participants, timeline) };
  });
}

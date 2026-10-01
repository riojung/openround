import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  QuestionHealthDismissalInputSchema,
  QuestionHealthDismissalSchema,
  QuestionHealthResultSchema,
  QuizDraftSchema,
} from "@openround/contracts";
import type { QuestionHealthFinding } from "@openround/contracts";
import type { Repository } from "@openround/db";
import { evaluateQuestionHealth } from "@openround/insights";
import type { AuthService } from "./auth.js";
import type { AppConfig } from "./config.js";
import { evidenceWorkspaceFeatureEnabled } from "./workspace-rollout.js";

const IdParamsSchema = z.object({ id: z.string().uuid() });
const DismissalParamsSchema = IdParamsSchema.extend({
  findingId: z.string().min(1).max(500),
});
const DismissalRemovalBodySchema = QuestionHealthDismissalInputSchema.omit({ reason: true });

function apiError(
  reply: FastifyReply,
  status: number,
  code: "NOT_FOUND" | "VALIDATION_ERROR" | "FORBIDDEN" | "CONFLICT",
  message: string,
  requestId: string,
) {
  return reply.code(status).send({ error: { code, message, requestId } });
}

async function currentQuestionHealth(
  repository: Repository,
  workspaceId: string,
  quizId: string,
  includeFindingIds?: ReadonlySet<string>,
): Promise<
  | {
      status: "ok";
      draftRevision: number;
      result: Awaited<ReturnType<typeof evaluateQuestionHealth>>;
    }
  | { status: "not_found" }
  | { status: "invalid_draft" }
> {
  const quiz = await repository.getQuiz(workspaceId, quizId);
  if (!quiz) return { status: "not_found" };
  const draft = QuizDraftSchema.safeParse(quiz.draft);
  if (!draft.success) return { status: "invalid_draft" };
  const draftRevision = quiz.draftRevision ?? 0;
  const result = await evaluateQuestionHealth(draft.data, {
    quizId: quiz.id,
    draftRevision,
    includeFindingIds,
  });
  return { status: "ok", draftRevision, result };
}

function dismissalMatchesFinding(
  dismissal: {
    findingId: string;
    ruleVersion: number;
    rulesetVersion: string;
    contentHash: string;
  },
  finding: QuestionHealthFinding,
) {
  return (
    dismissal.findingId === finding.id &&
    dismissal.ruleVersion === finding.ruleVersion &&
    dismissal.rulesetVersion === finding.rulesetVersion &&
    dismissal.contentHash === finding.contentHash
  );
}

export async function registerQuestionHealthRoutes(
  app: FastifyInstance,
  dependencies: {
    config: AppConfig;
    repository: Repository;
    auth: AuthService;
  },
) {
  const { config, repository, auth } = dependencies;

  app.get("/v1/quizzes/:id/question-health", async (request, reply) => {
    reply.header("cache-control", "private, no-store").header("pragma", "no-cache");
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const enabled = evidenceWorkspaceFeatureEnabled(config, creator.workspaceId, "questionHealth");

    const { id } = IdParamsSchema.parse(request.params);
    const stored = await repository.listQuestionHealthDismissals(creator.workspaceId, id);
    if (!enabled && stored.length === 0) {
      return apiError(reply, 404, "NOT_FOUND", "Question Health is not available", request.id);
    }
    const current = await currentQuestionHealth(
      repository,
      creator.workspaceId,
      id,
      new Set(stored.map((dismissal) => dismissal.findingId)),
    );
    if (current.status === "not_found") {
      return apiError(reply, 404, "NOT_FOUND", "Round not found", request.id);
    }
    if (current.status === "invalid_draft") {
      if (!enabled) {
        return apiError(reply, 404, "NOT_FOUND", "Question Health is not available", request.id);
      }
      return apiError(
        reply,
        422,
        "VALIDATION_ERROR",
        "The Round draft cannot be evaluated until its content is valid.",
        request.id,
      );
    }

    const dismissals = stored
      .filter((dismissal) =>
        current.result.findings.some((finding) => dismissalMatchesFinding(dismissal, finding)),
      )
      .map((dismissal) =>
        QuestionHealthDismissalSchema.parse({
          findingId: dismissal.findingId,
          ruleVersion: dismissal.ruleVersion,
          rulesetVersion: dismissal.rulesetVersion,
          contentHash: dismissal.contentHash,
          reason: dismissal.reason,
          createdAt: dismissal.createdAt.toISOString(),
        }),
      );
    if (!enabled && dismissals.length === 0) {
      return apiError(reply, 404, "NOT_FOUND", "Question Health is not available", request.id);
    }
    const visibleFindings = enabled
      ? current.result.findings
      : current.result.findings.filter((finding) =>
          dismissals.some((dismissal) => dismissalMatchesFinding(dismissal, finding)),
        );
    reply.header("etag", `"draft-${current.draftRevision}"`);
    return QuestionHealthResultSchema.parse({
      ...current.result,
      findings: visibleFindings,
      dismissals,
    });
  });

  app.put("/v1/quizzes/:id/question-health/dismissals/:findingId", async (request, reply) => {
    reply.header("cache-control", "private, no-store").header("pragma", "no-cache");
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (creator.role === "viewer") {
      return apiError(reply, 403, "FORBIDDEN", "An editor role is required", request.id);
    }
    if (!evidenceWorkspaceFeatureEnabled(config, creator.workspaceId, "questionHealth")) {
      return apiError(reply, 404, "NOT_FOUND", "Question Health is not available", request.id);
    }

    const { id, findingId } = DismissalParamsSchema.parse(request.params);
    const input = QuestionHealthDismissalInputSchema.parse(request.body);
    const current = await currentQuestionHealth(repository, creator.workspaceId, id);
    if (current.status === "not_found") {
      return apiError(reply, 404, "NOT_FOUND", "Round not found", request.id);
    }
    if (current.status === "invalid_draft") {
      return apiError(
        reply,
        422,
        "VALIDATION_ERROR",
        "The Round draft cannot be evaluated until its content is valid.",
        request.id,
      );
    }
    const finding = current.result.findings.find(
      (candidate) =>
        candidate.id === findingId &&
        candidate.ruleVersion === input.ruleVersion &&
        candidate.rulesetVersion === input.rulesetVersion &&
        candidate.contentHash === input.contentHash,
    );
    if (current.draftRevision !== input.draftRevision || !finding) {
      return apiError(
        reply,
        409,
        "CONFLICT",
        "This finding is stale. Review the current saved draft before dismissing it.",
        request.id,
      );
    }

    const saved = await repository.putQuestionHealthDismissal({
      actorId: creator.userId,
      workspaceId: creator.workspaceId,
      quizId: id,
      findingId,
      ruleVersion: input.ruleVersion,
      rulesetVersion: input.rulesetVersion,
      contentHash: input.contentHash,
      reason: input.reason,
      expectedDraftRevision: input.draftRevision,
      requestId: request.id,
    });
    if (saved.status === "not_found") {
      return apiError(reply, 404, "NOT_FOUND", "Round not found", request.id);
    }
    if (saved.status === "revision_conflict") {
      return apiError(
        reply,
        409,
        "CONFLICT",
        "The Round changed while this dismissal was being saved; review it again.",
        request.id,
      );
    }
    return QuestionHealthDismissalSchema.parse({
      findingId: saved.dismissal.findingId,
      ruleVersion: saved.dismissal.ruleVersion,
      rulesetVersion: saved.dismissal.rulesetVersion,
      contentHash: saved.dismissal.contentHash,
      reason: saved.dismissal.reason,
      createdAt: saved.dismissal.createdAt.toISOString(),
    });
  });

  app.delete("/v1/quizzes/:id/question-health/dismissals/:findingId", async (request, reply) => {
    reply.header("cache-control", "private, no-store").header("pragma", "no-cache");
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (creator.role === "viewer") {
      return apiError(reply, 403, "FORBIDDEN", "An editor role is required", request.id);
    }
    const enabled = evidenceWorkspaceFeatureEnabled(config, creator.workspaceId, "questionHealth");

    const { id, findingId } = DismissalParamsSchema.parse(request.params);
    const input = DismissalRemovalBodySchema.parse(request.body);
    const current = await currentQuestionHealth(
      repository,
      creator.workspaceId,
      id,
      new Set([findingId]),
    );
    if (current.status === "not_found") {
      return apiError(reply, 404, "NOT_FOUND", "Round not found", request.id);
    }
    if (current.status === "invalid_draft") {
      if (!enabled) {
        return apiError(reply, 404, "NOT_FOUND", "Question Health is not available", request.id);
      }
      return apiError(
        reply,
        422,
        "VALIDATION_ERROR",
        "The Round draft cannot be evaluated until its content is valid.",
        request.id,
      );
    }
    const finding = current.result.findings.find(
      (candidate) =>
        candidate.id === findingId &&
        candidate.ruleVersion === input.ruleVersion &&
        candidate.rulesetVersion === input.rulesetVersion &&
        candidate.contentHash === input.contentHash,
    );
    if (!enabled) {
      const stored = await repository.listQuestionHealthDismissals(creator.workspaceId, id);
      if (!finding || !stored.some((dismissal) => dismissalMatchesFinding(dismissal, finding))) {
        return apiError(reply, 404, "NOT_FOUND", "Question Health dismissal not found", request.id);
      }
    }
    if (current.draftRevision !== input.draftRevision || !finding) {
      return apiError(
        reply,
        409,
        "CONFLICT",
        "This finding is stale. Review the current saved draft before reopening it.",
        request.id,
      );
    }

    const removed = await repository.deleteQuestionHealthDismissal({
      actorId: creator.userId,
      workspaceId: creator.workspaceId,
      quizId: id,
      findingId,
      ruleVersion: input.ruleVersion,
      rulesetVersion: input.rulesetVersion,
      contentHash: input.contentHash,
      expectedDraftRevision: input.draftRevision,
      requestId: request.id,
    });
    if (removed.status === "not_found") {
      return apiError(reply, 404, "NOT_FOUND", "Round not found", request.id);
    }
    if (removed.status === "revision_conflict") {
      return apiError(
        reply,
        409,
        "CONFLICT",
        "The Round changed while this dismissal was being removed; review it again.",
        request.id,
      );
    }
    return { removed: removed.removed };
  });
}

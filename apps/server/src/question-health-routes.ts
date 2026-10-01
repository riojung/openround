import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { QuestionHealthResultSchema, QuizDraftSchema } from "@openround/contracts";
import type { Repository } from "@openround/db";
import { evaluateQuestionHealth } from "@openround/insights";
import type { AuthService } from "./auth.js";
import type { AppConfig } from "./config.js";
import { evidenceWorkspaceFeatureEnabled } from "./workspace-rollout.js";

const IdParamsSchema = z.object({ id: z.string().uuid() });

function apiError(
  reply: FastifyReply,
  status: number,
  code: "NOT_FOUND" | "VALIDATION_ERROR",
  message: string,
  requestId: string,
) {
  return reply.code(status).send({ error: { code, message, requestId } });
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
    if (!evidenceWorkspaceFeatureEnabled(config, creator.workspaceId, "questionHealth")) {
      return apiError(reply, 404, "NOT_FOUND", "Question Health is not available", request.id);
    }

    const { id } = IdParamsSchema.parse(request.params);
    const quiz = await repository.getQuiz(creator.workspaceId, id);
    if (!quiz) return apiError(reply, 404, "NOT_FOUND", "Round not found", request.id);

    const draft = QuizDraftSchema.safeParse(quiz.draft);
    if (!draft.success) {
      return apiError(
        reply,
        422,
        "VALIDATION_ERROR",
        "The Round draft cannot be evaluated until its content is valid.",
        request.id,
      );
    }

    const draftRevision = quiz.draftRevision ?? 0;
    const result = await evaluateQuestionHealth(draft.data, { quizId: quiz.id, draftRevision });
    reply.header("etag", `"draft-${draftRevision}"`);
    return QuestionHealthResultSchema.parse(result);
  });
}

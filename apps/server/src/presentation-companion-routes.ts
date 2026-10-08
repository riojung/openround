import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  PresentationCompanionCommandSchema,
  PresentationCompanionPassResponseSchema,
  PresentationCompanionSnapshotSchema,
} from "@openround/contracts";
import type { CreatorContext } from "@openround/db";
import type { AuthService } from "./auth.js";
import type { AppConfig } from "./config.js";
import type { PresentationSessionService } from "./presentation-session-service.js";
import {
  evidenceWorkspaceFeatureEnabled,
  professionalFeatureUnavailable,
} from "./workspace-rollout.js";

const IdParamsSchema = z.object({ id: z.string().uuid() });
const CompanionPassParamsSchema = z.object({
  id: z.string().uuid(),
  credentialId: z.string().uuid(),
});

interface PresentationCompanionRouteDependencies {
  auth: Pick<AuthService, "requireCreator">;
  config: AppConfig;
  service: Pick<
    PresentationSessionService,
    "createCompanionPass" | "revokeCompanionPass" | "getCompanionSnapshot" | "companionCommand"
  >;
  requirePresentationWorkspace(
    workspaceId: string,
    reply: FastifyReply,
    requestId: string,
  ): boolean | FastifyReply;
  enforceSharedAdmission(
    request: FastifyRequest,
    reply: FastifyReply,
    key: string,
    maximum: number,
  ): Promise<boolean>;
  requireEditor(
    creator: CreatorContext,
    reply: FastifyReply,
    requestId: string,
  ): boolean | FastifyReply;
  noStore(reply: FastifyReply): FastifyReply;
  bearerToken(request: FastifyRequest): string | null;
  apiError(
    reply: FastifyReply,
    status: number,
    code: string,
    message: string,
    requestId: string,
    details?: Record<string, unknown>,
  ): FastifyReply;
  sendServiceError(error: unknown, reply: FastifyReply, requestId: string): FastifyReply;
}

function presentationCompanionRateLimitKey(
  request: FastifyRequest,
  operation: "snapshot" | "command",
  bearerToken: PresentationCompanionRouteDependencies["bearerToken"],
) {
  const body = request.body as { companionToken?: unknown } | null;
  const token =
    operation === "snapshot"
      ? (bearerToken(request) ?? "invalid")
      : typeof body?.companionToken === "string"
        ? body.companionToken
        : "invalid";
  const params = request.params as { id?: unknown } | null;
  const sessionId = typeof params?.id === "string" ? params.id : "invalid";
  return `presentation-companion:${operation}:${sessionId}:${createHash("sha256").update(token).digest("hex")}`;
}

export function registerPresentationCompanionRoutes(
  app: FastifyInstance,
  dependencies: PresentationCompanionRouteDependencies,
) {
  const {
    auth,
    config,
    service,
    requirePresentationWorkspace,
    enforceSharedAdmission,
    requireEditor,
    noStore,
    bearerToken,
    apiError,
    sendServiceError,
  } = dependencies;
  const rateLimitKey = (request: FastifyRequest, operation: "snapshot" | "command") =>
    presentationCompanionRateLimitKey(request, operation, bearerToken);

  app.post("/v1/presentation-sessions/:id/companion-pass", async (request, reply) => {
    noStore(reply);
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requirePresentationWorkspace(creator.workspaceId, reply, request.id) !== true) return;
    if (requireEditor(creator, reply, request.id) !== true) return;
    if (!evidenceWorkspaceFeatureEnabled(config, creator.workspaceId, "presentationCompanion")) {
      return professionalFeatureUnavailable(reply, request.id, "Presentation companion not found");
    }
    const { id } = IdParamsSchema.parse(request.params);
    try {
      const pass = await service.createCompanionPass({
        workspaceId: creator.workspaceId,
        userId: creator.userId,
        sessionId: id,
        requestId: request.id,
      });
      return reply.code(201).send(PresentationCompanionPassResponseSchema.parse(pass));
    } catch (error) {
      return sendServiceError(error, reply, request.id);
    }
  });

  app.delete(
    "/v1/presentation-sessions/:id/companion-passes/:credentialId",
    async (request, reply) => {
      noStore(reply);
      const creator = await auth.requireCreator(request, reply);
      if (!creator) return;
      if (requireEditor(creator, reply, request.id) !== true) return;
      const { id, credentialId } = CompanionPassParamsSchema.parse(request.params);
      try {
        await service.revokeCompanionPass({
          workspaceId: creator.workspaceId,
          userId: creator.userId,
          sessionId: id,
          credentialId,
          requestId: request.id,
        });
        return reply.code(204).send();
      } catch (error) {
        return sendServiceError(error, reply, request.id);
      }
    },
  );

  app.get(
    "/v1/presentation-sessions/:id/companion",
    {
      onRequest: async (_request, reply) => {
        noStore(reply);
      },
      preHandler: async (request, reply) => {
        if (!(await enforceSharedAdmission(request, reply, rateLimitKey(request, "snapshot"), 120)))
          return reply;
      },
      config: {
        rateLimit: {
          max: 120,
          timeWindow: "1 minute",
          keyGenerator: (request: FastifyRequest) => rateLimitKey(request, "snapshot"),
        },
      },
    },
    async (request, reply) => {
      const { id } = IdParamsSchema.parse(request.params);
      const token = bearerToken(request);
      if (!token)
        return apiError(reply, 401, "UNAUTHORIZED", "Companion credential required", request.id);
      try {
        return {
          snapshot: PresentationCompanionSnapshotSchema.parse(
            await service.getCompanionSnapshot(id, token),
          ),
        };
      } catch (error) {
        return sendServiceError(error, reply, request.id);
      }
    },
  );

  app.post(
    "/v1/presentation-sessions/:id/companion-command",
    {
      onRequest: async (_request, reply) => {
        noStore(reply);
      },
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
          hook: "preHandler",
          keyGenerator: (request: FastifyRequest) => rateLimitKey(request, "command"),
        },
      },
    },
    async (request, reply) => {
      const { id } = IdParamsSchema.parse(request.params);
      const input = PresentationCompanionCommandSchema.parse(request.body);
      if (input.sessionId !== id)
        return apiError(
          reply,
          422,
          "VALIDATION_ERROR",
          "Command session must match its route",
          request.id,
        );
      if (!(await enforceSharedAdmission(request, reply, rateLimitKey(request, "command"), 30)))
        return;
      try {
        return {
          snapshot: PresentationCompanionSnapshotSchema.parse(
            await service.companionCommand(input),
          ),
        };
      } catch (error) {
        return sendServiceError(error, reply, request.id);
      }
    },
  );
}

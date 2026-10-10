import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { ActivatePresentationAudienceScopeSchema } from "@openround/contracts";
import { AudienceScopeStoreError } from "@openround/db";
import { AudienceAccessError } from "./audience-access.js";
import type { AudienceScopeService } from "./audience-scope-service.js";
import { hashToken } from "./security.js";

const ScopeParams = z.object({ scopeId: z.string().uuid() }).strict();
const ScopeQuery = z.object({ kind: z.enum(["round", "presentation"]) }).strict();
const SyncBody = ScopeQuery.extend({ limit: z.number().int().min(1).max(50).default(50) });

function credential(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ") || authorization.length > 2_048) {
    throw new AudienceAccessError(
      "UNAUTHORIZED",
      "Use your room credential in the Authorization header",
    );
  }
  return authorization.slice(7);
}

/** Credentials stay out of query strings. Legacy Round endpoints remain registered unchanged. */
export async function registerAudienceScopeRoutes(
  app: FastifyInstance,
  service: AudienceScopeService,
  consumeAdmission: (key: string, maximum: number, windowMs: number) => Promise<boolean>,
) {
  // Encapsulation keeps scope-specific error translation out of the legacy route handler.
  await app.register(async (scoped) => {
    scoped.setErrorHandler((error, request, reply) => {
      if (error instanceof AudienceAccessError || error instanceof AudienceScopeStoreError) {
        const status = error.code === "NOT_FOUND" ? 404 : error.code === "UNAUTHORIZED" ? 401 : 409;
        return reply
          .code(status)
          .send({ error: { code: error.code, message: error.message, requestId: request.id } });
      }
      throw error;
    });
    scoped.addHook("onRequest", async (_request, reply) => {
      reply.header("cache-control", "private, no-store");
    });
    scoped.post("/v1/audience-scopes", async (request, reply) => {
      const input = ActivatePresentationAudienceScopeSchema.parse(request.body);
      const token = credential(request);
      if (!(await consumeAdmission(`audience-scope-activation:${hashToken(token)}`, 20, 60_000))) {
        return reply.code(429).send({
          error: {
            code: "RATE_LIMITED",
            message: "Too many audience activation requests; wait a minute and retry",
            requestId: request.id,
          },
        });
      }
      const result = await service.activatePresentation(
        input.sessionId,
        token,
        input.idempotencyKey,
      );
      return reply.code(result.created ? 201 : 200).send({ scope: result.scope });
    });
    scoped.get("/v1/audience-scopes/:scopeId", async (request) => {
      const { scopeId } = ScopeParams.parse(request.params);
      const { kind } = ScopeQuery.parse(request.query);
      return { scope: await service.snapshot(kind, scopeId, credential(request)) };
    });
    scoped.post("/v1/audience-scopes/:scopeId/sync", async (request) => {
      const { scopeId } = ScopeParams.parse(request.params);
      const input = SyncBody.parse(request.body);
      return service.sync(input.kind, scopeId, credential(request), input.limit);
    });
  });
}

import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import Stripe from "stripe";
import {
  AnswerSubmitSchema,
  BrandThemeSchema,
  CreateQuizSchema,
  CreateSessionSchema,
  HostCommandSchema,
  JoinRequestSchema,
  MagicLinkRequestSchema,
  MediaUploadRequestSchema,
  OperationalFeaturesUpdateSchema,
  OperationalFeaturesViewSchema,
  PublicFeaturesSchema,
  QuizContentSchema,
  UpdateQuizSchema,
} from "@openround/contracts";
import { PublishedQuizLimitError, type BillingEventInput, type Repository } from "@openround/db";
import type { AppConfig } from "./config.js";
import type { AuthService } from "./auth.js";
import { cleanPlainText } from "./security.js";
import type { SessionService } from "./session-service.js";
import { SessionError } from "./session-service.js";
import type { RetentionService } from "./retention.js";
import type { MetricsService } from "./metrics.js";
import { reportCsv } from "./reporting.js";
import type { StorageService } from "./storage.js";
import { entitlementsFor } from "./entitlements.js";
import { validationIssueMessage } from "./validation.js";

const IdParamsSchema = z.object({ id: z.string().uuid() });
const SessionMediaParamsSchema = z.object({ id: z.string().uuid(), mediaId: z.string().uuid() });
const QuizListQuerySchema = z.object({ archived: z.enum(["true", "false"]).optional() });

function apiError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  requestId: string,
) {
  return reply.code(status).send({ error: { code, message, requestId } });
}

function sessionStatus(code: SessionError["code"]) {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "NOT_FOUND" || code === "INVALID_CODE") return 404;
  if (code === "ENTITLEMENT_LIMIT") return 402;
  if (
    code === "SESSION_FULL" ||
    code === "SESSION_LOCKED" ||
    code === "STALE_VERSION" ||
    code === "CONFLICT"
  )
    return 409;
  if (code === "NICKNAME_REJECTED" || code === "ANSWER_INVALID" || code === "ANSWER_LATE")
    return 422;
  return 400;
}

export async function registerRoutes(
  app: FastifyInstance,
  dependencies: {
    config: AppConfig;
    repository: Repository;
    auth: AuthService;
    sessions: SessionService;
    storage: StorageService;
    retention: RetentionService;
    metrics: MetricsService;
    stripeClient?: Stripe | null;
  },
) {
  const { config, repository, auth, sessions, storage, retention, metrics } = dependencies;
  const stripe =
    dependencies.stripeClient !== undefined
      ? dependencies.stripeClient
      : config.BILLING_MODE === "stripe"
        ? new Stripe(config.STRIPE_SECRET_KEY!)
        : null;
  const operationalFeatures = async () => {
    const runtime = await repository.getOperationalFeatures();
    const configured = {
      signups: config.FEATURE_SIGNUPS,
      sessionCreation: config.FEATURE_SESSION_CREATION,
      mediaUploads: storage.mediaUploadsEnabled,
    };
    return OperationalFeaturesViewSchema.parse({
      configured,
      runtime: {
        signups: runtime.signups,
        sessionCreation: runtime.sessionCreation,
        mediaUploads: runtime.mediaUploads,
        updatedAt: runtime.updatedAt?.toISOString() ?? null,
      },
      effective: {
        signups: configured.signups && runtime.signups,
        sessionCreation: configured.sessionCreation && runtime.sessionCreation,
        mediaUploads: configured.mediaUploads && runtime.mediaUploads,
      },
    });
  };

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return apiError(
        reply,
        400,
        "VALIDATION_ERROR",
        error.issues[0] ? validationIssueMessage(error.issues[0]) : "Request: Invalid value",
        request.id,
      );
    }
    if (error instanceof SessionError) {
      return apiError(reply, sessionStatus(error.code), error.code, error.message, request.id);
    }
    if (error instanceof PublishedQuizLimitError) {
      return apiError(reply, 402, "ENTITLEMENT_LIMIT", error.message, request.id);
    }
    if ((error as { code?: string }).code === "23505") {
      return apiError(reply, 409, "CONFLICT", "The requested record already exists", request.id);
    }
    if ((error as { statusCode?: number }).statusCode === 429) {
      return apiError(
        reply,
        429,
        "RATE_LIMITED",
        "Too many requests. Wait before trying again",
        request.id,
      );
    }
    request.log.error({ err: error }, "request failed");
    return apiError(reply, 500, "INTERNAL_ERROR", "The request could not be completed", request.id);
  });

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async () => ({
    status: "ready",
    storage: storage.configured ? "configured" : "disabled",
    mediaScanning: storage.mediaUploadsEnabled ? "enabled" : "disabled",
  }));

  app.get("/metrics", async (request, reply) => {
    if (!config.METRICS_ENABLED)
      return apiError(reply, 404, "NOT_FOUND", "Metrics are disabled", request.id);
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (config.METRICS_TOKEN && token !== config.METRICS_TOKEN) {
      return apiError(reply, 401, "UNAUTHORIZED", "Metrics token required", request.id);
    }
    return reply.header("content-type", metrics.contentType).send(await metrics.render());
  });

  app.get("/v1/features", async () => {
    const { effective } = await operationalFeatures();
    return PublicFeaturesSchema.parse({
      publicWebUrl: config.WEB_ORIGIN,
      mediaUploads: effective.mediaUploads,
      billing: config.BILLING_MODE,
      communityMode: config.COMMUNITY_MODE,
      signups: effective.signups,
      sessionCreation: effective.sessionCreation,
    });
  });

  app.post("/v1/auth/magic-link", async (request, reply) => {
    if (!(await operationalFeatures()).effective.signups) {
      return apiError(
        reply,
        503,
        "DEPENDENCY_UNAVAILABLE",
        "New sign-ins are temporarily paused",
        request.id,
      );
    }
    const input = MagicLinkRequestSchema.parse(request.body);
    const debugUrl = await auth.requestMagicLink(input.email, input.segment);
    return reply.code(202).send({ accepted: true, ...(debugUrl ? { debugUrl } : {}) });
  });

  app.get("/v1/auth/verify", async (request, reply) => {
    const { token } = z.object({ token: z.string().min(20) }).parse(request.query);
    const verified = await auth.verifyMagicLink(token);
    if (!verified)
      return apiError(
        reply,
        400,
        "UNAUTHORIZED",
        "This sign-in link is invalid or expired",
        request.id,
      );
    auth.setSessionCookie(reply, verified.sessionToken);
    return reply.redirect(`${config.WEB_ORIGIN}/dashboard?welcome=1`);
  });

  app.get("/v1/auth/me", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const entitlements = entitlementsFor(creator.plan, config);
    return {
      creator,
      entitlements,
      brandTheme: entitlements.brandTheme
        ? await repository.getBrandTheme(creator.workspaceId)
        : null,
    };
  });

  app.get("/v1/account/theme", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const entitlements = entitlementsFor(creator.plan, config);
    return {
      theme: await repository.getBrandTheme(creator.workspaceId),
      enabled: entitlements.brandTheme,
    };
  });

  app.put("/v1/account/theme", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const entitlements = entitlementsFor(creator.plan, config);
    if (!entitlements.brandTheme) {
      return apiError(
        reply,
        402,
        "ENTITLEMENT_LIMIT",
        "A workspace brand theme requires Pro",
        request.id,
      );
    }
    const input = BrandThemeSchema.parse(request.body);
    const theme = BrandThemeSchema.parse({
      ...input,
      organizationName: cleanPlainText(input.organizationName, 80),
    });
    await repository.updateBrandTheme(creator.workspaceId, theme);
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "workspace.theme.update",
      targetType: "workspace",
      targetId: creator.workspaceId,
      requestId: request.id,
      metadata: { organizationName: theme.organizationName },
    });
    return { theme };
  });

  app.delete("/v1/account/theme", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    await repository.updateBrandTheme(creator.workspaceId, null);
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "workspace.theme.delete",
      targetType: "workspace",
      targetId: creator.workspaceId,
      requestId: request.id,
    });
    return reply.code(204).send();
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    await auth.logout(request, reply);
    return { ok: true };
  });

  app.get("/v1/quizzes", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const query = QuizListQuerySchema.parse(request.query);
    return {
      quizzes: await repository.listQuizzes(creator.workspaceId, query.archived === "true"),
    };
  });

  app.post("/v1/quizzes", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const input = CreateQuizSchema.parse(request.body);
    const now = new Date();
    const quiz = await repository.createQuiz({
      id: randomUUID(),
      workspaceId: creator.workspaceId,
      title: cleanPlainText(input.title, 160),
      description: cleanPlainText(input.description, 1_000),
      status: "draft",
      draft: { title: input.title, description: input.description, questions: [] },
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "quiz.create",
      targetType: "quiz",
      targetId: quiz.id,
      requestId: request.id,
    });
    return reply.code(201).send({ quiz });
  });

  app.get("/v1/quizzes/:id", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = IdParamsSchema.parse(request.params);
    const quiz = await repository.getQuiz(creator.workspaceId, id);
    return quiz ? { quiz } : apiError(reply, 404, "NOT_FOUND", "Quiz not found", request.id);
  });

  app.patch("/v1/quizzes/:id", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = IdParamsSchema.parse(request.params);
    const draft = UpdateQuizSchema.parse(request.body);
    const quiz = await repository.updateQuiz(creator.workspaceId, id, draft);
    return quiz ? { quiz } : apiError(reply, 404, "NOT_FOUND", "Quiz not found", request.id);
  });

  app.post("/v1/quizzes/:id/publish", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = IdParamsSchema.parse(request.params);
    const quiz = await repository.getQuiz(creator.workspaceId, id);
    if (!quiz) return apiError(reply, 404, "NOT_FOUND", "Quiz not found", request.id);
    for (const mediaId of new Set(
      quiz.draft.questions.flatMap((question) => (question.mediaId ? [question.mediaId] : [])),
    )) {
      const asset = await repository.getMediaAsset(creator.workspaceId, mediaId);
      if (!asset || asset.scanStatus !== "clean") {
        return apiError(
          reply,
          422,
          "VALIDATION_ERROR",
          "Every question image must finish security scanning before publishing",
          request.id,
        );
      }
    }
    const entitlements = entitlementsFor(creator.plan, config);
    const current = quiz.currentVersionId
      ? await repository.getQuizVersion(creator.workspaceId, quiz.currentVersionId)
      : null;
    const content = QuizContentSchema.parse(quiz.draft);
    const contentHash = createHash("sha256").update(JSON.stringify(content)).digest("hex");
    const version = await repository.publishQuiz(
      {
        id: randomUUID(),
        workspaceId: creator.workspaceId,
        quizId: quiz.id,
        version: (current?.version ?? 0) + 1,
        content,
        contentHash,
        publishedAt: new Date(),
      },
      entitlements.maxPublishedQuizzes,
    );
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "quiz.publish",
      targetType: "quiz_version",
      targetId: version.id,
      requestId: request.id,
      metadata: { version: version.version, contentHash },
    });
    return { version };
  });

  app.post("/v1/quizzes/:id/duplicate", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = IdParamsSchema.parse(request.params);
    const source = await repository.getQuiz(creator.workspaceId, id);
    if (!source) return apiError(reply, 404, "NOT_FOUND", "Quiz not found", request.id);
    const now = new Date();
    const title = `${source.title} copy`.slice(0, 160);
    const quiz = await repository.duplicateQuiz({
      ...source,
      id: randomUUID(),
      title,
      status: "draft",
      currentVersionId: null,
      draft: { ...source.draft, title },
      createdAt: now,
      updatedAt: now,
    });
    return reply.code(201).send({ quiz });
  });

  app.post("/v1/quizzes/:id/archive", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = IdParamsSchema.parse(request.params);
    const { archived } = z.object({ archived: z.boolean().default(true) }).parse(request.body);
    const quiz = await repository.archiveQuiz(
      creator.workspaceId,
      id,
      archived,
      entitlementsFor(creator.plan, config).maxPublishedQuizzes,
    );
    return quiz ? { quiz } : apiError(reply, 404, "NOT_FOUND", "Quiz not found", request.id);
  });

  app.post("/v1/sessions", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (!(await operationalFeatures()).effective.sessionCreation) {
      return apiError(
        reply,
        503,
        "DEPENDENCY_UNAVAILABLE",
        "New live sessions are temporarily paused",
        request.id,
      );
    }
    const input = CreateSessionSchema.parse(request.body);
    const session = await sessions.createSession(creator, input.quizId, input.settings);
    return reply.code(201).send(session);
  });

  app.post(
    "/v1/sessions/join",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = JoinRequestSchema.parse(request.body);
      return reply.code(201).send(await sessions.join(input));
    },
  );

  app.get("/v1/sessions/:id/snapshot", async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    const { role } = z
      .object({ role: z.enum(["host", "participant", "presenter"]).default("participant") })
      .parse(request.query);
    const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    return {
      snapshot: await sessions.snapshot({
        sessionId: id,
        role,
        ...(role === "participant" ? { participantToken: bearer } : { hostToken: bearer }),
      }),
    };
  });

  app.post("/v1/sessions/:id/commands", async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    const hostToken = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const command = HostCommandSchema.parse({
      ...(request.body as Record<string, unknown>),
      sessionId: id,
      hostToken,
    });
    return { snapshot: await sessions.hostCommand(command) };
  });

  app.post("/v1/sessions/:id/answers", async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    const body = AnswerSubmitSchema.omit({ sessionId: true, participantToken: true }).parse(
      request.body,
    );
    const participantToken = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    return sessions.answer({ ...body, sessionId: id, participantToken });
  });

  app.delete("/v1/sessions/:id", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = IdParamsSchema.parse(request.params);
    const deleted = await sessions.deleteSession(creator.workspaceId, id);
    if (!deleted) return apiError(reply, 404, "NOT_FOUND", "Session not found", request.id);
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "session.delete",
      targetType: "game_session",
      targetId: id,
      requestId: request.id,
    });
    return reply.code(204).send();
  });

  app.get("/v1/sessions/:id/report", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = IdParamsSchema.parse(request.params);
    const report = await repository.getReportBySession(creator.workspaceId, id);
    return report
      ? { report, entitlements: entitlementsFor(creator.plan, config) }
      : apiError(reply, 404, "NOT_FOUND", "Report not found", request.id);
  });

  app.get("/v1/reports/:id", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = IdParamsSchema.parse(request.params);
    const report = await repository.getReport(creator.workspaceId, id);
    return report
      ? { report, entitlements: entitlementsFor(creator.plan, config) }
      : apiError(reply, 404, "NOT_FOUND", "Report not found", request.id);
  });

  app.get("/v1/reports/:id.csv", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = IdParamsSchema.parse(request.params);
    const report = await repository.getReport(creator.workspaceId, id);
    if (!report) return apiError(reply, 404, "NOT_FOUND", "Report not found", request.id);
    if (!entitlementsFor(creator.plan, config).csvExport) {
      return apiError(
        reply,
        402,
        "ENTITLEMENT_LIMIT",
        "CSV export is available on the Pro plan",
        request.id,
      );
    }
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="openround-report-${id}.csv"`)
      .send(reportCsv(report));
  });

  app.post("/v1/media", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (!(await operationalFeatures()).effective.mediaUploads)
      return apiError(
        reply,
        503,
        "DEPENDENCY_UNAVAILABLE",
        "Media uploads are temporarily unavailable",
        request.id,
      );
    const input = MediaUploadRequestSchema.parse(request.body);
    try {
      const upload = await storage.createUpload({ workspaceId: creator.workspaceId, ...input });
      await repository.createMediaAsset(upload.media);
      await repository.recordAudit({
        workspaceId: creator.workspaceId,
        actorId: creator.userId,
        action: "media.upload_requested",
        targetType: "media_asset",
        targetId: upload.media.id,
        requestId: request.id,
        metadata: { mimeType: upload.media.mimeType, sizeBytes: upload.media.sizeBytes },
      });
      return reply.code(201).send({
        mediaId: upload.media.id,
        uploadUrl: upload.uploadUrl,
        expiresInSeconds: upload.expiresInSeconds,
        scanStatus: upload.media.scanStatus,
      });
    } catch (error) {
      return apiError(
        reply,
        422,
        "VALIDATION_ERROR",
        error instanceof Error ? error.message : "Invalid upload",
        request.id,
      );
    }
  });

  app.post("/v1/media/:id/complete", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = IdParamsSchema.parse(request.params);
    const asset = await repository.getMediaAsset(creator.workspaceId, id);
    if (!asset) return apiError(reply, 404, "NOT_FOUND", "Media not found", request.id);
    try {
      const result = await storage.finalize(asset);
      const updated = await repository.updateMediaAsset(creator.workspaceId, id, result);
      await repository.recordAudit({
        workspaceId: creator.workspaceId,
        actorId: creator.userId,
        action: `media.${result.scanStatus}`,
        targetType: "media_asset",
        targetId: id,
        requestId: request.id,
      });
      metrics.recordMediaFinalization(result.scanStatus);
      return {
        media: {
          id,
          scanStatus: updated?.scanStatus ?? result.scanStatus,
          altText: asset.altText,
        },
        ...(result.scanStatus === "clean"
          ? { downloadUrl: await storage.createDownloadUrl(updated ?? { ...asset, ...result }) }
          : {}),
      };
    } catch (error) {
      metrics.recordMediaFinalization("error");
      request.log.warn({ err: error, mediaId: id }, "media finalization deferred");
      return apiError(
        reply,
        409,
        "CONFLICT",
        "The upload is unavailable or the scanner could not complete; retry shortly",
        request.id,
      );
    }
  });

  app.get("/v1/media/:id", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = IdParamsSchema.parse(request.params);
    const asset = await repository.getMediaAsset(creator.workspaceId, id);
    if (!asset) return apiError(reply, 404, "NOT_FOUND", "Media not found", request.id);
    if (asset.scanStatus !== "clean") {
      return apiError(reply, 409, "CONFLICT", "Media is not available", request.id);
    }
    return {
      media: { id: asset.id, scanStatus: asset.scanStatus, altText: asset.altText },
      downloadUrl: await storage.createDownloadUrl(asset),
    };
  });

  app.get("/v1/sessions/:id/media/:mediaId", async (request, reply) => {
    const { id, mediaId } = SessionMediaParamsSchema.parse(request.params);
    const credential = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const workspaceId = await sessions.authorizeMedia(id, mediaId, credential);
    const asset = await repository.getMediaAsset(workspaceId, mediaId);
    if (!asset || asset.scanStatus !== "clean") {
      return apiError(reply, 404, "NOT_FOUND", "Media not found", request.id);
    }
    return {
      media: { id: asset.id, scanStatus: asset.scanStatus, altText: asset.altText },
      downloadUrl: await storage.createDownloadUrl(asset),
    };
  });

  app.get("/v1/billing/status", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    return creator
      ? {
          billing: await repository.getBillingProfile(creator.workspaceId),
          mode: config.BILLING_MODE,
        }
      : undefined;
  });

  app.post("/v1/billing/checkout", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (!stripe)
      return apiError(
        reply,
        409,
        "CONFLICT",
        "Billing is disabled for this deployment",
        request.id,
      );
    const billing = await repository.getBillingProfile(creator.workspaceId);
    if (
      billing.plan !== "free" ||
      !["free", "canceled", "incomplete_expired"].includes(billing.status)
    ) {
      return apiError(
        reply,
        409,
        "CONFLICT",
        "A subscription already exists for this workspace; use the billing portal",
        request.id,
      );
    }
    const attemptKey = createHash("sha256")
      .update(
        [
          creator.workspaceId,
          billing.customerId ?? "new-customer",
          billing.subscriptionId ?? "first-subscription",
          billing.status,
          config.STRIPE_PRO_PRICE_ID,
        ].join(":"),
      )
      .digest("hex");
    const checkout = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        line_items: [{ price: config.STRIPE_PRO_PRICE_ID!, quantity: 1 }],
        ...(billing.customerId
          ? { customer: billing.customerId }
          : { customer_email: creator.email }),
        client_reference_id: creator.workspaceId,
        metadata: { workspaceId: creator.workspaceId },
        subscription_data: { metadata: { workspaceId: creator.workspaceId } },
        success_url: `${config.WEB_ORIGIN}/dashboard?billing=success`,
        cancel_url: `${config.WEB_ORIGIN}/pricing?billing=cancelled`,
      },
      { idempotencyKey: `openround-pro-${attemptKey}` },
    );
    if (!checkout.url) {
      return apiError(
        reply,
        503,
        "DEPENDENCY_UNAVAILABLE",
        "Stripe did not return a checkout address",
        request.id,
      );
    }
    return { url: checkout.url };
  });

  app.post("/v1/billing/portal", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (!stripe)
      return apiError(
        reply,
        409,
        "CONFLICT",
        "Billing is disabled for this deployment",
        request.id,
      );
    const billing = await repository.getBillingProfile(creator.workspaceId);
    if (!billing.customerId)
      return apiError(reply, 409, "CONFLICT", "No billing customer exists yet", request.id);
    const portal = await stripe.billingPortal.sessions.create({
      customer: billing.customerId,
      return_url: `${config.WEB_ORIGIN}/dashboard`,
    });
    return { url: portal.url };
  });

  app.post("/v1/webhooks/stripe", { config: { rawBody: true } }, async (request, reply) => {
    if (!stripe) return reply.code(204).send();
    const signature = request.headers["stripe-signature"];
    const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
    if (typeof signature !== "string" || !rawBody)
      return apiError(reply, 400, "VALIDATION_ERROR", "Missing Stripe signature", request.id);
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, config.STRIPE_WEBHOOK_SECRET!);
    } catch {
      metrics.recordBillingEvent("unknown", "invalid_signature");
      return apiError(reply, 400, "UNAUTHORIZED", "Invalid Stripe signature", request.id);
    }

    const billingEvent: BillingEventInput = {
      providerEventId: event.id,
      eventType: event.type,
      providerCreatedAt: new Date(event.created * 1_000),
    };
    if (event.type === "checkout.session.completed") {
      const checkout = event.data.object;
      const workspaceId = z.string().uuid().safeParse(checkout.metadata?.workspaceId);
      if (workspaceId.success) {
        Object.assign(billingEvent, {
          workspaceId: workspaceId.data,
          plan: "pro" as const,
          customerId:
            typeof checkout.customer === "string" ? checkout.customer : checkout.customer?.id,
          subscriptionId:
            typeof checkout.subscription === "string"
              ? checkout.subscription
              : checkout.subscription?.id,
          status: "active",
        });
      }
    }
    if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const subscription = event.data.object;
      const workspaceId = z.string().uuid().safeParse(subscription.metadata.workspaceId);
      if (workspaceId.success) {
        const active =
          event.type !== "customer.subscription.deleted" &&
          ["active", "trialing"].includes(subscription.status);
        Object.assign(billingEvent, {
          workspaceId: workspaceId.data,
          plan: active ? ("pro" as const) : ("free" as const),
          customerId:
            typeof subscription.customer === "string"
              ? subscription.customer
              : subscription.customer.id,
          subscriptionId: subscription.id,
          status: subscription.status,
        });
      }
    }
    metrics.observeBillingLag((Date.now() - event.created * 1_000) / 1_000);
    const applied = await repository.applyBillingEvent(billingEvent);
    metrics.recordBillingEvent(event.type, applied ? "applied" : "duplicate");
    return reply.code(204).send();
  });

  app.get("/v1/account/export", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const data = await repository.exportAccount(creator.userId);
    return reply
      .header("content-type", "application/json; charset=utf-8")
      .header(
        "content-disposition",
        `attachment; filename="openround-account-${creator.userId}.json"`,
      )
      .send(data);
  });

  app.delete("/v1/account", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { confirmation } = z.object({ confirmation: z.literal("DELETE") }).parse(request.body);
    void confirmation;
    const sessionIds = await repository.listSessionIds(creator.workspaceId);
    const mediaAssets = await repository.listMediaAssets(creator.workspaceId);
    if (mediaAssets.length > 0 && !storage.configured) {
      return apiError(
        reply,
        503,
        "DEPENDENCY_UNAVAILABLE",
        "Account media could not be removed because object storage is unavailable",
        request.id,
      );
    }
    try {
      for (const asset of mediaAssets) await storage.deleteAsset(asset);
      await sessions.invalidate(sessionIds);
    } catch {
      return apiError(
        reply,
        503,
        "DEPENDENCY_UNAVAILABLE",
        "Account dependencies could not be cleared; the account record was not deleted",
        request.id,
      );
    }
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "account.delete",
      targetType: "account",
      targetId: creator.userId,
      requestId: request.id,
      metadata: { mediaObjectsRemoved: mediaAssets.length },
    });
    await repository.deleteAccount(creator.userId);
    auth.clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.get("/v1/admin/features", async (request, reply) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!config.ADMIN_TOKEN || token !== config.ADMIN_TOKEN)
      return apiError(reply, 401, "UNAUTHORIZED", "Administrator token required", request.id);
    return operationalFeatures();
  });

  app.patch("/v1/admin/features", async (request, reply) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!config.ADMIN_TOKEN || token !== config.ADMIN_TOKEN)
      return apiError(reply, 401, "UNAUTHORIZED", "Administrator token required", request.id);
    const input = OperationalFeaturesUpdateSchema.parse(request.body);
    await repository.updateOperationalFeatures(input, request.id);
    return operationalFeatures();
  });

  app.post("/v1/admin/retention/run", async (request, reply) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!config.ADMIN_TOKEN || token !== config.ADMIN_TOKEN)
      return apiError(reply, 401, "UNAUTHORIZED", "Administrator token required", request.id);
    return retention.run(new Date());
  });

  app.get("/v1/admin/sessions/by-code/:code", async (request, reply) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!config.ADMIN_TOKEN || token !== config.ADMIN_TOKEN)
      return apiError(reply, 401, "UNAUTHORIZED", "Administrator token required", request.id);
    const { code } = z.object({ code: z.string().regex(/^\d{7}$/) }).parse(request.params);
    const session = await repository.getSessionByCode(code);
    if (!session) return apiError(reply, 404, "NOT_FOUND", "Session not found", request.id);
    await repository.recordAudit({
      workspaceId: session.workspaceId,
      actorId: null,
      action: "support.session_lookup",
      targetType: "game_session",
      targetId: session.id,
      requestId: request.id,
    });
    return {
      session: {
        id: session.id,
        code,
        phase: session.state.phase,
        version: session.state.version,
        participantCount: Object.keys(session.state.participants).length,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
    };
  });
}

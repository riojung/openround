import Fastify from "fastify";
import { trace } from "@opentelemetry/api";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import rawBody from "fastify-raw-body";
import type Stripe from "stripe";
import { MemoryRepository, PostgresRepository, type Repository } from "@openround/db";
import { AuthService } from "./auth.js";
import { MemorySessionCache, RedisSessionCache, type SessionCache } from "./cache.js";
import type { AppConfig } from "./config.js";
import { ConsoleMailer, SmtpMailer } from "./mailer.js";
import { ClamAvScanner, type MalwareScanner } from "./malware-scanner.js";
import { MetricsService } from "./metrics.js";
import { originAllowed } from "./origin.js";
import { registerRoutes } from "./routes.js";
import { RetentionService } from "./retention.js";
import { SessionService } from "./session-service.js";
import { StorageService } from "./storage.js";

export async function buildApp(
  config: AppConfig,
  overrides: {
    repository?: Repository;
    cache?: SessionCache;
    scanner?: MalwareScanner | null;
    stripe?: Stripe | null;
    readiness?: () => Promise<void>;
  } = {},
) {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "request.headers.authorization",
          "request.headers.cookie",
          "*.participantToken",
          "*.hostToken",
          "*.token",
          "*.nickname",
          "*.email",
        ],
        censor: "[REDACTED]",
      },
      transport:
        config.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:standard" } }
          : undefined,
    },
    bodyLimit: 128 * 1024,
    requestIdHeader: "x-request-id",
  });

  const repository =
    overrides.repository ??
    (config.DATABASE_URL
      ? new PostgresRepository(config.DATABASE_URL)
      : config.ALLOW_IN_MEMORY || config.NODE_ENV === "test"
        ? new MemoryRepository()
        : (() => {
            throw new Error("DATABASE_URL is required unless ALLOW_IN_MEMORY=true");
          })());
  const metrics = new MetricsService();
  if (repository instanceof PostgresRepository) metrics.bindPostgres(repository.pool);
  if (repository instanceof PostgresRepository && config.RUN_MIGRATIONS) {
    if (config.DATABASE_MIGRATION_URL && config.DATABASE_MIGRATION_URL !== config.DATABASE_URL) {
      const migrationRepository = new PostgresRepository(config.DATABASE_MIGRATION_URL);
      try {
        await migrationRepository.migrate();
      } finally {
        await migrationRepository.close();
      }
    } else {
      await repository.migrate();
    }
  }
  await repository.initialize();

  let cache: SessionCache;
  if (overrides.cache) cache = overrides.cache;
  else if (config.REDIS_URL) {
    const redis = new RedisSessionCache(config.REDIS_URL);
    await redis.connect();
    cache = redis;
  } else cache = new MemorySessionCache();

  await app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "authorization", "x-request-id", "traceparent", "tracestate"],
    exposedHeaders: ["x-request-id", "x-trace-id"],
  });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });
  // Browser tests share one loopback address and deliberately exercise many independent
  // users in a short window. Keep endpoint-specific limits active, but do not let the
  // production-wide IP budget make unrelated end-to-end tests fail each other.
  await app.register(rateLimit, {
    global: true,
    max: config.NODE_ENV === "test" ? 10_000 : 300,
    timeWindow: "1 minute",
  });
  await app.register(rawBody, { field: "rawBody", global: false, encoding: false, runFirst: true });

  app.addHook("preHandler", async (request, reply) => {
    if (
      ["GET", "HEAD", "OPTIONS"].includes(request.method) ||
      request.url.startsWith("/v1/webhooks/stripe")
    )
      return;
    const allowed = originAllowed({
      origin: request.headers.origin,
      host: request.headers.host,
      forwardedProto: request.headers["x-forwarded-proto"],
      encrypted: Boolean((request.raw.socket as { encrypted?: boolean }).encrypted),
      configuredOrigin: config.WEB_ORIGIN,
    });
    if (!allowed) {
      return reply.code(403).send({
        error: {
          code: "UNAUTHORIZED",
          message: "Request origin is not allowed",
          requestId: request.id,
        },
      });
    }
  });

  const mailer = config.SMTP_URL ? new SmtpMailer(config) : new ConsoleMailer();
  const auth = new AuthService(repository, mailer, config);
  const sessions = new SessionService(repository, cache, config, metrics);
  const scanner =
    overrides.scanner !== undefined
      ? overrides.scanner
      : config.MEDIA_SCAN_MODE === "clamav"
        ? new ClamAvScanner(config.CLAMAV_HOST!, config.CLAMAV_PORT, config.CLAMAV_TIMEOUT_MS)
        : null;
  const storage = new StorageService(config, scanner);
  const readiness =
    overrides.readiness ??
    (async () => {
      await Promise.all([
        repository.getOperationalFeatures(),
        cache.get("00000000-0000-0000-0000-000000000000"),
      ]);
    });
  const retention = new RetentionService(
    repository,
    storage,
    config.MEDIA_QUARANTINE_RETENTION_HOURS,
    metrics,
    (sessionIds) => sessions.invalidate(sessionIds),
  );
  const requestStarts = new WeakMap<object, number>();
  app.addHook("onRequest", async (request) => {
    requestStarts.set(request, performance.now());
  });
  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
    const span = trace.getActiveSpan()?.spanContext();
    if (span?.traceId) reply.header("x-trace-id", span.traceId);
  });
  app.addHook("onResponse", async (request, reply) => {
    const startedAt = requestStarts.get(request);
    if (startedAt === undefined) return;
    metrics.observeHttp(
      request.method,
      request.routeOptions.url ?? "unmatched",
      reply.statusCode,
      (performance.now() - startedAt) / 1_000,
    );
  });
  await registerRoutes(app, {
    config,
    repository,
    auth,
    sessions,
    storage,
    retention,
    metrics,
    readiness,
    stripeClient: overrides.stripe,
  });

  app.addHook("onClose", async () => {
    sessions.close();
    await cache.close();
    await repository.close();
  });

  return { app, repository, cache, sessions, storage, retention, metrics };
}

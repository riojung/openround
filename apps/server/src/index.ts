import { loadConfig } from "./config.js";
import { startTelemetry } from "./tracing.js";
import {
  evidenceWorkspaceFeatureEnabled,
  professionalWorkspaceFeatureEnabled,
} from "./workspace-rollout.js";

const config = loadConfig();
const telemetry = startTelemetry(config);
const [{ buildApp }, { attachRealtime }] = await Promise.all([
  import("./app.js"),
  import("./realtime.js"),
]);
const {
  app,
  sessions,
  interactions,
  audienceOutboxWorker,
  retention,
  reportWorker,
  authoringWorker,
  metrics,
  cache,
  presentationService,
} = await buildApp(config);
const realtime = await attachRealtime(app.server, sessions, config, metrics, interactions, {
  service: presentationService,
  consumeAdmission: cache.consumeRateLimit.bind(cache),
  isEnabled: (workspaceId) =>
    professionalWorkspaceFeatureEnabled(config, workspaceId, "presentations") &&
    evidenceWorkspaceFeatureEnabled(config, workspaceId, "presentationRealtime"),
});
const audienceOutboxTimer = setInterval(() => {
  void audienceOutboxWorker
    .runUntilIdle()
    .then((results) => {
      if (results.includes("retry")) app.log.warn("audience outbox delivery will retry");
    })
    .catch((error: unknown) => app.log.error({ err: error }, "audience outbox relay failed"));
}, 250);
audienceOutboxTimer.unref();
const retentionTimer = setInterval(() => {
  void retention
    .run(new Date())
    .then((result) => {
      if (
        result.expiredLiveSessions > 0 ||
        result.purgedSessions > 0 ||
        result.purgedPracticeAssignments > 0 ||
        result.purgedAuditEvents > 0 ||
        result.purgedProductEvents > 0 ||
        result.purgedMedia > 0
      )
        app.log.info(result, "retention purge completed");
      if (result.failedMedia > 0)
        app.log.warn(result, "retention media cleanup requires attention");
    })
    .catch((error: unknown) => app.log.error({ err: error }, "retention purge failed"));
}, config.RETENTION_INTERVAL_MINUTES * 60_000);
retentionTimer.unref();

const reportTimer = setInterval(() => {
  void reportWorker
    .runUntilIdle()
    .then((results) => {
      const completed = results.filter((result) => result === "completed").length;
      if (completed > 0) app.log.info({ completed }, "report generation completed");
      if (results.includes("failed")) app.log.error("report generation exhausted its retries");
    })
    .catch((error: unknown) => app.log.error({ err: error }, "report worker failed"));
}, config.REPORT_WORKER_INTERVAL_MS);
reportTimer.unref();

const authoringTimer = setInterval(() => {
  void authoringWorker
    .runUntilIdle()
    .then((results) => {
      const completed = results.filter((result) => result === "completed").length;
      if (completed > 0) app.log.info({ completed }, "authoring jobs completed");
      if (results.includes("failed")) app.log.warn("an authoring job failed");
    })
    .catch((error: unknown) => app.log.error({ err: error }, "authoring worker failed"));
}, config.AUTHORING_WORKER_INTERVAL_MS);
authoringTimer.unref();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "graceful shutdown started");
  clearInterval(retentionTimer);
  clearInterval(reportTimer);
  clearInterval(authoringTimer);
  clearInterval(audienceOutboxTimer);
  await realtime.close();
  await app.close();
  await telemetry.shutdown();
  process.exit(0);
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: config.HOST, port: config.PORT });

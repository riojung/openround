import { loadConfig } from "./config.js";
import { startTelemetry } from "./tracing.js";

const config = loadConfig();
const telemetry = startTelemetry(config);
const [{ buildApp }, { attachRealtime }] = await Promise.all([
  import("./app.js"),
  import("./realtime.js"),
]);
const { app, sessions, retention, metrics } = await buildApp(config);
const realtime = await attachRealtime(app.server, sessions, config, metrics);
const retentionTimer = setInterval(() => {
  void retention
    .run(new Date())
    .then((result) => {
      if (result.expiredLiveSessions > 0 || result.purgedSessions > 0 || result.purgedMedia > 0)
        app.log.info(result, "retention purge completed");
      if (result.failedMedia > 0)
        app.log.warn(result, "retention media cleanup requires attention");
    })
    .catch((error: unknown) => app.log.error({ err: error }, "retention purge failed"));
}, config.RETENTION_INTERVAL_MINUTES * 60_000);
retentionTimer.unref();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "graceful shutdown started");
  clearInterval(retentionTimer);
  await realtime.close();
  await app.close();
  await telemetry.shutdown();
  process.exit(0);
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: config.HOST, port: config.PORT });

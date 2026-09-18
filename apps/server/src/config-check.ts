import { loadConfig } from "./config.js";

const config = loadConfig();

const summary = {
  valid: true,
  nodeEnvironment: config.NODE_ENV,
  publicApiUrl: config.PUBLIC_API_URL,
  webOrigin: config.WEB_ORIGIN,
  communityMode: config.COMMUNITY_MODE,
  persistence: config.DATABASE_URL ? "postgresql" : "memory",
  coordination: config.REDIS_URL ? "redis-streams" : "process-local",
  email: config.SMTP_URL ? "smtp" : "disabled",
  billing: config.BILLING_MODE,
  media: config.S3_ENDPOINT ? config.MEDIA_SCAN_MODE : "disabled",
  metrics: config.METRICS_ENABLED
    ? config.METRICS_TOKEN
      ? "protected"
      : "unprotected"
    : "disabled",
  tracing: config.TRACING_ENABLED ? "otlp" : "disabled",
  participantLimit: config.MAX_SESSION_PARTICIPANTS,
  featureFlags: {
    signups: config.FEATURE_SIGNUPS,
    sessionCreation: config.FEATURE_SESSION_CREATION,
    mediaUploads: config.FEATURE_MEDIA_UPLOADS,
    roundExperiences: config.FEATURE_ROUND_EXPERIENCES,
    audiencePulse: config.FEATURE_AUDIENCE_PULSE,
    roomChat: config.FEATURE_ROOM_CHAT,
  },
  themedInteractionsWorkspaceAllowlistSize: config.THEMED_INTERACTIONS_WORKSPACE_ALLOWLIST.length,
};

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

import { isIP } from "node:net";
import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const defaultTrueBooleanString = z
  .enum(["true", "false"])
  .default("true")
  .transform((value) => value === "true");

function isPrivateHttpUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:") return false;
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    return true;
  }
  if (isIP(hostname) === 4) {
    const [first = 0, second = 0] = hostname.split(".").map(Number);
    return (
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }
  if (isIP(hostname) === 6) {
    return hostname === "::1" || /^(?:fc|fd|fe[89ab])/.test(hostname);
  }
  return false;
}

function isLoopbackHttpUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:") return false;
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (isIP(hostname) === 4) return hostname.split(".").map(Number)[0] === 127;
  return isIP(hostname) === 6 && hostname === "::1";
}

export const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
    PUBLIC_API_URL: z.string().url().default("http://localhost:4000"),
    COOKIE_NAME: z.string().default("openround_creator"),
    COOKIE_DOMAIN: z.string().optional(),
    COOKIE_SECURE: z.enum(["auto", "true", "false"]).default("auto"),
    ALLOW_INSECURE_LOCAL_HTTP: booleanString,
    DATABASE_URL: z.string().min(1).optional(),
    DATABASE_MIGRATION_URL: z.string().min(1).optional(),
    REDIS_URL: z.string().min(1).optional(),
    SESSION_MUTATION_LEASE_TTL_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
    SESSION_MUTATION_LEASE_WAIT_MS: z.coerce.number().int().min(100).max(15_000).default(5_000),
    RUN_MIGRATIONS: booleanString,
    ALLOW_IN_MEMORY: booleanString,
    COMMUNITY_MODE: booleanString,
    MAX_SESSION_PARTICIPANTS: z.coerce.number().int().min(1).max(250).default(100),
    RETENTION_INTERVAL_MINUTES: z.coerce.number().int().min(5).max(1_440).default(60),
    COMMUNITY_REPORT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3_650).default(365),
    MEDIA_QUARANTINE_RETENTION_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    FEATURE_SIGNUPS: defaultTrueBooleanString,
    FEATURE_SESSION_CREATION: defaultTrueBooleanString,
    FEATURE_MEDIA_UPLOADS: defaultTrueBooleanString,
    METRICS_ENABLED: defaultTrueBooleanString,
    METRICS_TOKEN: z.string().min(24).optional(),
    TRACING_ENABLED: booleanString,
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: z.string().url().optional(),
    OTEL_SERVICE_NAME: z.string().trim().min(1).max(120).default("openround-server"),
    OTEL_SERVICE_VERSION: z.string().trim().min(1).max(80).default("0.1.0"),
    SMTP_URL: z.string().min(1).optional(),
    EMAIL_FROM: z.string().default("OpenRound <noreply@localhost>"),
    AUTH_DEBUG_MAGIC_LINKS: booleanString,
    POLICY_VERSION: z.string().trim().min(1).max(80).default("2026-09-14-draft"),
    BILLING_MODE: z.enum(["disabled", "stripe"]).default("disabled"),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_PRO_PRICE_ID: z.string().optional(),
    S3_ENDPOINT: z.string().url().optional(),
    S3_PUBLIC_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().default("ca-central-1"),
    S3_BUCKET: z.string().default("openround-media"),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: booleanString,
    MEDIA_SCAN_MODE: z.enum(["disabled", "clamav"]).default("disabled"),
    CLAMAV_HOST: z.string().min(1).optional(),
    CLAMAV_PORT: z.coerce.number().int().min(1).max(65_535).default(3310),
    CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
    ADMIN_TOKEN: z.string().min(24).optional(),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
  })
  .superRefine((config, ctx) => {
    const requireHttps = (key: "WEB_ORIGIN" | "PUBLIC_API_URL" | "S3_PUBLIC_ENDPOINT") => {
      const value = config[key];
      if (value && new URL(value).protocol !== "https:") {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Must use HTTPS in production",
        });
      }
    };

    if (config.NODE_ENV === "production" && !config.DATABASE_URL) {
      ctx.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "Required in production" });
    }
    if (config.NODE_ENV === "production" && !config.REDIS_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["REDIS_URL"],
        message: "Required in production for distributed session mutation coordination",
      });
    }
    if (config.SESSION_MUTATION_LEASE_WAIT_MS >= config.SESSION_MUTATION_LEASE_TTL_MS) {
      ctx.addIssue({
        code: "custom",
        path: ["SESSION_MUTATION_LEASE_WAIT_MS"],
        message: "Must be shorter than SESSION_MUTATION_LEASE_TTL_MS",
      });
    }
    if (config.RUN_MIGRATIONS && !config.DATABASE_MIGRATION_URL && !config.DATABASE_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["DATABASE_MIGRATION_URL"],
        message: "A database connection is required to run migrations",
      });
    }
    if (config.NODE_ENV === "production" && config.ALLOW_IN_MEMORY) {
      ctx.addIssue({
        code: "custom",
        path: ["ALLOW_IN_MEMORY"],
        message: "Forbidden in production",
      });
    }
    if (config.NODE_ENV === "production") {
      const usesLocalWebHttp = [config.WEB_ORIGIN, config.PUBLIC_API_URL].some(
        (value) => new URL(value).protocol === "http:",
      );
      if (config.ALLOW_INSECURE_LOCAL_HTTP) {
        if (!config.COMMUNITY_MODE || config.BILLING_MODE !== "disabled") {
          ctx.addIssue({
            code: "custom",
            path: ["ALLOW_INSECURE_LOCAL_HTTP"],
            message: "Only allowed for non-billing community deployments",
          });
        }
        for (const key of ["WEB_ORIGIN", "PUBLIC_API_URL", "S3_PUBLIC_ENDPOINT"] as const) {
          const value = config[key];
          if (value && new URL(value).protocol !== "https:" && !isPrivateHttpUrl(value)) {
            ctx.addIssue({
              code: "custom",
              path: [key],
              message: "Insecure local HTTP is limited to loopback or private-network URLs",
            });
          }
        }
        const usesAnyLocalHttp = [
          config.WEB_ORIGIN,
          config.PUBLIC_API_URL,
          config.S3_PUBLIC_ENDPOINT,
        ].some((value) => value && new URL(value).protocol === "http:");
        if (!usesAnyLocalHttp) {
          ctx.addIssue({
            code: "custom",
            path: ["ALLOW_INSECURE_LOCAL_HTTP"],
            message: "Must remain disabled when every public URL uses HTTPS",
          });
        }
        if (usesLocalWebHttp && config.COOKIE_SECURE !== "false") {
          ctx.addIssue({
            code: "custom",
            path: ["COOKIE_SECURE"],
            message: "Must be false for an insecure local HTTP profile",
          });
        }
      } else {
        requireHttps("WEB_ORIGIN");
        requireHttps("PUBLIC_API_URL");
        requireHttps("S3_PUBLIC_ENDPOINT");
      }
      if (!config.ALLOW_INSECURE_LOCAL_HTTP && config.COOKIE_SECURE === "false") {
        ctx.addIssue({
          code: "custom",
          path: ["COOKIE_SECURE"],
          message: "Cannot be false in production",
        });
      }
      if (config.FEATURE_SIGNUPS && !config.SMTP_URL) {
        ctx.addIssue({
          code: "custom",
          path: ["SMTP_URL"],
          message: "Required when production sign-ups are enabled",
        });
      }
      if (
        config.METRICS_ENABLED &&
        !config.METRICS_TOKEN &&
        !(config.ALLOW_INSECURE_LOCAL_HTTP && usesLocalWebHttp)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["METRICS_TOKEN"],
          message: "Required when production metrics are enabled",
        });
      }
    }
    if (
      config.AUTH_DEBUG_MAGIC_LINKS &&
      config.NODE_ENV === "production" &&
      (!config.COMMUNITY_MODE ||
        config.BILLING_MODE !== "disabled" ||
        !config.ALLOW_INSECURE_LOCAL_HTTP ||
        !isLoopbackHttpUrl(config.WEB_ORIGIN) ||
        !isLoopbackHttpUrl(config.PUBLIC_API_URL))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_DEBUG_MAGIC_LINKS"],
        message:
          "Production debug links are limited to non-billing community deployments on loopback HTTP origins",
      });
    }
    if (config.BILLING_MODE === "stripe") {
      for (const key of [
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET",
        "STRIPE_PRO_PRICE_ID",
      ] as const) {
        if (!config[key])
          ctx.addIssue({ code: "custom", path: [key], message: "Required for Stripe billing" });
      }
    }
    if (config.MEDIA_SCAN_MODE === "clamav" && (!config.CLAMAV_HOST || !config.S3_ENDPOINT)) {
      ctx.addIssue({
        code: "custom",
        path: ["MEDIA_SCAN_MODE"],
        message: "ClamAV media scanning requires CLAMAV_HOST and S3_ENDPOINT",
      });
    }
    if (config.TRACING_ENABLED && !config.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) {
      ctx.addIssue({
        code: "custom",
        path: ["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"],
        message: "Required when distributed tracing is enabled",
      });
    }
  });

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return ConfigSchema.parse(environment);
}

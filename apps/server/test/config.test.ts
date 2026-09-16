import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../src/config.js";

const productionConfig = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://app:secret@database.internal/openround",
  REDIS_URL: "rediss://cache.internal:6380",
  WEB_ORIGIN: "https://quiz.example.ca",
  PUBLIC_API_URL: "https://api.example.ca",
  COOKIE_SECURE: "true",
  FEATURE_SIGNUPS: "false",
  METRICS_TOKEN: "metrics-token-at-least-24-characters",
} as const;

describe("production configuration", () => {
  it("accepts a secure profile with sign-ups paused", () => {
    const config = ConfigSchema.parse(productionConfig);

    expect(config.FEATURE_SIGNUPS).toBe(false);
    expect(config.COOKIE_SECURE).toBe("true");
  });

  it("requires SMTP before production sign-ups can be enabled", () => {
    expect(() => ConfigSchema.parse({ ...productionConfig, FEATURE_SIGNUPS: "true" })).toThrow(
      /Required when production sign-ups are enabled/,
    );

    expect(
      ConfigSchema.parse({
        ...productionConfig,
        FEATURE_SIGNUPS: "true",
        SMTP_URL: "smtps://mailer.example.ca:465",
      }).FEATURE_SIGNUPS,
    ).toBe(true);
  });

  it("requires authentication before production metrics can be enabled", () => {
    expect(() => ConfigSchema.parse({ ...productionConfig, METRICS_TOKEN: undefined })).toThrow(
      /Required when production metrics are enabled/,
    );

    expect(
      ConfigSchema.parse({
        ...productionConfig,
        METRICS_ENABLED: "false",
        METRICS_TOKEN: undefined,
      }).METRICS_ENABLED,
    ).toBe(false);
  });

  it.each(["WEB_ORIGIN", "PUBLIC_API_URL", "S3_PUBLIC_ENDPOINT"] as const)(
    "requires HTTPS for %s",
    (key) => {
      expect(() =>
        ConfigSchema.parse({ ...productionConfig, [key]: "http://public.example.ca" }),
      ).toThrow(/Must use HTTPS in production/);
    },
  );

  it("rejects an explicitly insecure production cookie", () => {
    expect(() => ConfigSchema.parse({ ...productionConfig, COOKIE_SECURE: "false" })).toThrow(
      /Cannot be false in production/,
    );
  });

  it("allows an explicit private-network HTTP community profile", () => {
    const config = ConfigSchema.parse({
      ...productionConfig,
      WEB_ORIGIN: "http://192.168.1.20:8080",
      PUBLIC_API_URL: "http://192.168.1.20:8080",
      S3_PUBLIC_ENDPOINT: "http://192.168.1.20:9000",
      COOKIE_SECURE: "false",
      COMMUNITY_MODE: "true",
      ALLOW_INSECURE_LOCAL_HTTP: "true",
      SMTP_URL: "smtp://mailpit:1025",
      FEATURE_SIGNUPS: "true",
    });

    expect(config.ALLOW_INSECURE_LOCAL_HTTP).toBe(true);
  });

  it("does not let the local HTTP escape hatch weaken a hosted or public deployment", () => {
    const localOverride = {
      ...productionConfig,
      COOKIE_SECURE: "false",
      COMMUNITY_MODE: "true",
      ALLOW_INSECURE_LOCAL_HTTP: "true",
    } as const;

    expect(() =>
      ConfigSchema.parse({
        ...localOverride,
        WEB_ORIGIN: "http://quiz.example.ca",
        PUBLIC_API_URL: "http://api.example.ca",
      }),
    ).toThrow(/limited to loopback or private-network URLs/);
    expect(() =>
      ConfigSchema.parse({
        ...localOverride,
        WEB_ORIGIN: "http://localhost:8080",
        PUBLIC_API_URL: "http://localhost:8080",
        BILLING_MODE: "stripe",
        STRIPE_SECRET_KEY: "secret",
        STRIPE_WEBHOOK_SECRET: "webhook-secret",
        STRIPE_PRO_PRICE_ID: "price-pro",
      }),
    ).toThrow(/Only allowed for non-billing community deployments/);
    expect(() =>
      ConfigSchema.parse({
        ...productionConfig,
        COMMUNITY_MODE: "true",
        ALLOW_INSECURE_LOCAL_HTTP: "true",
      }),
    ).toThrow(/Must remain disabled when every public URL uses HTTPS/);
  });

  it("keeps local non-production profiles available", () => {
    expect(
      ConfigSchema.parse({
        ...productionConfig,
        NODE_ENV: "development",
        WEB_ORIGIN: "http://localhost:8080",
        PUBLIC_API_URL: "http://localhost:8080",
        COOKIE_SECURE: "false",
        FEATURE_SIGNUPS: "true",
      }).NODE_ENV,
    ).toBe("development");
  });
});

import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../src/config.js";
import { entitlementsFor, retentionExpiry } from "../src/entitlements.js";

describe("plan entitlements", () => {
  it("applies hosted Free and Pro limits from one policy", () => {
    const config = ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
    });
    expect(entitlementsFor("free", config)).toEqual({
      plan: "free",
      maxParticipants: 20,
      maxPublishedQuizzes: 5,
      reportRetentionDays: 30,
      csvExport: false,
      brandTheme: false,
      followups: false,
      authoringJobsPerMonth: 3,
    });
    expect(entitlementsFor("pro", config)).toEqual({
      plan: "pro",
      maxParticipants: 100,
      maxPublishedQuizzes: null,
      reportRetentionDays: 365,
      csvExport: true,
      brandTheme: true,
      followups: true,
      authoringJobsPerMonth: 100,
    });
  });

  it("keeps community features ungated while respecting operator limits", () => {
    const config = ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "true",
      MAX_SESSION_PARTICIPANTS: 72,
      COMMUNITY_REPORT_RETENTION_DAYS: 730,
    });
    const entitlements = entitlementsFor("free", config);
    expect(entitlements).toEqual({
      plan: "team",
      maxParticipants: 72,
      maxPublishedQuizzes: null,
      reportRetentionDays: 730,
      csvExport: true,
      brandTheme: true,
      followups: true,
      authoringJobsPerMonth: null,
    });
    expect(retentionExpiry(new Date("2026-01-01T00:00:00.000Z"), entitlements).toISOString()).toBe(
      "2028-01-01T00:00:00.000Z",
    );
  });
});

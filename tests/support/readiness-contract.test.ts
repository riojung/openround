import { describe, expect, it } from "vitest";
import {
  assertSecureReadinessUrl,
  optionalImmutableBuildId,
  requiredBillingMode,
  requiredBoolean,
  requiredCookiePair,
  requiredImmutableBuildId,
} from "./readiness-contract.js";

describe("remote readiness input contract", () => {
  it("requires explicit booleans instead of treating omitted expectations as optional", () => {
    expect(() => requiredBoolean({}, "EXPECTED_FLAG")).toThrow("EXPECTED_FLAG is required");
    expect(() => requiredBoolean({ EXPECTED_FLAG: "yes" }, "EXPECTED_FLAG")).toThrow(
      "EXPECTED_FLAG must be true or false",
    );
    expect(requiredBoolean({ EXPECTED_FLAG: "false" }, "EXPECTED_FLAG")).toBe(false);
  });

  it("accepts only supported billing modes and immutable build identifiers", () => {
    expect(requiredBillingMode({ BILLING: "stripe" }, "BILLING")).toBe("stripe");
    expect(() => requiredBillingMode({ BILLING: "test" }, "BILLING")).toThrow(
      "BILLING must be disabled or stripe",
    );

    const commit = "a".repeat(40);
    const digest = `sha256:${"b".repeat(64)}`;
    expect(requiredImmutableBuildId({ BUILD: commit }, "BUILD")).toBe(commit);
    expect(requiredImmutableBuildId({ BUILD: digest }, "BUILD")).toBe(digest);
    expect(() => requiredImmutableBuildId({ BUILD: "latest" }, "BUILD")).toThrow(
      "BUILD must be an immutable Git commit or sha256 digest",
    );
    expect(optionalImmutableBuildId({}, "BUILD")).toBeNull();
    expect(optionalImmutableBuildId({ BUILD: commit }, "BUILD")).toBe(commit);
  });

  it("accepts one synthetic-account cookie pair without exposing its value in errors", () => {
    expect(requiredCookiePair({ COOKIE: "openround_creator=token-value" }, "COOKIE")).toBe(
      "openround_creator=token-value",
    );
    const secret = "first=one; second=two";
    let error: unknown;
    try {
      requiredCookiePair({ COOKIE: secret }, "COOKIE");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("COOKIE must be one cookie pair");
    expect(String(error)).not.toContain(secret);
    expect(() => requiredCookiePair({ COOKIE: "secret-value" }, "COOKIE")).toThrow(
      "COOKIE must be one cookie pair",
    );
  });

  it("limits the HTTP escape hatch to loopback development targets", () => {
    expect(() => assertSecureReadinessUrl(new URL("https://staging.example"), false)).not.toThrow();
    expect(() => assertSecureReadinessUrl(new URL("http://localhost:8080"), true)).not.toThrow();
    expect(() => assertSecureReadinessUrl(new URL("http://127.0.0.1:8080"), true)).not.toThrow();
    expect(() => assertSecureReadinessUrl(new URL("http://[::1]:8080"), true)).not.toThrow();
    expect(() => assertSecureReadinessUrl(new URL("http://staging.example"), true)).toThrow(
      "READINESS_ALLOW_HTTP is limited to loopback development targets",
    );
    expect(() => assertSecureReadinessUrl(new URL("http://localhost:8080"), false)).toThrow(
      "must use HTTPS",
    );
  });
});

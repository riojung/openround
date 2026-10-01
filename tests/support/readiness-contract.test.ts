import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertSecureReadinessUrl,
  deploymentReceiptBinding,
  optionalImmutableBuildId,
  requiredBillingMode,
  requiredBoolean,
  requiredCookiePair,
  requiredImmutableBuildId,
  requiredObserverToken,
  requiredObserverUrl,
  requiredProbeEmail,
  validateObjectStoreError,
  validateObserverReceipt,
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

  it("requires HTTPS credential-free observer endpoints and opaque bearer tokens", () => {
    expect(
      requiredObserverUrl({ URL: "https://observer.openround.ca/v1/receipts" }, "URL").href,
    ).toBe("https://observer.openround.ca/v1/receipts");
    for (const value of [
      "http://observer.example.test/v1/receipts",
      "https://user:password@observer.example.test/v1/receipts",
      "https://observer.example.test/v1/receipts?token=secret",
      "https://observer.example.test/v1/receipts#secret",
      "https://127.0.0.1/v1/receipts",
      "https://10.0.0.1/v1/receipts",
      "https://100.64.0.1/v1/receipts",
      "https://192.0.2.1/v1/receipts",
      "https://198.18.0.1/v1/receipts",
      "https://198.51.100.1/v1/receipts",
      "https://203.0.113.1/v1/receipts",
      "https://[2001:db8::1]/v1/receipts",
      "https://[ff02::1]/v1/receipts",
      "https://[::ffff:127.0.0.1]/v1/receipts",
      "https://observer.openround.ca./v1/receipts",
      "https://observer.local/v1/receipts",
      "https://observer.ops.internal/v1/receipts",
      "https://observer.example.com/v1/receipts",
      "https://observer.example.net/v1/receipts",
      "https://observer.example.org/v1/receipts",
    ]) {
      expect(() => requiredObserverUrl({ URL: value }, "URL")).toThrow();
    }
    expect(requiredObserverToken({ TOKEN: "a".repeat(24) }, "TOKEN")).toBe("a".repeat(24));
    expect(() => requiredObserverToken({ TOKEN: "short" }, "TOKEN")).toThrow(
      "TOKEN has an invalid length",
    );
    expect(() => requiredObserverToken({ TOKEN: `${"a".repeat(24)}\nleak` }, "TOKEN")).toThrow(
      "TOKEN contains invalid characters",
    );
  });

  it("accepts a dedicated SMTP probe address without echoing invalid input", () => {
    expect(requiredProbeEmail({ EMAIL: "Readiness@Example.test" }, "EMAIL")).toBe(
      "readiness@example.test",
    );
    const secret = "not-an-email-secret";
    expect(() => requiredProbeEmail({ EMAIL: secret }, "EMAIL")).toThrow(
      "EMAIL must be a valid email",
    );
    try {
      requiredProbeEmail({ EMAIL: secret }, "EMAIL");
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it("accepts only build-bound, fresh, redaction-safe observer receipts", () => {
    const buildId = "a".repeat(40);
    const notBefore = new Date();
    const observedAt = new Date().toISOString();
    const smtp = {
      schemaVersion: 1,
      kind: "smtp",
      observed: true,
      candidateBuildId: buildId,
      probeId: "11111111-1111-4111-8111-111111111111",
      probeSha256: "c".repeat(64),
      receiptId: "smtp-receipt-123",
      observedAt,
    };
    const expectedProbe = { probeId: smtp.probeId, probeSha256: smtp.probeSha256 };
    expect(validateObserverReceipt(smtp, "smtp", buildId, notBefore, expectedProbe)).toEqual({
      ...expectedProbe,
      receiptId: "smtp-receipt-123",
      observedAt,
    });
    const telemetry = {
      ...smtp,
      kind: "telemetry",
      receiptId: "telemetry-receipt-123",
      traceObserved: true,
      metricsObserved: true,
      logsObserved: true,
    };
    expect(
      validateObserverReceipt(telemetry, "telemetry", buildId, notBefore, expectedProbe),
    ).toMatchObject({ traceObserved: true, metricsObserved: true, logsObserved: true });
    expect(() =>
      validateObserverReceipt(
        { ...telemetry, logsObserved: false },
        "telemetry",
        buildId,
        notBefore,
        expectedProbe,
      ),
    ).toThrow("did not confirm request logs");
    expect(() =>
      validateObserverReceipt(
        { ...smtp, observerUrl: "https://secret.example" },
        "smtp",
        buildId,
        notBefore,
        expectedProbe,
      ),
    ).toThrow("unexpected field set");
    expect(() =>
      validateObserverReceipt(
        { ...smtp, candidateBuildId: "b".repeat(40) },
        "smtp",
        buildId,
        notBefore,
        expectedProbe,
      ),
    ).toThrow("build mismatch");
    expect(() =>
      validateObserverReceipt(
        { ...smtp, probeSha256: "d".repeat(64) },
        "smtp",
        buildId,
        notBefore,
        expectedProbe,
      ),
    ).toThrow("probe hash mismatch");
  });

  it("requires exact object-store privacy and deletion errors instead of generic failures", () => {
    const xml = (code: string) =>
      `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code></Error>`;
    expect(
      validateObjectStoreError(
        403,
        "application/xml",
        xml("AccessDenied"),
        403,
        "AccessDenied",
        "unsigned media",
      ),
    ).toBe("AccessDenied");
    expect(
      validateObjectStoreError(
        404,
        "application/xml; charset=utf-8",
        xml("NoSuchKey"),
        404,
        "NoSuchKey",
        "deleted media",
      ),
    ).toBe("NoSuchKey");
    expect(() =>
      validateObjectStoreError(
        503,
        "application/xml",
        xml("AccessDenied"),
        403,
        "AccessDenied",
        "unsigned media",
      ),
    ).toThrow("unexpected status");
    expect(() =>
      validateObjectStoreError(404, "text/html", "not found", 404, "NoSuchKey", "deleted media"),
    ).toThrow("object-store error format");
  });

  it("projects exact deployment manifest and image bindings without receipt infrastructure data", () => {
    const buildId = "a".repeat(40);
    const imageRepository = "ghcr.io/example/openround";
    const receipt = {
      schemaVersion: 2,
      environment: "staging",
      buildId,
      operation: "deploy",
      manifest: "artifacts/deploy/staging/build-manifest.json",
      manifestSha256: "b".repeat(64),
      images: {
        server: `${imageRepository}-server@sha256:${"c".repeat(64)}`,
        web: `${imageRepository}-web@sha256:${"d".repeat(64)}`,
      },
      singleVm: { host: "private-host.example.test", projectName: "openround-staging" },
      configuration: {
        runtimeEnvironmentSha256: "e".repeat(64),
        summary: {
          buildId,
          metrics: "protected",
          logs: "external-host-agent",
          tracing: "otlp",
        },
      },
      operations: { commit: buildId, files: {} },
    };
    const receiptSource = JSON.stringify(receipt);
    const binding = deploymentReceiptBinding(receiptSource, buildId, imageRepository);
    expect(binding).toEqual({
      receiptSchemaVersion: 2,
      receiptSha256: `sha256:${createHash("sha256").update(receiptSource).digest("hex")}`,
      sourceAuthenticity: "external-review-required",
      manifestSha256: "b".repeat(64),
      serverImageDigest: `sha256:${"c".repeat(64)}`,
      webImageDigest: `sha256:${"d".repeat(64)}`,
      runtimeEnvironmentSha256: "e".repeat(64),
    });
    expect(JSON.stringify(binding)).not.toContain("private-host.example.test");
    expect(() =>
      deploymentReceiptBinding(
        JSON.stringify({ ...receipt, buildId: "f".repeat(40) }),
        buildId,
        imageRepository,
      ),
    ).toThrow("build mismatch");
    expect(() =>
      deploymentReceiptBinding(
        JSON.stringify({
          ...receipt,
          images: {
            ...receipt.images,
            server: `ghcr.io/attacker/server@sha256:${"c".repeat(64)}`,
          },
        }),
        buildId,
        imageRepository,
      ),
    ).toThrow("reviewed repository");
  });
});

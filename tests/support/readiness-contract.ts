import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { isIP } from "node:net";

const immutableBuildIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64}|sha256:[0-9a-f]{64})$/;
const loopbackHostnames = new Set(["localhost", "127.0.0.1", "[::1]"]);
const sha256Pattern = /^[0-9a-f]{64}$/;
const receiptIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const probeEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function reservedObserverHostname(hostname: string) {
  if (hostname.endsWith(".")) return true;
  const normalized = hostname.toLocaleLowerCase("en-CA").replace(/^\[|\]$/g, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".example") ||
    normalized.endsWith(".invalid") ||
    normalized.endsWith(".test") ||
    ["example.com", "example.net", "example.org"].some(
      (exampleHostname) =>
        normalized === exampleHostname || normalized.endsWith(`.${exampleHostname}`),
    )
  ) {
    return true;
  }
  if (isIP(normalized) === 4) {
    const [first = 0, second = 0, third = 0] = normalized.split(".").map(Number);
    return (
      first === 0 ||
      first === 10 ||
      (first === 100 && second >= 64 && second <= 127) ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 0) ||
      (first === 192 && second === 168) ||
      (first === 192 && second === 88 && third === 99) ||
      (first === 198 && (second === 18 || second === 19)) ||
      (first === 198 && second === 51 && third === 100) ||
      (first === 203 && second === 0 && third === 113) ||
      first >= 224
    );
  }
  return (
    isIP(normalized) === 6 &&
    (normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("::ffff:") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("ff") ||
      normalized.startsWith("100:") ||
      normalized.startsWith("2001:0:") ||
      normalized.startsWith("2001:2:") ||
      normalized.startsWith("2001:10:") ||
      normalized.startsWith("2001:20:") ||
      normalized.startsWith("2001:db8:") ||
      normalized.startsWith("3fff:"))
  );
}

export function requiredEnvironmentString(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  assert.ok(value, `${name} is required`);
  return value;
}

export function requiredBoolean(environment: NodeJS.ProcessEnv, name: string): boolean {
  const value = requiredEnvironmentString(environment, name);
  assert.ok(value === "true" || value === "false", `${name} must be true or false`);
  return value === "true";
}

export function requiredBillingMode(
  environment: NodeJS.ProcessEnv,
  name: string,
): "disabled" | "stripe" {
  const value = requiredEnvironmentString(environment, name);
  assert.ok(value === "disabled" || value === "stripe", `${name} must be disabled or stripe`);
  return value;
}

export function requiredImmutableBuildId(environment: NodeJS.ProcessEnv, name: string): string {
  const value = requiredEnvironmentString(environment, name);
  assert.match(
    value,
    immutableBuildIdPattern,
    `${name} must be an immutable Git commit or sha256 digest`,
  );
  return value;
}

export function optionalImmutableBuildId(
  environment: NodeJS.ProcessEnv,
  name: string,
): string | null {
  return environment[name]?.trim() ? requiredImmutableBuildId(environment, name) : null;
}

export function requiredCookiePair(environment: NodeJS.ProcessEnv, name: string): string {
  const value = requiredEnvironmentString(environment, name);
  assert.ok(value.length <= 4_096, `${name} is too long`);
  assert.ok(!/[\r\n]/.test(value), `${name} must not contain line breaks`);
  assert.ok(
    /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+=[^\s;]+$/.test(value),
    `${name} must be one cookie pair`,
  );
  return value;
}

export function requiredObserverUrl(environment: NodeJS.ProcessEnv, name: string): URL {
  const value = requiredEnvironmentString(environment, name);
  assert.ok(value.length <= 2_048, `${name} is too long`);
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    assert.fail(`${name} must be a valid HTTPS URL`);
  }
  assert.equal(target.protocol, "https:", `${name} must use HTTPS`);
  assert.ok(!target.username && !target.password, `${name} must not contain credentials`);
  assert.equal(target.search, "", `${name} must not contain a query`);
  assert.equal(target.hash, "", `${name} must not contain a fragment`);
  assert.equal(
    reservedObserverHostname(target.hostname),
    false,
    `${name} must not use a reserved, placeholder, loopback, or private literal host`,
  );
  return target;
}

export function requiredObserverToken(environment: NodeJS.ProcessEnv, name: string): string {
  const value = requiredEnvironmentString(environment, name);
  assert.ok(value.length >= 24 && value.length <= 4_096, `${name} has an invalid length`);
  assert.match(value, /^[\x21-\x7e]+$/, `${name} contains invalid characters`);
  return value;
}

export function requiredProbeEmail(environment: NodeJS.ProcessEnv, name: string): string {
  const value = requiredEnvironmentString(environment, name).toLocaleLowerCase("en-CA");
  assert.ok(value.length <= 320 && probeEmailPattern.test(value), `${name} must be a valid email`);
  assert.ok(
    [...value].every((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    }),
    `${name} contains invalid characters`,
  );
  return value;
}

export function validateObjectStoreError(
  status: number,
  contentType: string | null,
  source: string,
  expectedStatus: number,
  expectedCode: "AccessDenied" | "NoSuchKey",
  label: string,
) {
  assert.equal(status, expectedStatus, `${label} returned an unexpected status`);
  assert.match(
    contentType ?? "",
    /^application\/xml(?:;|$)/i,
    `${label} did not return the object-store error format`,
  );
  assert.ok(
    source.length > 0 && source.length <= 16_384,
    `${label} returned an invalid object-store error`,
  );
  const code = source.match(/<Code>([A-Za-z]+)<\/Code>/)?.[1];
  assert.equal(code, expectedCode, `${label} returned the wrong object-store error`);
  return expectedCode;
}

type ObserverKind = "smtp" | "telemetry";

function exactObject(value: unknown, keys: string[], label: string): Record<string, unknown> {
  assert.ok(
    value && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  );
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert.equal(
    actual.length === expected.length && actual.every((key, index) => key === expected[index]),
    true,
    `${label} contains an unexpected field set`,
  );
  return value as Record<string, unknown>;
}

export function validateObserverReceipt(
  value: unknown,
  kind: ObserverKind,
  expectedBuildId: string,
  notBefore: Date,
  expectedProbe: { probeId: string; probeSha256: string },
) {
  assert.match(expectedProbe.probeId, receiptIdPattern, `${kind} expected probe ID is invalid`);
  assert.match(expectedProbe.probeSha256, sha256Pattern, `${kind} expected probe hash is invalid`);
  const commonKeys = [
    "schemaVersion",
    "kind",
    "observed",
    "candidateBuildId",
    "probeId",
    "probeSha256",
    "receiptId",
    "observedAt",
  ];
  const receipt = exactObject(
    value,
    kind === "telemetry"
      ? [...commonKeys, "traceObserved", "metricsObserved", "logsObserved"]
      : commonKeys,
    `${kind} observer receipt`,
  );
  assert.equal(receipt.schemaVersion, 1, `${kind} observer receipt schemaVersion must be 1`);
  assert.equal(receipt.kind, kind, `${kind} observer receipt kind mismatch`);
  assert.equal(receipt.observed, true, `${kind} observer did not confirm delivery`);
  assert.equal(
    receipt.candidateBuildId,
    expectedBuildId,
    `${kind} observer receipt build mismatch`,
  );
  assert.equal(
    receipt.probeId,
    expectedProbe.probeId,
    `${kind} observer receipt probe ID mismatch`,
  );
  assert.equal(
    receipt.probeSha256,
    expectedProbe.probeSha256,
    `${kind} observer receipt probe hash mismatch`,
  );
  assert.equal(typeof receipt.receiptId, "string", `${kind} observer receiptId must be a string`);
  assert.match(
    receipt.receiptId as string,
    receiptIdPattern,
    `${kind} observer receiptId must be an opaque identifier`,
  );
  assert.equal(typeof receipt.observedAt, "string", `${kind} observedAt must be a string`);
  const observedAt = new Date(receipt.observedAt as string);
  assert.ok(Number.isFinite(observedAt.getTime()), `${kind} observedAt must be an ISO timestamp`);
  assert.equal(
    observedAt.toISOString(),
    receipt.observedAt,
    `${kind} observedAt must be a normalized UTC timestamp`,
  );
  assert.ok(
    observedAt.getTime() >= notBefore.getTime() - 60_000,
    `${kind} observer receipt predates the probe`,
  );
  assert.ok(
    observedAt.getTime() <= Date.now() + 5 * 60_000,
    `${kind} observer receipt is implausibly future-dated`,
  );
  if (kind === "telemetry") {
    assert.equal(receipt.traceObserved, true, "telemetry observer did not confirm the trace");
    assert.equal(receipt.metricsObserved, true, "telemetry observer did not confirm metrics");
    assert.equal(receipt.logsObserved, true, "telemetry observer did not confirm request logs");
  }
  return {
    probeId: expectedProbe.probeId,
    probeSha256: expectedProbe.probeSha256,
    receiptId: receipt.receiptId as string,
    observedAt: observedAt.toISOString(),
    ...(kind === "telemetry"
      ? { traceObserved: true, metricsObserved: true, logsObserved: true }
      : {}),
  };
}

function imageDigest(value: unknown, expectedReferencePrefix: string, label: string) {
  assert.equal(typeof value, "string", `${label} image reference must be a string`);
  const match = (value as string).match(
    new RegExp(
      `^${expectedReferencePrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}@sha256:([0-9a-f]{64})$`,
    ),
  );
  assert.ok(match, `${label} image must match the reviewed repository and immutable digest`);
  return `sha256:${match[1]}`;
}

export function deploymentReceiptBinding(
  source: string,
  expectedBuildId: string,
  expectedImageRepository: string,
) {
  assert.ok(source.length > 0 && source.length <= 65_536, "deployment receipt has an invalid size");
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    assert.fail("deployment receipt must be valid JSON");
  }
  const receipt = parsed as Record<string, unknown>;
  assert.ok(receipt && typeof receipt === "object" && !Array.isArray(receipt));
  assert.equal(receipt.schemaVersion, 2, "deployment receipt schemaVersion must be 2");
  assert.equal(receipt.environment, "staging", "deployment receipt must describe staging");
  assert.equal(receipt.buildId, expectedBuildId, "deployment receipt build mismatch");
  assert.equal(receipt.operation === "deploy" || receipt.operation === "rollback", true);
  assert.equal(typeof receipt.manifest, "string", "deployment receipt manifest path is missing");
  const manifestSegments = String(receipt.manifest).split("/");
  assert.match(
    receipt.manifest as string,
    /^artifacts\/deploy\/staging\/[A-Za-z0-9._/-]+\.json$/,
    "deployment receipt manifest path is unsafe",
  );
  assert.equal(
    manifestSegments.some((segment) => segment === "." || segment === ".." || segment === ""),
    false,
    "deployment receipt manifest path is unsafe",
  );
  assert.equal(
    typeof receipt.manifestSha256,
    "string",
    "deployment receipt manifest SHA-256 is missing",
  );
  assert.match(receipt.manifestSha256 as string, sha256Pattern);
  const images = exactObject(receipt.images, ["server", "web"], "deployment receipt images");
  const configuration = receipt.configuration as Record<string, unknown>;
  assert.ok(configuration && typeof configuration === "object" && !Array.isArray(configuration));
  assert.equal(typeof configuration.runtimeEnvironmentSha256, "string");
  assert.match(configuration.runtimeEnvironmentSha256 as string, sha256Pattern);
  const summary = configuration.summary as Record<string, unknown>;
  assert.ok(summary && typeof summary === "object" && !Array.isArray(summary));
  assert.equal(summary.buildId, expectedBuildId, "configuration summary build mismatch");
  assert.equal(
    summary.metrics,
    "protected",
    "configuration summary must confirm protected metrics",
  );
  assert.equal(
    summary.logs,
    "external-host-agent",
    "configuration summary must confirm external host log shipping",
  );
  assert.equal(summary.tracing, "otlp", "configuration summary must confirm OTLP tracing");
  const operations = receipt.operations as Record<string, unknown>;
  assert.ok(operations && typeof operations === "object" && !Array.isArray(operations));
  assert.equal(operations.commit, expectedBuildId, "deployment receipt operations commit mismatch");

  return {
    receiptSchemaVersion: 2,
    receiptSha256: `sha256:${createHash("sha256").update(source).digest("hex")}`,
    sourceAuthenticity: "external-review-required" as const,
    manifestSha256: receipt.manifestSha256 as string,
    serverImageDigest: imageDigest(images.server, `${expectedImageRepository}-server`, "server"),
    webImageDigest: imageDigest(images.web, `${expectedImageRepository}-web`, "web"),
    runtimeEnvironmentSha256: configuration.runtimeEnvironmentSha256 as string,
  };
}

export function assertSecureReadinessUrl(target: URL, allowHttp: boolean): void {
  if (target.protocol === "https:") return;
  assert.ok(
    allowHttp && target.protocol === "http:" && loopbackHostnames.has(target.hostname),
    `${target.origin} must use HTTPS; READINESS_ALLOW_HTTP is limited to loopback development targets`,
  );
}

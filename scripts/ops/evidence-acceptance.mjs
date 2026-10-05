import assert from "node:assert/strict";
import { isIP } from "node:net";
import { URL } from "node:url";

export const independentlyReviewedGateIds = new Set([
  "single-vm-staging",
  "paging",
  "target-region-load",
  "off-host-restore",
  "accessibility-review",
  "security-review",
  "privacy-legal",
  "live-billing",
  "repository-governance",
  "device-matrix",
  "design-partners",
  "beta-usability",
  "signed-release",
]);

const phase0PreflightGateIds = Object.freeze([
  "source-ci",
  "local-production-smoke",
  "single-vm-staging",
  "paging",
  "target-region-load",
  "off-host-restore",
  "accessibility-review",
  "security-review",
  "privacy-legal",
  "live-billing",
  "repository-governance",
  "device-matrix",
  "design-partners",
  "beta-usability",
]);

const phase0RequiredTargetsByGate = new Map(
  [
    ...phase0PreflightGateIds.map((id) => [
      id,
      ["single-vm-beta-preflight", "single-vm-beta", "single-vm-ga"],
    ]),
    ["signed-release", ["single-vm-beta", "single-vm-ga"]],
  ].map(([id, targets]) => [id, Object.freeze(targets)]),
);

export function validatePhase0ReadinessGateInventory(gates) {
  assert.ok(Array.isArray(gates), "release readiness gates must be an array");
  const expectedIds = [...phase0RequiredTargetsByGate.keys()].sort();
  const actualIds = gates.map((gate) => gate?.id).sort();
  assert.deepEqual(
    actualIds,
    expectedIds,
    "release readiness gates must match the canonical Phase 0 inventory",
  );

  for (const gate of gates) {
    const expectedTargets = phase0RequiredTargetsByGate.get(gate.id);
    assert.ok(expectedTargets, `${String(gate.id)} is not a canonical Phase 0 gate`);
    assert.ok(Array.isArray(gate.requiredFor), `${gate.id}: requiredFor must be an array`);
    assert.equal(
      new Set(gate.requiredFor).size,
      gate.requiredFor.length,
      `${gate.id}: requiredFor targets must be unique`,
    );
    assert.deepEqual(
      [...gate.requiredFor].sort(),
      [...expectedTargets].sort(),
      `${gate.id}: requiredFor must match the canonical Phase 0 target membership`,
    );
  }
}

const immutableBuildPattern = /^[a-f0-9]{40}$/;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
const isoUtcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const reservedHostPatterns = [
  /(^|\.)example(?:\.(?:com|net|org))?$/i,
  /(^|\.)invalid$/i,
  /(^|\.)localhost$/i,
  /(^|\.)test$/i,
  /(^|\.)local$/i,
  /(^|\.)internal$/i,
];
const safeRolePattern = /^[a-z0-9][a-z0-9._/-]{1,79}$/;
const maximumClockSkewMilliseconds = 5 * 60_000;

function assertExactKeys(value, expected, name) {
  assert.deepEqual(
    Object.keys(value).sort(),
    [...expected].sort(),
    `${name} must contain only the documented fields`,
  );
}

function requiredBoundedString(value, name, maximum = 200) {
  assert.equal(typeof value, "string", `${name} must be a string`);
  const normalized = value.trim();
  assert.ok(normalized.length > 0, `${name} must not be empty`);
  assert.ok(normalized.length <= maximum, `${name} must be at most ${maximum} characters`);
  return normalized;
}

function parseUtcTimestamp(value, name) {
  const timestamp = requiredBoundedString(value, name, 40);
  assert.match(timestamp, isoUtcPattern, `${name} must be an ISO-8601 UTC timestamp`);
  const milliseconds = Date.parse(timestamp);
  assert.ok(Number.isFinite(milliseconds), `${name} must be a valid timestamp`);
  const normalizedInput = timestamp.includes(".") ? timestamp : timestamp.replace("Z", ".000Z");
  assert.equal(
    new Date(milliseconds).toISOString(),
    normalizedInput,
    `${name} must be a real UTC calendar timestamp`,
  );
  return milliseconds;
}

function isPrivateOrReservedAddress(rawHostname) {
  const hostname = rawHostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (reservedHostPatterns.some((pattern) => pattern.test(hostname))) return true;
  if (isIP(hostname) === 4) {
    const [first, second, third] = hostname.split(".").map(Number);
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
  if (isIP(hostname) === 6) {
    return (
      hostname === "::" ||
      hostname === "::1" ||
      hostname.startsWith("fc") ||
      hostname.startsWith("fd") ||
      hostname.startsWith("::ffff:") ||
      /^fe[89ab]/.test(hostname) ||
      hostname.startsWith("ff") ||
      hostname.startsWith("100:") ||
      hostname.startsWith("2001:0:") ||
      hostname.startsWith("2001:2:") ||
      hostname.startsWith("2001:10:") ||
      hostname.startsWith("2001:20:") ||
      hostname.startsWith("2001:db8:") ||
      hostname.startsWith("3fff:")
    );
  }
  return false;
}

function assertPublicHttpsReference(value, name) {
  const reference = requiredBoundedString(value, name, 2_048);
  let url;
  try {
    url = new URL(reference);
  } catch {
    assert.fail(`${name} must be a valid HTTPS URL or SHA-256 reference`);
  }
  assert.equal(url.protocol, "https:", `${name} must use HTTPS`);
  assert.equal(url.username, "", `${name} must not contain URL credentials`);
  assert.equal(url.password, "", `${name} must not contain URL credentials`);
  assert.equal(url.search, "", `${name} must not contain a query string`);
  assert.equal(url.hash, "", `${name} must not contain a fragment`);
  assert.notEqual(url.pathname, "/", `${name} must identify a stable evidence object`);
  assert.ok(!url.hostname.endsWith("."), `${name} must use a canonical hostname`);
  assert.ok(
    !isPrivateOrReservedAddress(url.hostname),
    `${name} must not use a private, local, reserved, or placeholder hostname`,
  );
  return reference;
}

export function assertStableEvidenceReference(value, name = "evidence reference") {
  if (typeof value === "string" && sha256Pattern.test(value)) return value;
  return assertPublicHttpsReference(value, name);
}

export function validateIndependentGateAcceptance(gate, { now = new Date() } = {}) {
  if (!independentlyReviewedGateIds.has(gate.id)) return;
  if (gate.status !== "complete") {
    assert.equal(
      gate.acceptance,
      undefined,
      `${gate.id}: acceptance metadata is valid only after completion`,
    );
    return;
  }

  const acceptance = gate.acceptance;
  assert.ok(
    acceptance && typeof acceptance === "object" && !Array.isArray(acceptance),
    `${gate.id}: completed independently reviewed gates require an acceptance object`,
  );
  assertExactKeys(
    acceptance,
    [
      "recordVersion",
      "candidateBuildId",
      "environment",
      "startedAt",
      "completedAt",
      "acceptedAt",
      "owner",
      "independentReviewer",
      "manifest",
    ],
    `${gate.id}: acceptance`,
  );
  assert.equal(acceptance.recordVersion, 1, `${gate.id}: acceptance.recordVersion must be 1`);

  const candidateBuildId = requiredBoundedString(
    acceptance.candidateBuildId,
    `${gate.id}: acceptance.candidateBuildId`,
    80,
  );
  assert.match(
    candidateBuildId,
    immutableBuildPattern,
    `${gate.id}: acceptance.candidateBuildId must be a full Git commit`,
  );
  assert.match(
    requiredBoundedString(acceptance.environment, `${gate.id}: acceptance.environment`, 120),
    /^[a-z0-9][a-z0-9._/-]{1,119}$/,
    `${gate.id}: acceptance.environment must be a redaction-safe identifier`,
  );

  const startedAt = parseUtcTimestamp(acceptance.startedAt, `${gate.id}: acceptance.startedAt`);
  const completedAt = parseUtcTimestamp(
    acceptance.completedAt,
    `${gate.id}: acceptance.completedAt`,
  );
  const acceptedAt = parseUtcTimestamp(acceptance.acceptedAt, `${gate.id}: acceptance.acceptedAt`);
  assert.ok(startedAt <= completedAt, `${gate.id}: acceptance ended before it started`);
  assert.ok(completedAt <= acceptedAt, `${gate.id}: acceptance predates exercise completion`);
  const nowMilliseconds = now instanceof Date ? now.getTime() : Number.NaN;
  assert.ok(Number.isFinite(nowMilliseconds), `${gate.id}: validator time must be a valid Date`);
  assert.ok(
    acceptedAt <= nowMilliseconds + maximumClockSkewMilliseconds,
    `${gate.id}: acceptance timestamp cannot be in the future`,
  );

  assert.ok(
    acceptance.owner && typeof acceptance.owner === "object" && !Array.isArray(acceptance.owner),
    `${gate.id}: acceptance.owner is required`,
  );
  assertExactKeys(acceptance.owner, ["role", "decision"], `${gate.id}: acceptance.owner`);
  assert.match(
    gate.owner,
    safeRolePattern,
    `${gate.id}: gate owner must be a redaction-safe role token`,
  );
  assert.equal(
    requiredBoundedString(acceptance.owner.role, `${gate.id}: acceptance.owner.role`, 80),
    gate.owner,
    `${gate.id}: acceptance owner role must match the gate owner`,
  );
  assert.equal(
    acceptance.owner.decision,
    "accepted",
    `${gate.id}: owner decision must be accepted`,
  );

  const reviewer = acceptance.independentReviewer;
  assert.ok(
    reviewer && typeof reviewer === "object" && !Array.isArray(reviewer),
    `${gate.id}: acceptance.independentReviewer is required`,
  );
  assertExactKeys(
    reviewer,
    ["role", "independent", "decision"],
    `${gate.id}: acceptance.independentReviewer`,
  );
  const reviewerRole = requiredBoundedString(
    reviewer.role,
    `${gate.id}: acceptance.independentReviewer.role`,
    80,
  );
  assert.match(
    reviewerRole,
    safeRolePattern,
    `${gate.id}: reviewer role must be a redaction-safe role token`,
  );
  assert.notEqual(
    reviewerRole,
    gate.owner,
    `${gate.id}: independent reviewer role must differ from the gate owner`,
  );
  assert.equal(
    reviewer.independent,
    true,
    `${gate.id}: reviewer must explicitly attest independence`,
  );
  assert.equal(
    reviewer.decision,
    "accepted",
    `${gate.id}: independent reviewer decision must be accepted`,
  );

  const manifest = acceptance.manifest;
  assert.ok(
    manifest && typeof manifest === "object" && !Array.isArray(manifest),
    `${gate.id}: acceptance.manifest is required`,
  );
  assertExactKeys(manifest, ["url", "sha256"], `${gate.id}: acceptance.manifest`);
  assertPublicHttpsReference(manifest.url, `${gate.id}: acceptance.manifest.url`);
  assert.match(
    requiredBoundedString(manifest.sha256, `${gate.id}: acceptance.manifest.sha256`, 80),
    sha256Pattern,
    `${gate.id}: acceptance.manifest.sha256 must be a SHA-256 reference`,
  );
  assert.ok(
    gate.evidence.includes(manifest.url),
    `${gate.id}: evidence must include the accepted manifest URL`,
  );
  assert.ok(
    gate.evidence.includes(manifest.sha256),
    `${gate.id}: evidence must include the accepted manifest checksum`,
  );
}

export function validateReviewedCandidateBuildConsistency(gates) {
  const candidateBuildIds = new Set(
    gates
      .filter(
        (gate) =>
          independentlyReviewedGateIds.has(gate.id) &&
          gate.status === "complete" &&
          gate.acceptance &&
          typeof gate.acceptance.candidateBuildId === "string",
      )
      .map((gate) => gate.acceptance.candidateBuildId),
  );
  assert.ok(
    candidateBuildIds.size <= 1,
    `completed independently reviewed gates must bind one candidate build, found: ${[
      ...candidateBuildIds,
    ].join(", ")}`,
  );
  const [candidateBuildId] = candidateBuildIds;
  return candidateBuildId ?? null;
}

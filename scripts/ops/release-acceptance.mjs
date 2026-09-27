import { isDeepStrictEqual } from "node:util";

const FULL_GIT_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const RELEASE_TAG_PATTERN = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const SIGNED_RELEASE_GATE_ID = "signed-release";

function fail(message) {
  throw new Error(`Signed release acceptance ${message}`);
}

function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
}

function assertExactKeys(value, expected, label) {
  assertObject(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (!isDeepStrictEqual(actual, wanted)) {
    fail(`${label} must contain exactly ${wanted.join(", ")}`);
  }
}

function withoutKeys(value, keys) {
  const result = { ...value };
  for (const key of keys) delete result[key];
  return result;
}

function signedReleaseGate(ledger, label) {
  assertObject(ledger, label);
  if (!Array.isArray(ledger.gates)) fail(`${label}.gates must be an array`);
  const matches = ledger.gates.filter((gate) => gate?.id === SIGNED_RELEASE_GATE_ID);
  if (matches.length !== 1) fail(`${label} must contain exactly one signed-release gate`);
  return matches[0];
}

export function validateReleaseBinding(binding, expected = {}) {
  assertExactKeys(
    binding,
    ["schemaVersion", "tag", "tagObject", "buildId", "manifestDigest", "imageDigests"],
    "releaseBinding",
  );
  if (binding.schemaVersion !== 1) fail("releaseBinding.schemaVersion must be 1");
  if (typeof binding.tag !== "string" || !RELEASE_TAG_PATTERN.test(binding.tag)) {
    fail("releaseBinding.tag must be a v-prefixed semantic version without build metadata");
  }
  if (typeof binding.tagObject !== "string" || !FULL_GIT_SHA_PATTERN.test(binding.tagObject)) {
    fail("releaseBinding.tagObject must be a full Git object ID");
  }
  if (typeof binding.buildId !== "string" || !FULL_GIT_SHA_PATTERN.test(binding.buildId)) {
    fail("releaseBinding.buildId must be a full Git commit ID");
  }
  if (
    typeof binding.manifestDigest !== "string" ||
    !SHA256_DIGEST_PATTERN.test(binding.manifestDigest)
  ) {
    fail("releaseBinding.manifestDigest must be a sha256 digest");
  }
  assertExactKeys(binding.imageDigests, ["server", "web"], "releaseBinding.imageDigests");
  for (const component of ["server", "web"]) {
    if (
      typeof binding.imageDigests[component] !== "string" ||
      !SHA256_DIGEST_PATTERN.test(binding.imageDigests[component])
    ) {
      fail(`releaseBinding.imageDigests.${component} must be a sha256 digest`);
    }
  }

  for (const [key, value] of Object.entries(expected)) {
    if (value !== undefined && binding[key] !== value) {
      fail(`releaseBinding.${key} does not match the selected release artifact`);
    }
  }
  return binding;
}

export function validateAcceptedReleaseLedger(ledger, expected) {
  const gate = signedReleaseGate(ledger, "accepted ledger");
  if (gate.status !== "complete") fail("signed-release gate must be complete");
  if (
    !Array.isArray(gate.evidence) ||
    gate.evidence.length === 0 ||
    gate.evidence.some(
      (reference) =>
        typeof reference !== "string" ||
        !/^https:\/\/[^\s]+$/.test(reference) ||
        reference.includes("#replace-me"),
    )
  ) {
    fail("signed-release gate requires at least one stable HTTPS evidence reference");
  }
  if (Object.hasOwn(gate, "nextAction")) {
    fail("completed signed-release gate must not retain nextAction");
  }
  return validateReleaseBinding(gate.releaseBinding, expected);
}

export function validateSignedReleaseLedgerTransition(baseLedger, acceptedLedger, expected) {
  assertObject(baseLedger, "tagged ledger");
  assertObject(acceptedLedger, "accepted ledger");

  if (
    !isDeepStrictEqual(
      withoutKeys(baseLedger, ["updatedAt", "gates"]),
      withoutKeys(acceptedLedger, ["updatedAt", "gates"]),
    )
  ) {
    fail("descendant may not change ledger metadata other than updatedAt");
  }
  if (
    typeof baseLedger.updatedAt !== "string" ||
    typeof acceptedLedger.updatedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(baseLedger.updatedAt) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(acceptedLedger.updatedAt) ||
    acceptedLedger.updatedAt < baseLedger.updatedAt
  ) {
    fail("descendant updatedAt must be a date on or after the tagged ledger date");
  }
  if (
    !Array.isArray(baseLedger.gates) ||
    !Array.isArray(acceptedLedger.gates) ||
    baseLedger.gates.length !== acceptedLedger.gates.length
  ) {
    fail("descendant must preserve the tagged ledger gate set");
  }

  const baseSignedRelease = signedReleaseGate(baseLedger, "tagged ledger");
  const acceptedSignedRelease = signedReleaseGate(acceptedLedger, "accepted ledger");
  if (
    baseSignedRelease.status !== "pending" ||
    !Array.isArray(baseSignedRelease.evidence) ||
    baseSignedRelease.evidence.length !== 0 ||
    Object.hasOwn(baseSignedRelease, "releaseBinding")
  ) {
    fail("tagged ledger must contain an unaccepted pending signed-release gate");
  }

  for (let index = 0; index < baseLedger.gates.length; index += 1) {
    const baseGate = baseLedger.gates[index];
    const acceptedGate = acceptedLedger.gates[index];
    if (baseGate?.id !== acceptedGate?.id) {
      fail("descendant must preserve gate identity and ordering");
    }
    if (baseGate.id !== SIGNED_RELEASE_GATE_ID && !isDeepStrictEqual(baseGate, acceptedGate)) {
      fail(`descendant may not change gate ${baseGate.id}`);
    }
  }

  if (
    !isDeepStrictEqual(
      withoutKeys(baseSignedRelease, ["status", "evidence", "nextAction", "releaseBinding"]),
      withoutKeys(acceptedSignedRelease, ["status", "evidence", "nextAction", "releaseBinding"]),
    )
  ) {
    fail("descendant may only accept evidence on the signed-release gate");
  }

  return validateAcceptedReleaseLedger(acceptedLedger, expected);
}

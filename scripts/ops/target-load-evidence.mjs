import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { URL, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

export const targetLoadSchemaVersion = 2;

export const targetLoadThresholds = Object.freeze({
  joinP95Ms: 500,
  answerAcknowledgementP95Ms: 250,
  answerAcknowledgementP99Ms: 600,
  clientReceiptP95Ms: 500,
  reconnectMs: 2_000,
  reportAvailableMs: 60_000,
  receiptTimeoutCount: 0,
  receiptTimeoutRate: 0,
});

const matrixProfiles = Object.freeze({
  "round-50": { artifactType: "round", profile: 50 },
  "presentation-50": { artifactType: "presentation", profile: 50 },
  "round-250": { artifactType: "round", profile: 250 },
  "presentation-250": { artifactType: "presentation", profile: 250 },
});

const requiredSaturationSignals = Object.freeze([
  "cpu",
  "memory",
  "disk",
  "network",
  "postgresql",
  "valkey",
]);
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const safeIdentifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;
const maxSoakGapMilliseconds = 60_000;
const maximumClockSkewMilliseconds = 5 * 60_000;

function fail(message) {
  throw new Error(message);
}

function record(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${name} must be an object`);
  }
  return value;
}

function exactKeys(value, keys, name) {
  const actual = Object.keys(value);
  for (const key of actual) {
    if (!keys.includes(key)) fail(`${name} contains unsupported field ${JSON.stringify(key)}`);
  }
  for (const key of keys) {
    if (!(key in value)) fail(`${name} is missing required field ${JSON.stringify(key)}`);
  }
}

function finiteNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail(`${name} must be a non-negative finite number`);
  }
  return value;
}

function recoveryDuration(value, state, name) {
  if (state === "not_run") {
    if (value !== null) fail(`${name} must be null when the recovery exercise was not run`);
    return;
  }
  finiteNumber(value, name);
}

function integer(value, name) {
  if (!Number.isSafeInteger(value) || value < 0)
    fail(`${name} must be a non-negative safe integer`);
  return value;
}

function nonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    fail(`${name} must be a non-empty trimmed string`);
  }
  return value;
}

function safeIdentifier(value, name) {
  const identifier = nonEmptyString(value, name);
  if (!safeIdentifierPattern.test(identifier)) {
    fail(`${name} must be a bounded redaction-safe identifier`);
  }
  return identifier;
}

function immutableBuildId(value, name) {
  const buildId = nonEmptyString(value, name);
  if (!/^[0-9a-f]{40}$/.test(buildId)) fail(`${name} must be a full lowercase Git commit`);
  return buildId;
}

function utcTimestamp(value, name) {
  const timestamp = nonEmptyString(value, name);
  if (!utcTimestampPattern.test(timestamp)) fail(`${name} must be an ISO-8601 UTC timestamp`);
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) fail(`${name} must be a valid timestamp`);
  const canonical = new Date(milliseconds).toISOString();
  const normalized = timestamp.includes(".") ? timestamp : timestamp.replace("Z", ".000Z");
  if (canonical !== normalized) fail(`${name} must be a real UTC calendar timestamp`);
  return milliseconds;
}

function validationNow(now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    fail("validator now must be a valid Date");
  }
  return now.getTime();
}

function assertNotFuture(milliseconds, name, nowMilliseconds) {
  if (milliseconds > nowMilliseconds + maximumClockSkewMilliseconds) {
    fail(`${name} cannot be in the future`);
  }
}

function validateSoakWindow({ requestedMinutes, startedAt, finishedAt }, name, now) {
  integer(requestedMinutes, `${name}.requestedMinutes`);
  if (!new Set([0, 15, 60]).has(requestedMinutes)) {
    fail(`${name}.requestedMinutes must be 0 (not run), 15, or 60`);
  }
  const startedMilliseconds = utcTimestamp(startedAt, `${name}.startedAt`);
  const finishedMilliseconds = utcTimestamp(finishedAt, `${name}.finishedAt`);
  assertNotFuture(finishedMilliseconds, `${name}.finishedAt`, validationNow(now));
  if (finishedMilliseconds < startedMilliseconds) fail(`${name} finished before it started`);
  const elapsedMilliseconds = finishedMilliseconds - startedMilliseconds;
  if (elapsedMilliseconds < requestedMinutes * 60_000) {
    fail(`${name} elapsed time is shorter than the requested soak duration`);
  }
  if (requestedMinutes === 0 && elapsedMilliseconds !== 0) {
    fail(`${name} not-run window must have identical start and finish timestamps`);
  }
  return elapsedMilliseconds;
}

function exactObject(actual, expected, name) {
  if (!isDeepStrictEqual(actual, expected)) fail(`${name} does not match policy`);
}

function hasTrailingDotHostname(rawHostname) {
  return rawHostname.endsWith(".");
}

function isPrivateOrReservedHostname(rawHostname) {
  if (hasTrailingDotHostname(rawHostname)) return true;
  const hostname = rawHostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".invalid") ||
    hostname.endsWith(".test") ||
    hostname === "example" ||
    hostname.startsWith("example.") ||
    hostname.includes(".example.") ||
    hostname.endsWith(".example")
  ) {
    return true;
  }
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

function validatePublicTarget(value, name, { requireHttps }) {
  const target = new URL(nonEmptyString(value, name));
  if (
    (requireHttps && target.protocol !== "https:") ||
    (!requireHttps && !new Set(["http:", "https:"]).has(target.protocol)) ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    target.pathname !== "/" ||
    hasTrailingDotHostname(target.hostname) ||
    (requireHttps && isPrivateOrReservedHostname(target.hostname))
  ) {
    fail(
      `${name} must be a credential-free ${requireHttps ? "public HTTPS" : "HTTP(S)"} origin without query or fragment`,
    );
  }
  return target.origin;
}

export function evaluateTargetLoadThresholds(artifact) {
  return (
    artifact.latencyMs.join.p95 < targetLoadThresholds.joinP95Ms &&
    artifact.latencyMs.answerAcknowledgement.p95 <
      targetLoadThresholds.answerAcknowledgementP95Ms &&
    artifact.latencyMs.answerAcknowledgement.p99 <
      targetLoadThresholds.answerAcknowledgementP99Ms &&
    artifact.latencyMs.clientReceipt.p95 < targetLoadThresholds.clientReceiptP95Ms &&
    artifact.recovery.reconnectMs < targetLoadThresholds.reconnectMs &&
    artifact.report.availableMs < targetLoadThresholds.reportAvailableMs &&
    artifact.receipts.timeoutCount === targetLoadThresholds.receiptTimeoutCount &&
    artifact.receipts.timeoutRate === targetLoadThresholds.receiptTimeoutRate
  );
}

/**
 * @param {unknown} input
 * @param {{ artifactType?: "round" | "presentation"; profile?: number; expectedBuildId?: string; runnerRegion?: string; expectedTarget?: string; expectedWorkflowRunId?: string; expectedWorkflowRunAttempt?: number; enforceThresholds?: boolean; requireTargetProvenance?: boolean; now?: Date }} [options]
 */
export function validateTargetLoadArtifact(input, options = {}) {
  const {
    artifactType,
    profile,
    expectedBuildId,
    runnerRegion,
    expectedTarget,
    expectedWorkflowRunId,
    expectedWorkflowRunAttempt,
    enforceThresholds = false,
    requireTargetProvenance = false,
    now = new Date(),
  } = options;
  const nowMilliseconds = validationNow(now);
  const artifact = record(input, "target-load artifact");
  exactKeys(
    artifact,
    [
      "schemaVersion",
      "runId",
      "artifactType",
      "profile",
      "target",
      "runnerRegion",
      "workflow",
      "startedAt",
      "finishedAt",
      "build",
      "counts",
      "correctness",
      "receipts",
      "recovery",
      "report",
      "latencyMs",
      "thresholds",
      "thresholdsPassed",
      "diagnostics",
    ],
    "target-load artifact",
  );
  if (artifact.schemaVersion !== targetLoadSchemaVersion) {
    fail(`target-load schemaVersion must be ${targetLoadSchemaVersion}`);
  }
  if (!new Set(["round", "presentation"]).has(artifact.artifactType)) {
    fail("artifactType must be round or presentation");
  }
  if (artifactType && artifact.artifactType !== artifactType) {
    fail(`artifactType must be ${artifactType}`);
  }
  integer(artifact.profile, "profile");
  if (artifact.profile < 1 || artifact.profile > 250) fail("profile must be between 1 and 250");
  if (profile && artifact.profile !== profile) fail(`profile must be ${profile}`);
  safeIdentifier(artifact.runnerRegion, "runnerRegion");
  if (runnerRegion && artifact.runnerRegion !== runnerRegion) {
    fail(`runnerRegion must be ${runnerRegion}`);
  }
  safeIdentifier(artifact.runId, "runId");
  const target = validatePublicTarget(artifact.target, "target", {
    requireHttps: requireTargetProvenance,
  });
  if (artifact.target !== target) {
    fail("target must be the canonical origin without a trailing slash");
  }
  if (expectedTarget && target !== expectedTarget) {
    fail("target-load artifact target does not match the evidence set target");
  }
  const workflow = record(artifact.workflow, "workflow");
  exactKeys(workflow, ["runId", "runAttempt"], "workflow");
  if (workflow.runId !== null) safeIdentifier(workflow.runId, "workflow.runId");
  if (workflow.runAttempt !== null) integer(workflow.runAttempt, "workflow.runAttempt");
  if (requireTargetProvenance && (workflow.runId === null || workflow.runAttempt === null)) {
    fail("target-region artifacts require workflow run provenance");
  }
  if (expectedWorkflowRunId && workflow.runId !== expectedWorkflowRunId) {
    fail("target-load artifact workflow run ID does not match runner provenance");
  }
  if (
    expectedWorkflowRunAttempt !== undefined &&
    workflow.runAttempt !== expectedWorkflowRunAttempt
  ) {
    fail("target-load artifact workflow run attempt does not match runner provenance");
  }
  const startedAt = utcTimestamp(artifact.startedAt, "startedAt");
  const finishedAt = utcTimestamp(artifact.finishedAt, "finishedAt");
  if (finishedAt < startedAt) fail("target-load artifact finished before it started");
  assertNotFuture(finishedAt, "finishedAt", nowMilliseconds);

  const build = record(artifact.build, "build");
  exactKeys(build, ["expectedBuildId", "observedBuildId", "matched"], "build");
  nonEmptyString(build.observedBuildId, "build.observedBuildId");
  if (build.expectedBuildId !== null) {
    nonEmptyString(build.expectedBuildId, "build.expectedBuildId");
  }
  if (typeof build.matched !== "boolean") fail("build.matched must be a boolean");
  if (
    build.matched !==
    (build.expectedBuildId !== null && build.expectedBuildId === build.observedBuildId)
  ) {
    fail("build.matched does not match the expected and observed identities");
  }
  if (requireTargetProvenance) {
    immutableBuildId(build.expectedBuildId, "build.expectedBuildId");
    immutableBuildId(build.observedBuildId, "build.observedBuildId");
    if (!build.matched || build.expectedBuildId !== build.observedBuildId) {
      fail("target-load build identity does not match");
    }
  }
  if (expectedBuildId) {
    immutableBuildId(expectedBuildId, "expected build ID");
    if (build.expectedBuildId !== expectedBuildId || build.observedBuildId !== expectedBuildId) {
      fail("target-load artifact does not match the expected build");
    }
  }

  const counts = record(artifact.counts, "counts");
  exactKeys(
    counts,
    [
      "requestedParticipants",
      "joinedParticipants",
      "acceptedResponses",
      "expectedResponses",
      "reportParticipants",
      "reportResponses",
    ],
    "counts",
  );
  for (const field of [
    "requestedParticipants",
    "joinedParticipants",
    "acceptedResponses",
    "expectedResponses",
    "reportParticipants",
    "reportResponses",
  ]) {
    integer(counts[field], `counts.${field}`);
  }
  if (counts.requestedParticipants !== artifact.profile) {
    fail("requested participant count must equal profile");
  }
  if (counts.joinedParticipants !== counts.requestedParticipants) {
    fail("joined participant count does not match requested count");
  }
  if (counts.acceptedResponses !== counts.expectedResponses) {
    fail("accepted response count does not match expected count");
  }
  const contractExpectedResponses =
    artifact.profile * (artifact.artifactType === "presentation" ? 2 : 1);
  if (counts.expectedResponses !== contractExpectedResponses) {
    fail("expected response count does not match the artifact profile");
  }
  if (counts.reportParticipants !== counts.requestedParticipants) {
    fail("report participant count does not match requested count");
  }
  if (counts.reportResponses !== counts.acceptedResponses) {
    fail("report response count does not match accepted count");
  }

  const correctness = record(artifact.correctness, "correctness");
  exactKeys(
    correctness,
    ["lostAcceptedResponses", "duplicateAcceptedResponses", "leakageDetected", "reportReconciled"],
    "correctness",
  );
  integer(correctness.lostAcceptedResponses, "correctness.lostAcceptedResponses");
  integer(correctness.duplicateAcceptedResponses, "correctness.duplicateAcceptedResponses");
  if (correctness.lostAcceptedResponses !== 0) {
    fail("lostAcceptedResponses must be zero");
  }
  if (correctness.duplicateAcceptedResponses !== 0) {
    fail("duplicateAcceptedResponses must be zero");
  }
  if (correctness.leakageDetected !== false) fail("leakageDetected must be false");
  if (correctness.reportReconciled !== true) fail("reportReconciled must be true");

  const receipts = record(artifact.receipts, "receipts");
  exactKeys(receipts, ["expected", "received", "timeoutCount", "timeoutRate"], "receipts");
  integer(receipts.expected, "receipts.expected");
  integer(receipts.received, "receipts.received");
  integer(receipts.timeoutCount, "receipts.timeoutCount");
  finiteNumber(receipts.timeoutRate, "receipts.timeoutRate");
  if (receipts.received + receipts.timeoutCount !== receipts.expected) {
    fail("receipt counts do not reconcile");
  }
  if (receipts.expected !== counts.expectedResponses) {
    fail("expected receipt count does not match expected responses");
  }
  if (receipts.timeoutCount !== 0 || receipts.timeoutRate !== 0) {
    fail("target-load receipt timeouts must be zero");
  }
  if (receipts.timeoutRate !== receipts.timeoutCount / receipts.expected) {
    fail("receipt timeout rate does not match the reconciled counts");
  }

  const recovery = record(artifact.recovery, "recovery");
  exactKeys(
    recovery,
    ["reconnectCompleted", "reconnectMs", "processRestart", "coordinationReset"],
    "recovery",
  );
  if (recovery.reconnectCompleted !== true) fail("reconnectCompleted must be true");
  finiteNumber(recovery.reconnectMs, "recovery.reconnectMs");
  if (!new Set(["not_run", "recovered"]).has(recovery.processRestart)) {
    fail("recovery.processRestart is invalid");
  }
  if (!new Set(["not_run", "recovered"]).has(recovery.coordinationReset)) {
    fail("recovery.coordinationReset is invalid");
  }

  const report = record(artifact.report, "report");
  exactKeys(report, ["reconciled", "availableMs"], "report");
  if (report.reconciled !== true) fail("report.reconciled must be true");
  finiteNumber(report.availableMs, "report.availableMs");

  const latency = record(artifact.latencyMs, "latencyMs");
  exactKeys(latency, ["join", "answerAcknowledgement", "clientReceipt"], "latencyMs");
  for (const [group, fields] of [
    ["join", ["p50", "p95"]],
    ["answerAcknowledgement", ["p50", "p95", "p99"]],
    ["clientReceipt", ["p50", "p95", "max"]],
  ]) {
    const values = record(latency[group], `latencyMs.${group}`);
    exactKeys(values, fields, `latencyMs.${group}`);
    for (const field of fields) finiteNumber(values[field], `latencyMs.${group}.${field}`);
    for (let index = 1; index < fields.length; index += 1) {
      if (values[fields[index - 1]] > values[fields[index]]) {
        fail(`latencyMs.${group} percentiles/max must be monotonically ordered`);
      }
    }
  }
  const diagnostics = record(artifact.diagnostics, "diagnostics");
  if (artifact.artifactType === "round") {
    exactKeys(
      diagnostics,
      ["socketConnection", "joinAcknowledgement", "restartRecoveryMs"],
      "diagnostics",
    );
    for (const group of ["socketConnection", "joinAcknowledgement"]) {
      const values = record(diagnostics[group], `diagnostics.${group}`);
      exactKeys(values, ["p50", "p95"], `diagnostics.${group}`);
      finiteNumber(values.p50, `diagnostics.${group}.p50`);
      finiteNumber(values.p95, `diagnostics.${group}.p95`);
      if (values.p50 > values.p95) fail(`diagnostics.${group} percentiles are out of order`);
    }
    recoveryDuration(
      diagnostics.restartRecoveryMs,
      recovery.processRestart,
      "diagnostics.restartRecoveryMs",
    );
  } else {
    exactKeys(
      diagnostics,
      [
        "commandReplayStable",
        "responseReplayStable",
        "reconnectReceiptRecovered",
        "participantProjectionChecks",
        "recoveredParticipants",
        "restartRecoveryMs",
        "coordinationResetMs",
      ],
      "diagnostics",
    );
    for (const field of [
      "commandReplayStable",
      "responseReplayStable",
      "reconnectReceiptRecovered",
    ]) {
      if (diagnostics[field] !== true) fail(`diagnostics.${field} must be true`);
    }
    integer(diagnostics.participantProjectionChecks, "diagnostics.participantProjectionChecks");
    integer(diagnostics.recoveredParticipants, "diagnostics.recoveredParticipants");
    if (diagnostics.participantProjectionChecks < 1) {
      fail("diagnostics.participantProjectionChecks must prove at least one projection check");
    }
    if (diagnostics.recoveredParticipants !== artifact.profile) {
      fail("diagnostics.recoveredParticipants must equal the participant profile");
    }
    recoveryDuration(
      diagnostics.restartRecoveryMs,
      recovery.processRestart,
      "diagnostics.restartRecoveryMs",
    );
    recoveryDuration(
      diagnostics.coordinationResetMs,
      recovery.coordinationReset,
      "diagnostics.coordinationResetMs",
    );
  }
  exactObject(artifact.thresholds, targetLoadThresholds, "thresholds");
  const thresholdsPassed = evaluateTargetLoadThresholds(artifact);
  if (artifact.thresholdsPassed !== thresholdsPassed) {
    fail("thresholdsPassed does not match the measured values");
  }
  if (enforceThresholds && !thresholdsPassed) fail("target-load performance thresholds failed");
  return artifact;
}

async function sha256File(path) {
  const bytes = await readFile(path);
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function readJson(path, name) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${name} is not valid JSON`, { cause: error });
  }
}

export function validateEvidenceReference(value, name) {
  const reference = nonEmptyString(value, name);
  const url = new URL(reference);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname === "/" ||
    isPrivateOrReservedHostname(url.hostname)
  ) {
    fail(
      `${name} must be a stable non-placeholder HTTPS URL without credentials, query, or fragment`,
    );
  }
  return url.href;
}

export async function createSoakSummary({
  directory,
  expectedBuildId,
  runnerRegion,
  requestedMinutes,
  startedAt,
  finishedAt,
  now = new Date(),
}) {
  immutableBuildId(expectedBuildId, "expected build ID");
  nonEmptyString(runnerRegion, "runner region");
  integer(requestedMinutes, "requested soak minutes");
  validateSoakWindow({ requestedMinutes, startedAt, finishedAt }, "soak window", now);
  const filenames = (
    await readdir(directory).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    })
  )
    .filter((name) => /^run-[1-9][0-9]*\.json$/.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  if (requestedMinutes === 0 && filenames.length !== 0) {
    fail("a not-run soak summary cannot contain runs");
  }
  if (requestedMinutes > 0 && filenames.length === 0) {
    fail("a requested soak must contain at least one completed run");
  }
  const runs = [];
  let evidenceTarget = null;
  let evidenceWorkflow = null;
  for (const filename of filenames) {
    const path = join(directory, filename);
    const artifact = validateTargetLoadArtifact(await readJson(path, filename), {
      artifactType: "round",
      profile: 50,
      expectedBuildId,
      runnerRegion,
      enforceThresholds: true,
      requireTargetProvenance: true,
      now,
    });
    if (evidenceTarget === null) evidenceTarget = artifact.target;
    if (evidenceTarget !== artifact.target) fail("soak runs must use one exact target origin");
    if (evidenceWorkflow === null) evidenceWorkflow = artifact.workflow;
    if (!isDeepStrictEqual(evidenceWorkflow, artifact.workflow)) {
      fail("soak runs must belong to one workflow run attempt");
    }
    runs.push({
      filename,
      runId: artifact.runId,
      sha256: await sha256File(path),
      startedAt: artifact.startedAt,
      finishedAt: artifact.finishedAt,
    });
  }
  const completed = requestedMinutes > 0;
  return {
    schemaVersion: 1,
    artifactType: "target-load-soak-summary",
    candidateBuildId: expectedBuildId,
    runnerRegion,
    target: evidenceTarget,
    workflow: evidenceWorkflow,
    status: completed ? "completed" : "not_run",
    startedAt,
    finishedAt,
    requestedMinutes,
    completedGames: runs.length,
    runs,
    correctnessPassed: completed,
    thresholdsPassed: completed,
  };
}

function validateRunnerProvenance(provenance, expectedBuildId, runnerRegion, now) {
  const value = record(provenance, "runner provenance");
  exactKeys(
    value,
    [
      "schemaVersion",
      "artifactType",
      "candidateBuildId",
      "workflowCommit",
      "declaredRegion",
      "capturedAt",
      "workflowRunId",
      "workflowRunAttempt",
      "runner",
    ],
    "runner provenance",
  );
  if (value.schemaVersion !== 3 || value.artifactType !== "target-load-runner-provenance") {
    fail("runner provenance contract is invalid");
  }
  if (value.candidateBuildId !== expectedBuildId || value.workflowCommit !== expectedBuildId) {
    fail("runner provenance build does not match the candidate");
  }
  if (value.declaredRegion !== runnerRegion) fail("runner provenance region does not match");
  const capturedAt = utcTimestamp(value.capturedAt, "runner provenance capturedAt");
  assertNotFuture(capturedAt, "runner provenance capturedAt", validationNow(now));
  safeIdentifier(value.workflowRunId, "runner provenance workflowRunId");
  integer(value.workflowRunAttempt, "runner provenance workflowRunAttempt");
  if (value.workflowRunAttempt < 1) fail("runner provenance workflowRunAttempt must be positive");
  const runner = record(value.runner, "runner provenance runner");
  exactKeys(
    runner,
    [
      "nameSha256",
      "os",
      "architecture",
      "minimumRequiredVersion",
      "versionAttestationLabel",
      "requiredLabels",
    ],
    "runner provenance runner",
  );
  if (!/^sha256:[a-f0-9]{64}$/.test(runner.nameSha256)) {
    fail("runner.nameSha256 must be a SHA-256 digest");
  }
  if (runner.os !== "Linux") fail("runner.os must be Linux");
  if (runner.architecture !== "X64") fail("runner.architecture must be X64");
  if (runner.minimumRequiredVersion !== "2.327.1") {
    fail("runner.minimumRequiredVersion must be 2.327.1");
  }
  if (runner.versionAttestationLabel !== "actions-runner-2-327-1-plus") {
    fail("runner version attestation label is invalid");
  }
  const requiredLabels = ["self-hosted", "single-vm-staging", "actions-runner-2-327-1-plus"];
  exactObject(runner.requiredLabels, requiredLabels, "runner.requiredLabels");
  return value;
}

function validateSoakSummary(summary, { expectedBuildId, runnerRegion, now }) {
  const value = record(summary, "soak summary");
  exactKeys(
    value,
    [
      "schemaVersion",
      "artifactType",
      "candidateBuildId",
      "runnerRegion",
      "target",
      "workflow",
      "status",
      "startedAt",
      "finishedAt",
      "requestedMinutes",
      "completedGames",
      "runs",
      "correctnessPassed",
      "thresholdsPassed",
    ],
    "soak summary",
  );
  if (value.schemaVersion !== 1 || value.artifactType !== "target-load-soak-summary") {
    fail("soak summary contract is invalid");
  }
  if (value.candidateBuildId !== expectedBuildId || value.runnerRegion !== runnerRegion) {
    fail("soak summary build or region does not match");
  }
  if (!new Set(["not_run", "completed"]).has(value.status)) fail("soak status is invalid");
  integer(value.requestedMinutes, "soak requestedMinutes");
  validateSoakWindow(
    {
      requestedMinutes: value.requestedMinutes,
      startedAt: value.startedAt,
      finishedAt: value.finishedAt,
    },
    "soak summary",
    now,
  );
  integer(value.completedGames, "soak completedGames");
  if (!Array.isArray(value.runs) || value.completedGames !== value.runs.length) {
    fail("soak completedGames does not match its run inventory");
  }
  if (value.status === "not_run" && (value.requestedMinutes !== 0 || value.runs.length !== 0)) {
    fail("not-run soak summary is inconsistent");
  }
  if (value.status === "completed" && (value.requestedMinutes === 0 || value.runs.length === 0)) {
    fail("completed soak summary is inconsistent");
  }
  if (value.status === "completed") {
    validatePublicTarget(value.target, "soak target", { requireHttps: true });
    const workflow = record(value.workflow, "soak workflow");
    exactKeys(workflow, ["runId", "runAttempt"], "soak workflow");
    safeIdentifier(workflow.runId, "soak workflow.runId");
    integer(workflow.runAttempt, "soak workflow.runAttempt");
    if (value.correctnessPassed !== true || value.thresholdsPassed !== true) {
      fail("completed soak correctness or thresholds did not pass");
    }
  } else {
    if (value.target !== null || value.workflow !== null) {
      fail("not-run soak must not claim target or workflow provenance");
    }
    if (value.correctnessPassed !== false || value.thresholdsPassed !== false) {
      fail("not-run soak must not claim correctness or threshold validation");
    }
  }
  const seenFilenames = new Set();
  const seenRunIds = new Set();
  for (const [index, raw] of value.runs.entries()) {
    const entry = record(raw, `soak runs[${index}]`);
    exactKeys(
      entry,
      ["filename", "runId", "sha256", "startedAt", "finishedAt"],
      `soak runs[${index}]`,
    );
    const filename = nonEmptyString(entry.filename, `soak runs[${index}].filename`);
    if (!/^run-[1-9][0-9]*\.json$/.test(filename)) fail("soak run filename is invalid");
    safeIdentifier(entry.runId, `soak runs[${index}].runId`);
    if (!/^sha256:[a-f0-9]{64}$/.test(entry.sha256)) fail("soak run hash is invalid");
    const entryStartedAt = utcTimestamp(entry.startedAt, `soak runs[${index}].startedAt`);
    const entryFinishedAt = utcTimestamp(entry.finishedAt, `soak runs[${index}].finishedAt`);
    if (entryFinishedAt < entryStartedAt) fail("soak run finished before it started");
    assertNotFuture(entryFinishedAt, `soak runs[${index}].finishedAt`, validationNow(now));
    if (seenFilenames.has(filename) || seenRunIds.has(entry.runId)) {
      fail("soak run filenames and run IDs must be unique");
    }
    seenFilenames.add(filename);
    seenRunIds.add(entry.runId);
  }
  return value;
}

export async function createTargetRegionEvidenceBundle({
  provenancePath,
  matrixPaths,
  soakSummaryPath,
  soakDirectory,
  expectedBuildId,
  runnerRegion,
  saturationEvidenceReference,
  durableArchiveReference,
  now = new Date(),
}) {
  const nowMilliseconds = validationNow(now);
  immutableBuildId(expectedBuildId, "expected build ID");
  nonEmptyString(runnerRegion, "runner region");
  exactObject(
    Object.keys(matrixPaths).sort(),
    Object.keys(matrixProfiles).sort(),
    "matrix profiles",
  );

  const provenance = validateRunnerProvenance(
    await readJson(provenancePath, "runner provenance"),
    expectedBuildId,
    runnerRegion,
    now,
  );
  let latestSourceMilliseconds = utcTimestamp(
    provenance.capturedAt,
    "runner provenance capturedAt",
  );
  const expectedWorkflow = {
    runId: provenance.workflowRunId,
    runAttempt: provenance.workflowRunAttempt,
  };
  const sources = [
    {
      role: "runner-provenance",
      filename: basename(provenancePath),
      sha256: await sha256File(provenancePath),
    },
  ];
  const matrix = {};
  const runIds = new Set();
  let evidenceTarget = null;
  for (const [role, expected] of Object.entries(matrixProfiles)) {
    const path = matrixPaths[role];
    const artifact = validateTargetLoadArtifact(await readJson(path, role), {
      ...expected,
      expectedBuildId,
      runnerRegion,
      enforceThresholds: true,
      requireTargetProvenance: true,
      expectedWorkflowRunId: expectedWorkflow.runId,
      expectedWorkflowRunAttempt: expectedWorkflow.runAttempt,
      now,
    });
    if (evidenceTarget === null) evidenceTarget = artifact.target;
    if (artifact.target !== evidenceTarget) {
      fail("all target-load matrix artifacts must use one exact target origin");
    }
    if (runIds.has(artifact.runId)) fail("target-load matrix run IDs must be unique");
    runIds.add(artifact.runId);
    latestSourceMilliseconds = Math.max(
      latestSourceMilliseconds,
      utcTimestamp(artifact.finishedAt, `${role}.finishedAt`),
    );
    sources.push({ role, filename: basename(path), sha256: await sha256File(path) });
    matrix[role] = {
      runId: artifact.runId,
      requestedParticipants: artifact.counts.requestedParticipants,
      joinedParticipants: artifact.counts.joinedParticipants,
      acceptedResponses: artifact.counts.acceptedResponses,
      reportResponses: artifact.counts.reportResponses,
      receiptTimeoutCount: artifact.receipts.timeoutCount,
      receiptTimeoutRate: artifact.receipts.timeoutRate,
      thresholdsPassed: artifact.thresholdsPassed,
    };
  }

  const soakSummary = validateSoakSummary(await readJson(soakSummaryPath, "soak summary"), {
    expectedBuildId,
    runnerRegion,
    now,
  });
  latestSourceMilliseconds = Math.max(
    latestSourceMilliseconds,
    utcTimestamp(soakSummary.finishedAt, "soak summary.finishedAt"),
  );
  if (
    soakSummary.status === "completed" &&
    (soakSummary.target !== evidenceTarget ||
      !isDeepStrictEqual(soakSummary.workflow, expectedWorkflow))
  ) {
    fail("soak target or workflow attempt does not match the matrix and runner provenance");
  }
  const actualSoakFilenames = (await readdir(soakDirectory))
    .filter((name) => /^run-[1-9][0-9]*\.json$/.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const declaredSoakFilenames = soakSummary.runs.map(({ filename }) => filename);
  exactObject(actualSoakFilenames, declaredSoakFilenames, "soak run file inventory");
  const soakRunIds = new Set();
  const soakIntervals = [];
  for (const run of soakSummary.runs) {
    const entry = record(run, "soak run entry");
    const filename = nonEmptyString(entry.filename, "soak run filename");
    if (basename(filename) !== filename) fail("soak run filename must not contain a path");
    const path = join(soakDirectory, filename);
    const artifact = validateTargetLoadArtifact(await readJson(path, filename), {
      artifactType: "round",
      profile: 50,
      expectedBuildId,
      runnerRegion,
      enforceThresholds: true,
      requireTargetProvenance: true,
      expectedTarget: evidenceTarget,
      expectedWorkflowRunId: expectedWorkflow.runId,
      expectedWorkflowRunAttempt: expectedWorkflow.runAttempt,
      now,
    });
    if (
      entry.runId !== artifact.runId ||
      entry.sha256 !== (await sha256File(path)) ||
      entry.startedAt !== artifact.startedAt ||
      entry.finishedAt !== artifact.finishedAt
    ) {
      fail(`soak run ${filename} does not match its summary hash, identity, or timestamps`);
    }
    if (runIds.has(artifact.runId) || soakRunIds.has(artifact.runId)) {
      fail("soak and matrix run IDs must be unique");
    }
    soakRunIds.add(artifact.runId);
    soakIntervals.push({
      startedAt: utcTimestamp(artifact.startedAt, `${filename}.startedAt`),
      finishedAt: utcTimestamp(artifact.finishedAt, `${filename}.finishedAt`),
    });
    latestSourceMilliseconds = Math.max(
      latestSourceMilliseconds,
      utcTimestamp(artifact.finishedAt, `${filename}.finishedAt`),
    );
  }
  if (soakSummary.status === "completed") {
    const summaryStartedAt = utcTimestamp(soakSummary.startedAt, "soak summary.startedAt");
    const summaryFinishedAt = utcTimestamp(soakSummary.finishedAt, "soak summary.finishedAt");
    if (
      soakIntervals[0].startedAt < summaryStartedAt ||
      soakIntervals[0].startedAt - summaryStartedAt > maxSoakGapMilliseconds
    ) {
      fail("first soak run does not begin within the allowed summary-window gap");
    }
    for (let index = 0; index < soakIntervals.length; index += 1) {
      const interval = soakIntervals[index];
      if (interval.finishedAt > summaryFinishedAt) fail("soak run extends beyond summary window");
      if (
        index > 0 &&
        (interval.startedAt < soakIntervals[index - 1].finishedAt ||
          interval.startedAt - soakIntervals[index - 1].finishedAt > maxSoakGapMilliseconds)
      ) {
        fail("soak run intervals overlap, are out of order, or contain an excessive gap");
      }
    }
    if (
      summaryFinishedAt - soakIntervals[soakIntervals.length - 1].finishedAt >
      maxSoakGapMilliseconds
    ) {
      fail("last soak run does not cover the end of the summary window");
    }
  }
  sources.push({
    role: "soak-summary",
    filename: basename(soakSummaryPath),
    sha256: await sha256File(soakSummaryPath),
  });
  const soakValidated = soakSummary.status === "completed";
  if (latestSourceMilliseconds > nowMilliseconds) {
    fail("bundle createdAt must follow every source completion timestamp");
  }

  return {
    schemaVersion: 1,
    artifactType: "target-region-evidence-bundle",
    candidateBuildId: expectedBuildId,
    runnerRegion,
    target: evidenceTarget,
    workflow: expectedWorkflow,
    createdAt: now.toISOString(),
    runner: {
      declaredRegion: provenance.declaredRegion,
      nameSha256: provenance.runner.nameSha256,
      os: provenance.runner.os,
      architecture: provenance.runner.architecture,
      versionAttestationLabel: provenance.runner.versionAttestationLabel,
    },
    sources,
    matrix,
    soak: {
      status: soakSummary.status,
      requestedMinutes: soakSummary.requestedMinutes,
      completedGames: soakSummary.completedGames,
    },
    saturationEvidence: {
      reference: validateEvidenceReference(
        saturationEvidenceReference,
        "saturation evidence reference",
      ),
      requiredSignals: requiredSaturationSignals,
      source: "target VM and target data services; never load-generator runner metrics",
    },
    durableArchive: {
      reference: validateEvidenceReference(durableArchiveReference, "durable archive reference"),
    },
    validation: {
      exactMatrix: true,
      buildMatched: true,
      regionMatched: true,
      zeroLossDuplicateLeakage: true,
      receiptsReconciled: true,
      thresholdsPassed: true,
      soakValidated,
      externalEvidenceContentVerified: false,
      acceptanceComplete: false,
    },
  };
}

function parseFlags(argv, allowed) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined)
      fail("arguments must be --name value pairs");
    const name = flag.slice(2);
    if (!allowed.has(name)) fail(`unsupported argument: ${flag}`);
    if (Object.hasOwn(values, name)) fail(`duplicate argument: ${flag}`);
    values[name] = value;
  }
  for (const name of allowed) {
    if (!Object.hasOwn(values, name)) fail(`missing required argument: --${name}`);
  }
  return values;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === "validate-references") {
    const flags = parseFlags(rest, new Set(["saturation-reference", "durable-archive-reference"]));
    validateEvidenceReference(flags["saturation-reference"], "saturation evidence reference");
    validateEvidenceReference(flags["durable-archive-reference"], "durable archive reference");
    return;
  }
  if (command === "summarize-soak") {
    const flags = parseFlags(
      rest,
      new Set([
        "directory",
        "expected-build",
        "runner-region",
        "requested-minutes",
        "started-at",
        "finished-at",
        "output",
      ]),
    );
    const summary = await createSoakSummary({
      directory: resolve(flags.directory),
      expectedBuildId: flags["expected-build"],
      runnerRegion: flags["runner-region"],
      requestedMinutes: Number(flags["requested-minutes"]),
      startedAt: flags["started-at"],
      finishedAt: flags["finished-at"],
    });
    await writeJson(resolve(flags.output), summary);
    return;
  }
  if (command === "bundle") {
    const flags = parseFlags(
      rest,
      new Set([
        "provenance",
        "round-50",
        "presentation-50",
        "round-250",
        "presentation-250",
        "soak-summary",
        "soak-directory",
        "expected-build",
        "runner-region",
        "saturation-reference",
        "durable-archive-reference",
        "output",
      ]),
    );
    const bundle = await createTargetRegionEvidenceBundle({
      provenancePath: resolve(flags.provenance),
      matrixPaths: Object.fromEntries(
        Object.keys(matrixProfiles).map((role) => [role, resolve(flags[role])]),
      ),
      soakSummaryPath: resolve(flags["soak-summary"]),
      soakDirectory: resolve(flags["soak-directory"]),
      expectedBuildId: flags["expected-build"],
      runnerRegion: flags["runner-region"],
      saturationEvidenceReference: flags["saturation-reference"],
      durableArchiveReference: flags["durable-archive-reference"],
    });
    await writeJson(resolve(flags.output), bundle);
    return;
  }
  fail(
    "usage: target-load-evidence.mjs <validate-references|summarize-soak|bundle> --name value ...",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}

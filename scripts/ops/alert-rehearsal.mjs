import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";
import { setTimeout } from "node:timers";
import { URL } from "node:url";

const severities = ["page", "warning", "ticket"];
const immutableBuildPattern = /^(?:[a-f0-9]{40}|sha256:[a-f0-9]{64})$/;

function requiredString(environment, name, maximum = 200) {
  const raw = environment[name];
  assert.equal(typeof raw, "string", `${name} is required`);
  const value = raw.trim();
  assert.ok(value.length > 0, `${name} is required`);
  assert.ok(value.length <= maximum, `${name} must be at most ${maximum} characters`);
  return value;
}

function boundedWaitSeconds(environment, minimumWaitSeconds) {
  const raw = environment.ALERT_REHEARSAL_WAIT_SECONDS?.trim() || "45";
  assert.match(raw, /^\d+$/, "ALERT_REHEARSAL_WAIT_SECONDS must be an integer");
  const seconds = Number(raw);
  assert.ok(
    seconds >= minimumWaitSeconds && seconds <= 300,
    `ALERT_REHEARSAL_WAIT_SECONDS must be ${minimumWaitSeconds}-300`,
  );
  return seconds;
}

function alertmanagerEndpoint(environment) {
  const endpoint = new URL(requiredString(environment, "ALERT_REHEARSAL_URL", 2_048));
  const allowHttp = environment.ALERT_REHEARSAL_ALLOW_HTTP === "true";
  if (endpoint.protocol !== "https:") {
    assert.ok(
      allowHttp &&
        endpoint.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname),
      "ALERT_REHEARSAL_URL must use HTTPS; HTTP is allowed only for an explicit loopback test",
    );
  }
  assert.equal(endpoint.username, "", "ALERT_REHEARSAL_URL must not contain credentials");
  assert.equal(endpoint.password, "", "ALERT_REHEARSAL_URL must not contain credentials");
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/api/v2/alerts`;
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint;
}

function outputPath(environment) {
  return environment.ALERT_REHEARSAL_OUTPUT?.trim() || "artifacts/readiness/alert-rehearsal.json";
}

function timestamp(date = new Date()) {
  return date.toISOString();
}

function originChecksum(endpoint) {
  return `sha256:${createHash("sha256").update(endpoint.origin).digest("hex")}`;
}

function buildAlerts({ buildId, deployment, rehearsalId, startsAt, endsAt }) {
  return severities.map((severity) => ({
    labels: {
      alertname: `OpenRoundSynthetic${severity[0].toUpperCase()}${severity.slice(1)}`,
      deployment,
      rehearsal_id: rehearsalId,
      severity,
    },
    annotations: {
      build_id: buildId,
      summary: `Polling Pops ${severity} route rehearsal`,
      purpose: "phase0-alert-routing-evidence",
    },
    startsAt,
    ...(endsAt ? { endsAt } : {}),
  }));
}

async function postAlerts({ endpoint, alerts, token, fetchImpl }) {
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(alerts),
    redirect: "error",
    signal: globalThis.AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Alertmanager rejected the rehearsal request with HTTP ${response.status}`);
  }
  return response.status;
}

async function persistEvidence(path, evidence) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function runAlertRehearsal({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = () => new Date(),
  uuid = randomUUID,
  minimumWaitSeconds = 35,
} = {}) {
  assert.ok(
    Number.isSafeInteger(minimumWaitSeconds) &&
      minimumWaitSeconds >= 0 &&
      minimumWaitSeconds <= 300,
    "minimumWaitSeconds must be a safe integer from 0 to 300",
  );
  assert.equal(
    environment.ALERT_REHEARSAL_CONFIRM,
    "send-and-resolve-synthetic-alerts",
    "Set ALERT_REHEARSAL_CONFIRM=send-and-resolve-synthetic-alerts after receiver owners approve the exercise window",
  );
  const endpoint = alertmanagerEndpoint(environment);
  const buildId = requiredString(environment, "ALERT_REHEARSAL_BUILD_ID", 80);
  assert.match(
    buildId,
    immutableBuildPattern,
    "ALERT_REHEARSAL_BUILD_ID must be a full Git commit or image digest",
  );
  const deployment = requiredString(environment, "ALERT_REHEARSAL_DEPLOYMENT", 80);
  assert.match(
    deployment,
    /^[a-z0-9][a-z0-9_-]{0,79}$/,
    "ALERT_REHEARSAL_DEPLOYMENT must be a bounded label value",
  );
  const waitSeconds = boundedWaitSeconds(environment, minimumWaitSeconds);
  const token = environment.ALERT_REHEARSAL_TOKEN?.trim() || "";
  const path = outputPath(environment);
  const rehearsalId = uuid();
  const startedAt = timestamp(now());
  const evidence = {
    schemaVersion: 1,
    rehearsalId,
    buildId,
    deployment,
    alertmanagerOriginSha256: originChecksum(endpoint),
    startedAt,
    waitSeconds,
    routes: Object.fromEntries(
      severities.map((severity) => [severity, { injectedAt: null, resolvedAt: null }]),
    ),
    completedAt: null,
    outcome: "in_progress",
  };

  let failure;
  try {
    const injectedStatus = await postAlerts({
      endpoint,
      alerts: buildAlerts({ buildId, deployment, rehearsalId, startsAt: startedAt }),
      token,
      fetchImpl,
    });
    const injectedAt = timestamp(now());
    for (const severity of severities) {
      evidence.routes[severity] = {
        injectedAt,
        injectedHttpStatus: injectedStatus,
        resolvedAt: null,
      };
    }
    if (waitSeconds > 0) await wait(waitSeconds * 1_000);
  } catch (error) {
    failure = error;
  } finally {
    try {
      const resolvedAt = timestamp(now());
      const resolvedStatus = await postAlerts({
        endpoint,
        alerts: buildAlerts({
          buildId,
          deployment,
          rehearsalId,
          startsAt: startedAt,
          endsAt: resolvedAt,
        }),
        token,
        fetchImpl,
      });
      for (const severity of severities) {
        evidence.routes[severity] = {
          ...evidence.routes[severity],
          resolvedAt,
          resolvedHttpStatus: resolvedStatus,
        };
      }
    } catch (resolutionError) {
      failure ??= resolutionError;
    }
  }

  evidence.completedAt = timestamp(now());
  evidence.outcome = failure ? "failed" : "requests_accepted";
  if (failure) {
    evidence.failure = "alert-request-failed";
  }
  await persistEvidence(path, evidence);
  if (failure) throw failure;
  return evidence;
}

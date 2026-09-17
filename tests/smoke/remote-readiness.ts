import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

async function main() {
  const apiUrl = requiredUrl("READINESS_API_URL");
  const webUrl = new URL(process.env.READINESS_WEB_URL ?? apiUrl);
  const allowHttp = process.env.READINESS_ALLOW_HTTP === "true";
  const outputPath =
    process.env.READINESS_OUTPUT?.trim() || "artifacts/readiness/remote-probe.json";

  for (const target of [apiUrl, webUrl]) {
    if (!allowHttp) assert.equal(target.protocol, "https:", `${target.origin} must use HTTPS`);
  }

  function requiredUrl(name: string) {
    const value = process.env[name]?.trim();
    assert.ok(value, `${name} is required`);
    return new URL(value);
  }

  function normalizedOrigin(value: string) {
    return new URL(value).origin;
  }

  function optionalBoolean(name: string) {
    const value = process.env[name]?.trim();
    if (!value) return undefined;
    assert.ok(value === "true" || value === "false", `${name} must be true or false`);
    return value === "true";
  }

  async function request(path: string, target = apiUrl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      return await fetch(new URL(path, target), {
        headers: { "user-agent": "openround-readiness-probe/1.0" },
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function jsonResponse(path: string) {
    const response = await request(path);
    const body = await response.text();
    assert.equal(
      response.status,
      200,
      `${path} returned ${response.status}: ${body.slice(0, 300)}`,
    );
    return { response, body: JSON.parse(body) as Record<string, unknown> };
  }

  const live = await jsonResponse("/health/live");
  assert.equal(live.body.status, "ok", "liveness status must be ok");

  const ready = await jsonResponse("/health/ready");
  assert.equal(ready.body.status, "ready", "readiness status must be ready");
  assert.deepEqual(ready.body.dependencies, { database: "ready", coordination: "ready" });

  const featuresResult = await jsonResponse("/v1/features");
  const features = featuresResult.body;
  const expectedWebOrigin = normalizedOrigin(
    process.env.READINESS_EXPECTED_WEB_ORIGIN?.trim() || webUrl.origin,
  );
  assert.equal(
    normalizedOrigin(String(features.publicWebUrl)),
    expectedWebOrigin,
    "publicWebUrl does not match the expected web origin",
  );

  const expectedFeatures: Array<[string, string, unknown]> = [
    ["billing", "READINESS_EXPECT_BILLING", process.env.READINESS_EXPECT_BILLING?.trim()],
    [
      "communityMode",
      "READINESS_EXPECT_COMMUNITY_MODE",
      optionalBoolean("READINESS_EXPECT_COMMUNITY_MODE"),
    ],
    ["signups", "READINESS_EXPECT_SIGNUPS", optionalBoolean("READINESS_EXPECT_SIGNUPS")],
    [
      "sessionCreation",
      "READINESS_EXPECT_SESSION_CREATION",
      optionalBoolean("READINESS_EXPECT_SESSION_CREATION"),
    ],
    [
      "mediaUploads",
      "READINESS_EXPECT_MEDIA_UPLOADS",
      optionalBoolean("READINESS_EXPECT_MEDIA_UPLOADS"),
    ],
  ];
  for (const [feature, environmentName, expected] of expectedFeatures) {
    if (expected !== undefined && expected !== "") {
      assert.equal(features[feature], expected, `${feature} does not match ${environmentName}`);
    }
  }

  const metrics = await request("/metrics");
  const metricsExpectation = process.env.READINESS_EXPECT_METRICS?.trim() || "protected";
  assert.ok(
    metricsExpectation === "protected" || metricsExpectation === "disabled",
    "READINESS_EXPECT_METRICS must be protected or disabled",
  );
  assert.equal(
    metrics.status,
    metricsExpectation === "protected" ? 401 : 404,
    `metrics must be ${metricsExpectation}`,
  );

  const web = await request("/", webUrl);
  assert.ok(web.status >= 200 && web.status < 400, `web root returned ${web.status}`);
  const requiredHeaders: Record<string, RegExp> = {
    "content-security-policy":
      /script-src[^;]*'nonce-[^']+'[^;]*'strict-dynamic'[^;]*;.*object-src 'none'.*frame-ancestors 'none'/i,
    "x-content-type-options": /^nosniff$/i,
    "x-frame-options": /^deny$/i,
    "referrer-policy": /strict-origin-when-cross-origin/i,
    "permissions-policy": /camera=\(\).*microphone=\(\).*geolocation=\(\)/i,
  };
  if (webUrl.protocol === "https:") {
    requiredHeaders["strict-transport-security"] = /max-age=(?:[3-9]\d{7}|\d{9,})/i;
  }
  const observedHeaders: Record<string, string> = {};
  for (const [name, pattern] of Object.entries(requiredHeaders)) {
    const value = web.headers.get(name) ?? "";
    assert.match(value, pattern, `${name} is missing or unsafe`);
    observedHeaders[name] = value;
  }

  const evidence = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    commit: process.env.GITHUB_SHA ?? null,
    targets: { apiOrigin: apiUrl.origin, webOrigin: webUrl.origin },
    health: { live: live.body, ready: ready.body },
    publicFeatures: features,
    metrics: metricsExpectation,
    securityHeaders: observedHeaders,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

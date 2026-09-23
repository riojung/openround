import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  assertSecureReadinessUrl,
  requiredBillingMode,
  requiredBoolean,
  requiredCookiePair,
  requiredEnvironmentString,
  requiredImmutableBuildId,
} from "../support/readiness-contract.js";

async function main() {
  const apiUrl = requiredUrl("READINESS_API_URL");
  const webUrl = requiredUrl("READINESS_WEB_URL");
  const mediaUrl = requiredUrl("READINESS_MEDIA_URL");
  const allowHttp = process.env.READINESS_ALLOW_HTTP === "true";
  const outputPath =
    process.env.READINESS_OUTPUT?.trim() || "artifacts/readiness/remote-probe.json";
  const expectedBuildId = requiredImmutableBuildId(process.env, "READINESS_EXPECTED_BUILD_ID");
  const creatorCookie = requiredCookiePair(process.env, "READINESS_CREATOR_COOKIE");
  const expectedHomeRegion = requiredEnvironmentString(
    process.env,
    "READINESS_EXPECTED_HOME_REGION",
  );
  const expectedFeatures = {
    billing: requiredBillingMode(process.env, "READINESS_EXPECT_BILLING"),
    communityMode: requiredBoolean(process.env, "READINESS_EXPECT_COMMUNITY_MODE"),
    signups: requiredBoolean(process.env, "READINESS_EXPECT_SIGNUPS"),
    sessionCreation: requiredBoolean(process.env, "READINESS_EXPECT_SESSION_CREATION"),
    mediaUploads: requiredBoolean(process.env, "READINESS_EXPECT_MEDIA_UPLOADS"),
    uxBeta: requiredBoolean(process.env, "READINESS_EXPECT_UX_BETA"),
    recoveryRehearsal: requiredBoolean(process.env, "READINESS_EXPECT_RECOVERY_REHEARSAL"),
    practiceAssignments: requiredBoolean(process.env, "READINESS_EXPECT_PRACTICE_ASSIGNMENTS"),
    presentations: requiredBoolean(process.env, "READINESS_EXPECT_PRESENTATIONS"),
  };
  const expectedWorkspaceFeatures = {
    uxBeta: expectedFeatures.uxBeta,
    recoveryRehearsal: expectedFeatures.recoveryRehearsal,
    practiceAssignments: expectedFeatures.practiceAssignments,
    workspaceShell: requiredBoolean(process.env, "READINESS_EXPECT_WORKSPACE_SHELL"),
    builderV2: requiredBoolean(process.env, "READINESS_EXPECT_BUILDER_V2"),
    presentations: expectedFeatures.presentations,
    groups: requiredBoolean(process.env, "READINESS_EXPECT_GROUPS"),
    discover: requiredBoolean(process.env, "READINESS_EXPECT_DISCOVER"),
  };

  for (const target of [apiUrl, webUrl, mediaUrl]) assertSecureReadinessUrl(target, allowHttp);

  function requiredUrl(name: string) {
    return new URL(requiredEnvironmentString(process.env, name));
  }

  function normalizedOrigin(value: string) {
    return new URL(value).origin;
  }

  async function request(
    path: string,
    target = apiUrl,
    redirect: "manual" | "follow" = "manual",
    cookie?: string,
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      return await fetch(new URL(path, target), {
        headers: {
          "user-agent": "openround-readiness-probe/1.0",
          ...(cookie ? { cookie } : {}),
        },
        redirect,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function jsonResponse(path: string, cookie?: string) {
    const response = await request(path, apiUrl, "manual", cookie);
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
  assert.equal(
    live.body.buildId,
    expectedBuildId,
    "deployed server build does not match READINESS_EXPECTED_BUILD_ID",
  );

  const ready = await jsonResponse("/health/ready");
  assert.equal(ready.body.status, "ready", "readiness status must be ready");
  assert.deepEqual(ready.body.dependencies, { database: "ready", coordination: "ready" });
  if (expectedFeatures.mediaUploads) {
    assert.equal(ready.body.storage, "configured", "media-enabled staging must configure storage");
    assert.equal(ready.body.mediaScanning, "enabled", "media-enabled staging must enable scanning");
  }

  const mediaHealth = await request("/minio/health/live", mediaUrl);
  assert.equal(mediaHealth.status, 200, "public media TLS origin is not healthy");
  assert.equal(
    new URL(mediaHealth.url).origin,
    mediaUrl.origin,
    "public media health redirected to an unexpected origin",
  );

  const featuresResult = await jsonResponse("/v1/features");
  const features = featuresResult.body;
  const expectedWebOrigin = normalizedOrigin(
    requiredEnvironmentString(process.env, "READINESS_EXPECTED_WEB_ORIGIN"),
  );
  assert.equal(
    normalizedOrigin(String(features.publicWebUrl)),
    expectedWebOrigin,
    "publicWebUrl does not match the expected web origin",
  );

  for (const [feature, expected] of Object.entries(expectedFeatures)) {
    assert.equal(features[feature], expected, `${feature} does not match its required expectation`);
  }

  const account = await jsonResponse("/v1/auth/me", creatorCookie);
  const productFeatures = account.body.productFeatures as Record<string, unknown> | undefined;
  assert.ok(productFeatures, "authenticated account omitted productFeatures");
  for (const [feature, expected] of Object.entries(expectedWorkspaceFeatures)) {
    assert.equal(
      productFeatures[feature],
      expected,
      `synthetic workspace ${feature} does not match its required expectation`,
    );
  }

  const workspaceResult = await jsonResponse("/v1/workspaces", creatorCookie);
  const activeWorkspaceId = workspaceResult.body.activeWorkspaceId;
  const workspaces = workspaceResult.body.workspaces;
  assert.equal(typeof activeWorkspaceId, "string", "workspace response omitted activeWorkspaceId");
  assert.ok(Array.isArray(workspaces), "workspace response omitted workspaces");
  const activeWorkspace = (workspaces as Array<Record<string, unknown>>).find(
    (workspace) => workspace.id === activeWorkspaceId,
  );
  assert.ok(activeWorkspace, "active synthetic workspace was not returned");
  assert.equal(
    activeWorkspace.homeRegion,
    expectedHomeRegion,
    "synthetic workspace is not assigned to the expected home region",
  );

  const metrics = await request("/metrics");
  const metricsExpectation = requiredEnvironmentString(process.env, "READINESS_EXPECT_METRICS");
  assert.ok(
    metricsExpectation === "protected" || metricsExpectation === "disabled",
    "READINESS_EXPECT_METRICS must be protected or disabled",
  );
  assert.equal(
    metrics.status,
    metricsExpectation === "protected" ? 401 : 404,
    `metrics must be ${metricsExpectation}`,
  );

  const expectedWebRoot = new URL("/", webUrl);
  const web = await request("/", webUrl, "follow");
  const finalWebUrl = new URL(web.url);
  assert.equal(
    finalWebUrl.href,
    expectedWebRoot.href,
    `web root redirected unexpectedly to ${finalWebUrl.href}`,
  );
  if (!allowHttp) {
    assert.equal(finalWebUrl.protocol, "https:", "final web root must use HTTPS");
  }
  assert.ok(web.status >= 200 && web.status < 300, `web root returned ${web.status}`);
  assert.equal(
    web.headers.get("x-openround-build-id"),
    expectedBuildId,
    "deployed web build does not match READINESS_EXPECTED_BUILD_ID",
  );
  const requiredHeaders: Record<string, RegExp> = {
    "content-security-policy":
      /script-src[^;]*'nonce-[^']+'[^;]*'strict-dynamic'[^;]*;.*object-src 'none'.*frame-ancestors 'none'/i,
    "x-content-type-options": /^nosniff$/i,
    "x-frame-options": /^deny$/i,
    "referrer-policy": /strict-origin-when-cross-origin/i,
    "permissions-policy": /camera=\(\).*microphone=\(\).*geolocation=\(\)/i,
  };
  if (finalWebUrl.protocol === "https:") {
    requiredHeaders["strict-transport-security"] = /max-age=(?:[3-9]\d{7}|\d{9,})/i;
  }
  const observedHeaders: Record<string, string> = {
    "x-openround-build-id": expectedBuildId,
  };
  for (const [name, pattern] of Object.entries(requiredHeaders)) {
    const value = web.headers.get(name) ?? "";
    assert.match(value, pattern, `${name} is missing or unsafe`);
    observedHeaders[name] = value;
  }

  const evidence = {
    schemaVersion: 2,
    checkedAt: new Date().toISOString(),
    candidate: {
      buildId: expectedBuildId,
      homeRegion: expectedHomeRegion,
    },
    targets: {
      apiOrigin: apiUrl.origin,
      webOrigin: webUrl.origin,
      mediaOrigin: mediaUrl.origin,
      finalWebUrl: finalWebUrl.href,
    },
    health: { live: live.body, ready: ready.body, mediaStatus: mediaHealth.status },
    publicFeatures: features,
    syntheticWorkspace: {
      homeRegion: activeWorkspace.homeRegion,
      productFeatures: Object.fromEntries(
        Object.keys(expectedWorkspaceFeatures).map((feature) => [
          feature,
          productFeatures[feature],
        ]),
      ),
    },
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

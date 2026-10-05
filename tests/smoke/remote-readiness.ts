import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  assertSecureReadinessUrl,
  deploymentReceiptBinding,
  requiredBillingMode,
  requiredBoolean,
  requiredCookiePair,
  requiredEnvironmentString,
  requiredImmutableBuildId,
  requiredObserverToken,
  requiredObserverUrl,
  requiredProbeEmail,
  validateObjectStoreError,
  validateObserverReceipt,
} from "../support/readiness-contract.js";

type JsonObject = Record<string, unknown>;
type ObserverKind = "smtp" | "telemetry";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), "observer probe contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  assert.ok(value && typeof value === "object", "observer probe contains an invalid value");
  const record = value as JsonObject;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

async function main() {
  const apiUrl = requiredUrl("READINESS_API_URL");
  const webUrl = requiredUrl("READINESS_WEB_URL");
  const mediaUrl = requiredUrl("READINESS_MEDIA_URL");
  const allowHttp = process.env.READINESS_ALLOW_HTTP === "true";
  const outputPath =
    process.env.READINESS_OUTPUT?.trim() || "artifacts/readiness/remote-probe.json";
  const expectedBuildId = requiredImmutableBuildId(process.env, "READINESS_EXPECTED_BUILD_ID");
  const expectedImageRepository = requiredEnvironmentString(
    process.env,
    "READINESS_EXPECTED_IMAGE_REPOSITORY",
  );
  const creatorCookie = requiredCookiePair(process.env, "READINESS_CREATOR_COOKIE");
  const smtpProbeEmail = requiredProbeEmail(process.env, "READINESS_SMTP_PROBE_EMAIL");
  const smtpObserverUrl = requiredObserverUrl(process.env, "READINESS_SMTP_OBSERVER_URL");
  const smtpObserverToken = requiredObserverToken(process.env, "READINESS_SMTP_OBSERVER_TOKEN");
  const telemetryObserverUrl = requiredObserverUrl(process.env, "READINESS_TELEMETRY_OBSERVER_URL");
  const telemetryObserverToken = requiredObserverToken(
    process.env,
    "READINESS_TELEMETRY_OBSERVER_TOKEN",
  );
  const deployment = deploymentReceiptBinding(
    requiredEnvironmentString(process.env, "READINESS_DEPLOYMENT_RECEIPT_JSON"),
    expectedBuildId,
    expectedImageRepository,
  );
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
    presentationRealtime: requiredBoolean(process.env, "READINESS_EXPECT_PRESENTATION_REALTIME"),
    groups: requiredBoolean(process.env, "READINESS_EXPECT_GROUPS"),
    discover: requiredBoolean(process.env, "READINESS_EXPECT_DISCOVER"),
  };

  for (const target of [apiUrl, webUrl, mediaUrl]) assertSecureReadinessUrl(target, allowHttp);

  function requiredUrl(name: string) {
    const value = requiredEnvironmentString(process.env, name);
    let target: URL;
    try {
      target = new URL(value);
    } catch {
      assert.fail(`${name} must be a valid URL`);
    }
    assert.equal(target.pathname, "/", `${name} must be an origin without a path`);
    assert.equal(target.search, "", `${name} must not contain a query`);
    assert.equal(target.hash, "", `${name} must not contain a fragment`);
    return target;
  }

  function normalizedOrigin(value: string) {
    return new URL(value).origin;
  }

  function boundObserverPayload(kind: ObserverKind, probe: JsonObject) {
    const probeId = randomUUID();
    const base = {
      schemaVersion: 1,
      kind,
      candidateBuildId: expectedBuildId,
      probeId,
      probe,
    };
    const probeSha256 = createHash("sha256").update(canonicalJson(base)).digest("hex");
    return {
      payload: { ...base, probeSha256 },
      binding: { probeId, probeSha256 },
    };
  }

  async function request(
    pathOrUrl: string | URL,
    options: RequestInit & {
      target?: URL;
      cookie?: string;
      timeoutMilliseconds?: number;
      label?: string;
    } = {},
  ) {
    const {
      target = apiUrl,
      cookie,
      timeoutMilliseconds = 15_000,
      label = "readiness",
      ...init
    } = options;
    const url = pathOrUrl instanceof URL ? pathOrUrl : new URL(pathOrUrl, target);
    const headers = new Headers(init.headers);
    headers.set("user-agent", "openround-readiness-probe/2.0");
    if (cookie) headers.set("cookie", cookie);
    try {
      return await fetch(url, {
        redirect: "manual",
        ...init,
        headers,
        signal: AbortSignal.timeout(timeoutMilliseconds),
      });
    } catch {
      throw new Error(`${label} request failed`);
    }
  }

  async function jsonResponse(
    path: string,
    options: RequestInit & {
      cookie?: string;
      expectedStatus?: number;
      label?: string;
    } = {},
  ) {
    const { expectedStatus = 200, label = path, ...init } = options;
    const response = await request(path, { ...init, label });
    assert.equal(response.status, expectedStatus, `${label} returned an unexpected status`);
    let body: JsonObject;
    try {
      body = (await response.json()) as JsonObject;
    } catch {
      throw new Error(`${label} did not return JSON`);
    }
    assert.ok(body && typeof body === "object" && !Array.isArray(body), `${label} JSON is invalid`);
    return { response, body };
  }

  async function mutationJson(
    path: string,
    method: "POST" | "PATCH" | "DELETE",
    body: JsonObject,
    expectedStatus = 200,
    label = path,
  ) {
    return jsonResponse(path, {
      method,
      cookie: creatorCookie,
      expectedStatus,
      label,
      headers: {
        origin: webUrl.origin,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  async function proveRedirect(label: string, target: URL, path: string) {
    assert.equal(target.protocol, "https:", `${label} redirect target must use HTTPS`);
    assert.equal(target.port, "", `${label} redirect proof requires the standard HTTPS port`);
    const insecure = new URL(path, `http://${target.hostname}`);
    const expected = new URL(path, target);
    const response = await request(insecure, { label: `${label} HTTP redirect` });
    assert.ok(
      [301, 302, 307, 308].includes(response.status),
      `${label} HTTP endpoint did not redirect`,
    );
    const location = response.headers.get("location");
    assert.ok(location, `${label} HTTP redirect omitted Location`);
    assert.equal(
      new URL(location, insecure).href,
      expected.href,
      `${label} HTTP redirect did not resolve to the exact HTTPS endpoint`,
    );
    return { status: response.status, exactHttpsLocation: true };
  }

  const redirects = allowHttp
    ? { skipped: "loopback-development-only" }
    : {
        api: await proveRedirect("API", apiUrl, "/health/live"),
        web: await proveRedirect("web", webUrl, "/"),
        media: await proveRedirect("media", mediaUrl, "/minio/health/live"),
      };

  const live = await jsonResponse("/health/live", { label: "liveness" });
  assert.equal(live.body.status, "ok", "liveness status must be ok");
  assert.equal(
    live.body.buildId,
    expectedBuildId,
    "deployed server build does not match READINESS_EXPECTED_BUILD_ID",
  );

  const ready = await jsonResponse("/health/ready", { label: "readiness" });
  assert.equal(ready.body.status, "ready", "readiness status must be ready");
  assert.deepEqual(ready.body.dependencies, { database: "ready", coordination: "ready" });
  if (expectedFeatures.mediaUploads) {
    assert.equal(ready.body.storage, "configured", "media-enabled staging must configure storage");
    assert.equal(ready.body.mediaScanning, "enabled", "media-enabled staging must enable scanning");
  }

  const mediaHealth = await request("/minio/health/live", {
    target: mediaUrl,
    redirect: "follow",
    label: "media health",
  });
  assert.equal(mediaHealth.status, 200, "public media TLS origin is not healthy");
  assert.equal(
    new URL(mediaHealth.url).origin,
    mediaUrl.origin,
    "public media health redirected to an unexpected origin",
  );

  const featuresResult = await jsonResponse("/v1/features", { label: "public features" });
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

  const account = await jsonResponse("/v1/auth/me", {
    cookie: creatorCookie,
    label: "synthetic account",
  });
  const productFeatures = account.body.productFeatures as JsonObject | undefined;
  assert.ok(productFeatures, "authenticated account omitted productFeatures");
  for (const [feature, expected] of Object.entries(expectedWorkspaceFeatures)) {
    assert.equal(
      productFeatures[feature],
      expected,
      `synthetic workspace ${feature} does not match its required expectation`,
    );
  }

  const workspaceResult = await jsonResponse("/v1/workspaces", {
    cookie: creatorCookie,
    label: "synthetic workspaces",
  });
  const activeWorkspaceId = workspaceResult.body.activeWorkspaceId;
  const workspaces = workspaceResult.body.workspaces;
  assert.equal(typeof activeWorkspaceId, "string", "workspace response omitted activeWorkspaceId");
  assert.ok(Array.isArray(workspaces), "workspace response omitted workspaces");
  const activeWorkspace = (workspaces as JsonObject[]).find(
    (workspace) => workspace.id === activeWorkspaceId,
  );
  assert.ok(activeWorkspace, "active synthetic workspace was not returned");
  assert.equal(
    activeWorkspace.homeRegion,
    expectedHomeRegion,
    "synthetic workspace is not assigned to the expected home region",
  );

  const metrics = await request("/metrics", { label: "public metrics boundary" });
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
  const web = await request("/", { target: webUrl, redirect: "follow", label: "web root" });
  const finalWebUrl = new URL(web.url);
  assert.equal(finalWebUrl.href, expectedWebRoot.href, "web root redirected unexpectedly");
  if (!allowHttp) assert.equal(finalWebUrl.protocol, "https:", "final web root must use HTTPS");
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
  const observedHeaders: Record<string, string> = { "x-openround-build-id": expectedBuildId };
  for (const [name, pattern] of Object.entries(requiredHeaders)) {
    const value = web.headers.get(name) ?? "";
    assert.match(value, pattern, `${name} is missing or unsafe`);
    observedHeaders[name] = value;
  }

  async function requireStorageError(
    response: Response,
    expectedStatus: number,
    expectedCode: "AccessDenied" | "NoSuchKey",
    label: string,
  ) {
    const source = await response.text();
    return validateObjectStoreError(
      response.status,
      response.headers.get("content-type"),
      source,
      expectedStatus,
      expectedCode,
      label,
    );
  }

  async function proveMediaRoundTrip() {
    assert.equal(expectedFeatures.mediaUploads, true, "remote media proof requires media uploads");
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    let mediaId: string | null = null;
    let signedDownloadUrl: URL | null = null;
    let proof: JsonObject | null = null;
    let cleanup: {
      publicMetadataUnavailable: boolean;
      objectRemoved: boolean;
      objectStatus: number | null;
      objectErrorCode: string | null;
    } = {
      publicMetadataUnavailable: false,
      objectRemoved: false,
      objectStatus: null,
      objectErrorCode: null,
    };
    try {
      const ticketResult = await mutationJson(
        "/v1/media",
        "POST",
        {
          fileName: "remote-readiness.png",
          mimeType: "image/png",
          sizeBytes: bytes.byteLength,
          altText: "One-pixel remote readiness fixture",
        },
        201,
        "media upload ticket",
      );
      mediaId = String(ticketResult.body.mediaId ?? "");
      assert.match(mediaId, /^[0-9a-f-]{36}$/i, "media upload ticket omitted its identifier");
      assert.equal(ticketResult.body.scanStatus, "pending", "new media must start pending");
      const uploadUrl = new URL(String(ticketResult.body.uploadUrl ?? ""));
      assertSecureReadinessUrl(uploadUrl, false);
      assert.equal(uploadUrl.origin, mediaUrl.origin, "media upload used an unexpected origin");
      assert.ok(
        !uploadUrl.username && !uploadUrl.password,
        "media upload URL embedded credentials",
      );

      const uploaded = await request(uploadUrl, {
        method: "PUT",
        redirect: "error",
        label: "presigned media upload",
        headers: {
          "content-type": "image/png",
          "content-length": String(bytes.byteLength),
        },
        body: bytes,
      });
      assert.equal(uploaded.status, 200, "presigned media upload failed");

      let completed: JsonObject | null = null;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const response = await request(`/v1/media/${mediaId}/complete`, {
          method: "POST",
          cookie: creatorCookie,
          label: "media finalization",
          headers: { origin: webUrl.origin, "content-type": "application/json" },
          body: "{}",
        });
        if (response.status === 409) {
          await sleep(2_500);
          continue;
        }
        assert.equal(response.status, 200, "media finalization returned an unexpected status");
        try {
          completed = (await response.json()) as JsonObject;
        } catch {
          throw new Error("media finalization did not return JSON");
        }
        break;
      }
      assert.ok(completed, "media scanner did not finalize before the probe deadline");
      const completedMedia = completed.media as JsonObject | undefined;
      assert.equal(
        completedMedia?.scanStatus,
        "clean",
        "media scanner did not mark the fixture clean",
      );

      const anonymousMetadata = await request(`/v1/media/${mediaId}`, {
        label: "anonymous media metadata",
      });
      assert.equal(anonymousMetadata.status, 401, "media metadata must require authentication");

      const authenticated = await jsonResponse(`/v1/media/${mediaId}`, {
        cookie: creatorCookie,
        label: "authenticated media metadata",
      });
      const authenticatedMedia = authenticated.body.media as JsonObject | undefined;
      assert.equal(authenticatedMedia?.id, mediaId, "authenticated media metadata ID mismatch");
      assert.equal(authenticatedMedia?.scanStatus, "clean", "authenticated media is not clean");
      signedDownloadUrl = new URL(String(authenticated.body.downloadUrl ?? ""));
      assertSecureReadinessUrl(signedDownloadUrl, false);
      assert.equal(
        signedDownloadUrl.origin,
        mediaUrl.origin,
        "media download used an unexpected origin",
      );

      const unsignedDownloadUrl = new URL(signedDownloadUrl);
      unsignedDownloadUrl.search = "";
      unsignedDownloadUrl.hash = "";
      const unsigned = await request(unsignedDownloadUrl, {
        redirect: "error",
        label: "unsigned media download",
      });
      const unsignedErrorCode = await requireStorageError(
        unsigned,
        403,
        "AccessDenied",
        "unsigned media download",
      );

      const downloaded = await request(signedDownloadUrl, {
        redirect: "error",
        label: "signed media download",
      });
      assert.equal(downloaded.status, 200, "signed media download failed");
      const downloadedBytes = Buffer.from(await downloaded.arrayBuffer());
      assert.deepEqual(downloadedBytes, bytes, "downloaded media bytes differ from the upload");
      proof = {
        uploadStatus: uploaded.status,
        scanStatus: "clean",
        anonymousMetadataStatus: anonymousMetadata.status,
        authenticatedMetadataStatus: authenticated.response.status,
        unsignedDownloadDenied: true,
        unsignedDownloadStatus: unsigned.status,
        unsignedDownloadErrorCode: unsignedErrorCode,
        signedDownloadStatus: downloaded.status,
        sizeBytes: bytes.byteLength,
        contentSha256,
        byteEquality: true,
      };
    } finally {
      if (mediaId) {
        const deleted = await request(`/v1/media/${mediaId}`, {
          method: "DELETE",
          cookie: creatorCookie,
          label: "media cleanup",
          headers: { origin: webUrl.origin },
        });
        assert.equal(deleted.status, 204, "media cleanup did not delete the fixture");
        const metadataAfterDelete = await request(`/v1/media/${mediaId}`, {
          cookie: creatorCookie,
          label: "media cleanup metadata verification",
        });
        assert.equal(
          metadataAfterDelete.status,
          404,
          "media cleanup did not hide the deletion tombstone",
        );
        cleanup = { ...cleanup, publicMetadataUnavailable: true };
        if (signedDownloadUrl) {
          for (let attempt = 0; attempt < 10; attempt += 1) {
            const objectAfterDelete = await request(signedDownloadUrl, {
              redirect: "error",
              label: "media cleanup object verification",
            });
            if (objectAfterDelete.status === 404) {
              const objectErrorCode = await requireStorageError(
                objectAfterDelete,
                404,
                "NoSuchKey",
                "media cleanup object verification",
              );
              cleanup = {
                ...cleanup,
                objectRemoved: true,
                objectStatus: 404,
                objectErrorCode,
              };
              break;
            }
            if (objectAfterDelete.status !== 200) {
              throw new Error("media cleanup object verification returned an unexpected status");
            }
            await objectAfterDelete.arrayBuffer();
            await sleep(500);
          }
          assert.equal(cleanup.objectRemoved, true, "media cleanup left the object downloadable");
        }
      }
    }
    assert.ok(proof, "media round-trip proof did not complete");
    return { ...proof, cleanup };
  }

  const media = await proveMediaRoundTrip();

  async function activeProbeInvitationIds() {
    const listing = await jsonResponse("/v1/workspace/members", {
      cookie: creatorCookie,
      label: "workspace invitation cleanup listing",
    });
    assert.ok(Array.isArray(listing.body.invitations), "workspace invitation listing is invalid");
    return (listing.body.invitations as JsonObject[])
      .filter(
        (invitation) =>
          invitation.email === smtpProbeEmail &&
          invitation.acceptedAt === null &&
          invitation.revokedAt === null,
      )
      .map((invitation) => String(invitation.id));
  }

  async function revokeProbeInvitations() {
    for (const invitationId of await activeProbeInvitationIds()) {
      const response = await request(`/v1/workspace/invitations/${invitationId}`, {
        method: "DELETE",
        cookie: creatorCookie,
        label: "workspace invitation cleanup",
        headers: { origin: webUrl.origin },
      });
      assert.ok(
        response.status === 204 || response.status === 404,
        "workspace invitation cleanup returned an unexpected status",
      );
    }
  }

  async function observerReceipt(
    kind: ObserverKind,
    target: URL,
    token: string,
    payload: JsonObject,
    notBefore: Date,
    expectedProbe: { probeId: string; probeSha256: string },
  ) {
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      const response = await request(target, {
        method: "POST",
        redirect: "error",
        timeoutMilliseconds: 20_000,
        label: `${kind} observer`,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (response.status === 200) {
        const source = await response.text();
        assert.ok(
          source.length > 0 && source.length <= 16_384,
          `${kind} observer receipt is invalid`,
        );
        let parsed: unknown;
        try {
          parsed = JSON.parse(source);
        } catch {
          throw new Error(`${kind} observer receipt was not valid JSON`);
        }
        return validateObserverReceipt(parsed, kind, expectedBuildId, notBefore, expectedProbe);
      }
      if (response.status !== 202 && response.status !== 404) {
        throw new Error(`${kind} observer rejected the probe with status ${response.status}`);
      }
      await sleep(5_000);
    }
    throw new Error(`${kind} observer did not confirm delivery before the probe deadline`);
  }

  await revokeProbeInvitations();
  let smtpCleanupComplete = false;
  let smtpReceipt: ReturnType<typeof validateObserverReceipt> | null = null;
  let telemetryReceipt: ReturnType<typeof validateObserverReceipt> | null = null;
  let telemetryBinding: { traceId: string; requestId: string; metricName: string } | null = null;
  try {
    const smtpSentAfter = new Date();
    const invitation = await mutationJson(
      "/v1/workspace/invitations",
      "POST",
      { email: smtpProbeEmail, role: "viewer" },
      201,
      "SMTP probe invitation",
    );
    assert.equal(
      Object.hasOwn(invitation.body, "debugUrl"),
      false,
      "hosted SMTP probe returned a development-only invitation URL",
    );
    const invitationRecord = invitation.body.invitation as JsonObject | undefined;
    if (invitationRecord?.email !== smtpProbeEmail) {
      throw new Error("SMTP probe invitation recipient mismatch");
    }
    const smtpObserver = boundObserverPayload("smtp", {
      recipient: smtpProbeEmail,
      subject: "Join an OpenRound workspace",
      sentAfter: smtpSentAfter.toISOString(),
    });

    const telemetryObservedAfter = new Date();
    const requestId = `readiness-${randomUUID()}`;
    const telemetryTrigger = await request("/v1/features", {
      label: "telemetry trigger",
      headers: { "x-request-id": requestId },
    });
    assert.equal(telemetryTrigger.status, 200, "telemetry trigger returned an unexpected status");
    assert.equal(
      telemetryTrigger.headers.get("x-request-id"),
      requestId,
      "telemetry trigger did not preserve its request ID",
    );
    const traceId = telemetryTrigger.headers.get("x-trace-id") ?? "";
    assert.match(traceId, /^[0-9a-f]{32}$/, "telemetry trigger did not expose a valid trace ID");
    const metricName = "openround_http_request_duration_seconds_count";
    telemetryBinding = { traceId, requestId, metricName };
    const telemetryObserver = boundObserverPayload("telemetry", {
      traceId,
      requestId,
      metricName,
      observedAfter: telemetryObservedAfter.toISOString(),
    });

    [smtpReceipt, telemetryReceipt] = await Promise.all([
      observerReceipt(
        "smtp",
        smtpObserverUrl,
        smtpObserverToken,
        smtpObserver.payload,
        smtpSentAfter,
        smtpObserver.binding,
      ),
      observerReceipt(
        "telemetry",
        telemetryObserverUrl,
        telemetryObserverToken,
        telemetryObserver.payload,
        telemetryObservedAfter,
        telemetryObserver.binding,
      ),
    ]);
  } finally {
    await revokeProbeInvitations();
    smtpCleanupComplete = (await activeProbeInvitationIds()).length === 0;
  }
  assert.ok(smtpReceipt, "SMTP observer proof did not complete");
  assert.ok(telemetryReceipt, "telemetry observer proof did not complete");
  assert.ok(telemetryBinding, "telemetry correlation binding did not complete");
  assert.equal(smtpCleanupComplete, true, "SMTP probe invitation cleanup did not complete");

  const evidence = {
    schemaVersion: 3,
    checkedAt: new Date().toISOString(),
    candidate: {
      buildId: expectedBuildId,
      homeRegion: expectedHomeRegion,
      deployment,
    },
    targets: {
      apiOrigin: apiUrl.origin,
      webOrigin: webUrl.origin,
      mediaOrigin: mediaUrl.origin,
      finalWebUrl: finalWebUrl.href,
    },
    redirects,
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
    media,
    smtp: {
      deliveryObserved: true,
      receipt: smtpReceipt,
      invitationCleanupComplete: smtpCleanupComplete,
    },
    telemetry: {
      ...telemetryBinding,
      receipt: telemetryReceipt,
    },
    metrics: metricsExpectation,
    securityHeaders: observedHeaders,
    redaction: {
      observerUrlsIncluded: false,
      observerCredentialsIncluded: false,
      smtpRecipientIncluded: false,
      signedMediaUrlsIncluded: false,
    },
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

main().catch(() => {
  // Inputs include a synthetic recipient, bearer credentials, and signed object URLs. Never emit
  // caught error values: platform assertion/fetch implementations may interpolate private data.
  process.stderr.write(
    "Remote readiness failed before a complete redaction-safe receipt was produced.\n",
  );
  process.exitCode = 1;
});

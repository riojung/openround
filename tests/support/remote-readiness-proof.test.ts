import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

async function source(path: string) {
  return readFile(resolve(root, path), "utf8");
}

describe("hosted remote-readiness proof", () => {
  it("wires every private observer input without putting it in the job-wide environment", async () => {
    const workflow = await source(".github/workflows/staging-readiness.yml");
    for (const name of [
      "OPENROUND_SMTP_PROBE_EMAIL",
      "OPENROUND_SMTP_OBSERVER_URL",
      "OPENROUND_SMTP_OBSERVER_TOKEN",
      "OPENROUND_TELEMETRY_OBSERVER_URL",
      "OPENROUND_TELEMETRY_OBSERVER_TOKEN",
      "OPENROUND_DEPLOYMENT_RECEIPT_JSON",
    ]) {
      expect(workflow).toContain(`secrets.${name}`);
    }
    expect(workflow).toContain("READINESS_EXPECTED_IMAGE_REPOSITORY");
    const jobEnvironment = workflow.slice(
      workflow.indexOf("  remote-readiness:"),
      workflow.indexOf("    steps:", workflow.indexOf("  remote-readiness:")),
    );
    expect(jobEnvironment).not.toContain("OBSERVER_TOKEN");
    expect(jobEnvironment).not.toContain("OBSERVER_URL");
    expect(jobEnvironment).not.toContain("SMTP_PROBE_EMAIL");
    expect(jobEnvironment).not.toContain("DEPLOYMENT_RECEIPT_JSON");
  });

  it("covers redirects, real private media, SMTP, and all three correlated telemetry signals", async () => {
    const probe = await source("tests/smoke/remote-readiness.ts");
    for (const required of [
      'proveRedirect("API", apiUrl, "/health/live")',
      'proveRedirect("web", webUrl, "/")',
      'proveRedirect("media", mediaUrl, "/minio/health/live")',
      '"/v1/media"',
      'method: "PUT"',
      "/complete",
      'method: "DELETE"',
      "downloaded media bytes differ from the upload",
      '"AccessDenied"',
      '"NoSuchKey"',
      '"/v1/workspace/invitations"',
      'boundObserverPayload("smtp"',
      'boundObserverPayload("telemetry"',
      "traceId",
      "requestId",
      "openround_http_request_duration_seconds_count",
      "probeSha256",
      "canonicalJson",
    ]) {
      expect(probe).toContain(required);
    }

    const evidenceSource = probe.slice(probe.indexOf("  const evidence ="));
    expect(evidenceSource).not.toContain("smtpObserverUrl");
    expect(evidenceSource).not.toContain("smtpObserverToken");
    expect(evidenceSource).not.toContain("telemetryObserverUrl");
    expect(evidenceSource).not.toContain("telemetryObserverToken");
    expect(evidenceSource).not.toContain("smtpProbeEmail");
    expect(evidenceSource).not.toContain("signedDownloadUrl");
    expect(probe).not.toContain("error.message");
  });

  it("binds receipts to manifest/images and keeps log collection outside the overlay", async () => {
    const [deploy, overlay, runtimeExample] = await Promise.all([
      source("scripts/ops/deploy.mjs"),
      source("compose.single-vm.observability.yaml"),
      source(".env.single-vm.example"),
    ]);
    expect(deploy).toContain("source = await readFile(path)");
    expect(deploy).toContain('sha256: createHash("sha256").update(source).digest("hex")');
    expect(deploy).toContain("manifestSha256,");
    expect(deploy).not.toContain("manifestSha256: await sha256File(manifestPath)");
    expect(deploy).toContain('logs: "external-host-agent"');
    expect(runtimeExample).toContain("OPENROUND_LOG_SHIPPING_MODE=external-host-agent");
    expect(overlay).not.toContain("docker.sock");
    expect(overlay).not.toContain("/var/lib/docker");
    expect(overlay).not.toContain("/var/log/containers");
  });
});

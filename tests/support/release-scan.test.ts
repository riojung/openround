import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { finalizeImages, scanImagesForVulnerabilities } from "../../scripts/ops/product-build.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const serverRef = `ghcr.io/example/openround-server@sha256:${"a".repeat(64)}`;
const webRef = `ghcr.io/example/openround-web@sha256:${"b".repeat(64)}`;

describe("release image vulnerability evidence", () => {
  it("scans both immutable references before reporting vulnerability failures", async () => {
    const runCommand = vi.fn(async (_command: string, args: string[]) => {
      throw new Error(`vulnerable: ${args.at(-1)}`);
    });

    await expect(
      scanImagesForVulnerabilities(
        {
          server: { ref: serverRef },
          web: { ref: webRef },
        },
        runCommand,
      ),
    ).rejects.toThrow("Vulnerability scan failed for server, web");

    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(runCommand.mock.calls.map(([, args]) => args.at(-1))).toEqual([serverRef, webRef]);
    for (const [, args] of runCommand.mock.calls) {
      expect(args).toContain("HIGH,CRITICAL");
      expect(args).toContain("--ignore-unfixed");
      expect(args).toContain("--exit-code");
      expect(args).toContain("1");
    }
  });

  it("keeps both SARIF scans on the explicitly installed Trivy CLI", async () => {
    const workflow = await readFile(join(repositoryRoot, ".github/workflows/release.yml"), "utf8");
    const actionScans = workflow
      .split("      - uses: aquasecurity/trivy-action@v0.36.0")
      .slice(1)
      .map((section) => section.split("\n      - ", 1)[0]);

    expect(actionScans).toHaveLength(2);
    for (const scan of actionScans) {
      expect(scan).toMatch(/if: always\(\) && steps\.manifest\.outcome == 'success'/);
      expect(scan).toMatch(/limit-severities-for-sarif: true/);
      expect(scan).toMatch(/skip-setup-trivy: true/);
    }
    expect(workflow).toMatch(/version: v0\.68\.2/);
    expect(workflow).toMatch(
      /printf '%s\\n' "\$image_ref" > "artifacts\/release\/\$component\/ref\.txt"/,
    );
  });

  it("does not sign either image when either pre-sign vulnerability scan fails", async () => {
    const imageRecords = {
      server: { ref: serverRef, signed: false },
      web: { ref: webRef, signed: false },
    };
    const runCommand = vi.fn(async (command: string, args: string[]) => {
      if (command === "trivy" && args.at(-1) === serverRef) {
        throw new Error("server is vulnerable");
      }
      return { stdout: "", stderr: "" };
    });

    await expect(
      finalizeImages(imageRecords, {
        config: {
          requireSigning: true,
          cosignIdentityRegexp: "^https://github\\.com/example/openround/.*$",
          cosignOidcIssuer: "https://token.actions.githubusercontent.com",
        },
        shouldSign: true,
        runCommand,
      }),
    ).rejects.toThrow("Vulnerability scan failed for server");

    expect(runCommand.mock.calls.map(([command]) => command)).toEqual(["trivy", "trivy"]);
    expect(imageRecords.server.signed).toBe(false);
    expect(imageRecords.web.signed).toBe(false);
  });

  it("runs both SARIF scans before finalization and keeps promotion success-only", async () => {
    const workflow = await readFile(join(repositoryRoot, ".github/workflows/release.yml"), "utf8");
    const prepare = workflow.indexOf("--prepare");
    const serverScan = workflow.indexOf("name: Scan server image");
    const webScan = workflow.indexOf("name: Scan web image");
    const finalize = workflow.indexOf("--finalize");

    expect(prepare).toBeGreaterThan(-1);
    expect(serverScan).toBeGreaterThan(prepare);
    expect(webScan).toBeGreaterThan(serverScan);
    expect(finalize).toBeGreaterThan(webScan);
    expect(workflow).toMatch(/- name: Upload deployment manifest\n\s+if: success\(\)/);
  });
});

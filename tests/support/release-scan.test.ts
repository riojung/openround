import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { finalizeImages, scanImagesForVulnerabilities } from "../../scripts/ops/product-build.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowDirectory = join(repositoryRoot, ".github/workflows");
const serverRef = `ghcr.io/example/openround-server@sha256:${"a".repeat(64)}`;
const webRef = `ghcr.io/example/openround-web@sha256:${"b".repeat(64)}`;

function workflowActionPinningViolations(filename: string, workflow: string) {
  const violations: string[] = [];

  for (const [index, line] of workflow.split("\n").entries()) {
    const reference = line.match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/)?.[1];
    if (!reference || reference.startsWith("./")) continue;

    const immutable = reference.startsWith("docker://")
      ? /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/.test(reference)
      : /^[^@\s]+@[0-9a-f]{40}$/.test(reference);
    if (!immutable) violations.push(`${filename}:${index + 1}: ${reference}`);
  }

  return violations;
}

describe("workflow action supply chain", () => {
  it("pins every external action to an immutable revision", async () => {
    const workflowFiles = (await readdir(workflowDirectory)).filter((name) =>
      /\.ya?ml$/.test(name),
    );
    const violations: string[] = [];

    for (const filename of workflowFiles) {
      const workflow = await readFile(join(workflowDirectory, filename), "utf8");
      violations.push(...workflowActionPinningViolations(filename, workflow));
    }

    expect(violations, `Mutable external action references:\n${violations.join("\n")}`).toEqual([]);
  });

  it("accepts commit-pinned actions, digest-pinned containers, and local actions", () => {
    const workflow = [
      `- uses: owner/action@${"a".repeat(40)} # v1`,
      `- uses: docker://ghcr.io/example/action@sha256:${"b".repeat(64)}`,
      "- uses: ./.github/actions/local",
    ].join("\n");

    expect(workflowActionPinningViolations("fixture.yml", workflow)).toEqual([]);
  });

  it("rejects mutable and malformed container action references", () => {
    const workflow = [
      "- uses: docker://ghcr.io/example/action:latest",
      "- uses: docker://ghcr.io/example/action:v1.2.3",
      "- uses: docker://ghcr.io/example/action@sha256:abc123",
      "- uses: owner/action@v4",
    ].join("\n");

    expect(workflowActionPinningViolations("fixture.yml", workflow)).toEqual([
      "fixture.yml:1: docker://ghcr.io/example/action:latest",
      "fixture.yml:2: docker://ghcr.io/example/action:v1.2.3",
      "fixture.yml:3: docker://ghcr.io/example/action@sha256:abc123",
      "fixture.yml:4: owner/action@v4",
    ]);
  });
});

describe("staging readiness trust boundary", () => {
  it("uses a default-branch repository dispatch with a fail-closed payload", async () => {
    const workflow = await readFile(
      join(repositoryRoot, ".github/workflows/staging-readiness.yml"),
      "utf8",
    );
    const mainCandidate = workflow.match(
      / {2}main-candidate:\n([\s\S]*?)(?=\n {2}remote-readiness:)/,
    )?.[1];

    expect(mainCandidate).toBeDefined();
    expect(workflow).toContain("repository_dispatch:\n    types: [staging-readiness]");
    expect(workflow).not.toContain("workflow_dispatch:");
    expect(mainCandidate).not.toMatch(/^ {4}if:/m);
    expect(mainCandidate).not.toContain("environment:");
    expect(mainCandidate).toContain("fetch-depth: 0");
    expect(mainCandidate).toContain('test "$GITHUB_EVENT_NAME" = repository_dispatch');
    expect(mainCandidate).toContain(
      "git fetch --force origin '+refs/heads/main:refs/remotes/origin/main'",
    );
    expect(mainCandidate).toContain('test "$GITHUB_REF" = refs/heads/main');
    expect(mainCandidate).toContain(
      'test "$(git rev-parse --verify HEAD)" = "$(git rev-parse --verify origin/main)"',
    );
    expect(mainCandidate).toContain('new Set(["run_stripe_replay", "soak_minutes"])');
    expect(mainCandidate).toContain('typeof runStripeReplay !== "boolean"');
    expect(mainCandidate).toContain('typeof soakMinutes !== "string"');
    expect(mainCandidate).toContain('["0", "15", "60"].includes(soakMinutes)');
    expect(mainCandidate).toContain(
      "run_stripe_replay: ${{ steps.payload.outputs.run_stripe_replay }}",
    );
    expect(mainCandidate).toContain("soak_minutes: ${{ steps.payload.outputs.soak_minutes }}");

    expect(workflow).toContain("needs.main-candidate.outputs.soak_minutes != '0'");
    expect(workflow).toContain("SOAK_MINUTES: ${{ needs.main-candidate.outputs.soak_minutes }}");
    expect(workflow).toContain("needs.main-candidate.outputs.run_stripe_replay == 'true'");
    expect(workflow).not.toMatch(/\binputs\.(?:soak_minutes|run_stripe_replay)\b/);

    for (const [job, dependency] of [
      ["remote-readiness", "needs: main-candidate"],
      ["target-region-load", "needs: [main-candidate, remote-readiness]"],
      ["stripe-replay", "needs: [main-candidate, remote-readiness]"],
    ] as const) {
      const section = workflow.match(new RegExp(`  ${job}:\\n([\\s\\S]*?)(?=\\n  \\S|$)`))?.[1];

      expect(section, `${job} job`).toBeDefined();
      expect(section).toContain("github.ref == 'refs/heads/main'");
      expect(section).toContain(dependency);
    }
  });
});

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
      expect(args).not.toContain("--ignore-unfixed");
      expect(args).toContain("--exit-code");
      expect(args).toContain("1");
    }
  });

  it("keeps both SARIF scans on the explicitly installed Trivy CLI", async () => {
    const workflow = await readFile(join(repositoryRoot, ".github/workflows/release.yml"), "utf8");
    const actionScans = workflow
      .split(/^[ \t]+- uses: aquasecurity\/trivy-action@[0-9a-f]{40}[^\n]*$/gm)
      .slice(1)
      .map((section) => section.split("\n      - ", 1)[0]);

    expect(actionScans).toHaveLength(2);
    for (const scan of actionScans) {
      expect(scan).toMatch(/if: always\(\) && steps\.manifest\.outcome == 'success'/);
      expect(scan).not.toMatch(/ignore-unfixed:/);
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

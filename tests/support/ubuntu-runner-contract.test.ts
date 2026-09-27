import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function repositoryFile(path: string) {
  return readFile(join(repositoryRoot, path), "utf8");
}

type WorkflowStep = {
  env?: Record<string, string>;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
};

type WorkflowJob = {
  "runs-on"?: string | string[];
  steps?: WorkflowStep[];
};

type Workflow = {
  jobs?: Record<string, WorkflowJob>;
  on?: {
    pull_request?: { paths?: string[] };
    schedule?: Array<{ cron?: string }>;
    workflow_dispatch?: unknown;
  };
  permissions?: Record<string, string>;
};

function parseWorkflow(source: string) {
  const workflow = parse(source) as Workflow;
  if (!workflow.jobs) {
    throw new Error("Expected workflow jobs");
  }
  return workflow as Workflow & { jobs: Record<string, WorkflowJob> };
}

function step(job: WorkflowJob, name: string) {
  return job.steps?.find((candidate) => candidate.name === name);
}

describe("GitHub-hosted runner migration contract", () => {
  it("exercises the runner-sensitive Ubuntu 26 paths without claiming capacity evidence", async () => {
    const [workflow, runbook, status] = await Promise.all([
      repositoryFile(".github/workflows/ubuntu-26-canary.yml"),
      repositoryFile("docs/runbooks/ubuntu-26-runner-migration.md"),
      repositoryFile("docs/implementation-status.md"),
    ]);

    const parsed = parseWorkflow(workflow);
    expect(parsed.permissions).toEqual({ contents: "read" });
    expect(parsed.on?.pull_request?.paths).toContain(".github/workflows/*.yml");
    expect(parsed.on?.pull_request?.paths).toContain(".dockerignore");
    expect(parsed.on?.schedule?.[0]?.cron).toBe("43 10 * * 2");
    for (const job of [
      "check",
      "postgres-migration",
      "browser-smoke",
      "production-compose",
      "image-toolchain",
    ]) {
      expect(parsed.jobs[job]?.["runs-on"]).toBe("ubuntu-26.04");
    }
    for (const job of ["check", "postgres-migration", "browser-smoke", "production-compose"]) {
      const setupNode = parsed.jobs[job].steps?.find(({ uses }) =>
        uses?.startsWith("actions/setup-node@820762786026740c76f36085b0efc47a31fe5020"),
      );
      expect(setupNode?.with?.["node-version"]).toBe(22);
    }
    expect(parsed.jobs.check.steps?.some(({ run }) => run === "pnpm check")).toBe(true);
    expect(
      parsed.jobs["browser-smoke"].steps?.some(
        ({ run }) => run === "pnpm exec playwright install --with-deps chromium firefox webkit",
      ),
    ).toBe(true);
    expect(
      parsed.jobs["production-compose"].steps?.some(({ run }) => run === "pnpm smoke:restore"),
    ).toBe(true);
    expect(
      parsed.jobs["production-compose"].steps?.some(({ run }) =>
        run?.includes("pnpm smoke:multi-process"),
      ),
    ).toBe(true);
    expect(
      step(
        parsed.jobs["production-compose"],
        "100-client correctness, latency, and restart recovery",
      )?.env?.ASSERT_PERFORMANCE,
    ).toBe("false");
    expect(step(parsed.jobs["image-toolchain"], "Build server and web images")?.run).toContain(
      "docker buildx build",
    );
    expect(step(parsed.jobs["image-toolchain"], "Scan canary images")?.run).toContain(
      "trivy image",
    );
    const trivySetup = parsed.jobs["image-toolchain"].steps?.find(
      ({ name }) => name === "Install Trivy CLI",
    );
    expect(trivySetup?.uses).toBe(
      "aquasecurity/setup-trivy@81e514348e19b6112ce2a7e3ecbafe19c1e1f567",
    );
    expect(trivySetup?.with?.version).toBe("v0.74.0");
    expect(
      parsed.jobs["image-toolchain"].steps?.some(
        ({ uses }) => uses === "sigstore/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6",
      ),
    ).toBe(true);
    expect(
      step(parsed.jobs["image-toolchain"], "Sign and verify a local canary payload")?.run,
    ).toContain("--use-signing-config=false");
    expect(
      step(parsed.jobs["image-toolchain"], "Sign and verify a local canary payload")?.run,
    ).toContain("--insecure-ignore-tlog");
    expect(runbook).toMatch(/October 19 and\s+November 19, 2026/);
    expect(runbook).toMatch(/is not target-region capacity evidence/i);
    expect(runbook).toContain("replaces every GitHub-hosted `runs-on: ubuntu-latest` label");
    expect(runbook).toContain("temporary rollback");
    expect(status).toMatch(/Ubuntu 26 canary exercises native builds/);
    expect(status).toMatch(/do not complete a pending readiness gate/);
  });

  it("pins every GitHub-hosted workflow job to Ubuntu 26", async () => {
    const workflowDirectory = join(repositoryRoot, ".github/workflows");
    const filenames = (await readdir(workflowDirectory)).filter((name) => name.endsWith(".yml"));
    const hostedRunners: Array<{ file: string; job: string; runner: string }> = [];

    for (const filename of filenames) {
      const workflow = parseWorkflow(await readFile(join(workflowDirectory, filename), "utf8"));
      for (const [job, definition] of Object.entries(workflow.jobs)) {
        if (typeof definition["runs-on"] === "string") {
          hostedRunners.push({ file: filename, job, runner: definition["runs-on"] });
        }
      }
    }

    expect(hostedRunners.length).toBeGreaterThan(0);
    expect(hostedRunners.filter(({ runner }) => runner !== "ubuntu-26.04")).toEqual([]);
  });

  it("uses the reviewed published Trivy release in every image workflow", async () => {
    for (const path of [
      ".github/workflows/release.yml",
      ".github/workflows/staging-images.yml",
      ".github/workflows/ubuntu-26-canary.yml",
    ]) {
      const workflow = parseWorkflow(await repositoryFile(path));
      const setupSteps = Object.values(workflow.jobs)
        .flatMap(({ steps = [] }) => steps)
        .filter(({ uses }) => uses?.startsWith("aquasecurity/setup-trivy@"));

      expect(setupSteps, path).not.toHaveLength(0);
      for (const setup of setupSteps) {
        expect(setup.uses, path).toBe(
          "aquasecurity/setup-trivy@81e514348e19b6112ce2a7e3ecbafe19c1e1f567",
        );
        expect(setup.with?.version, path).toBe("v0.74.0");
      }
    }
  });

  it("uses the Cosign 3 installer in every signed-image workflow", async () => {
    for (const path of [
      ".github/workflows/release.yml",
      ".github/workflows/staging-images.yml",
      ".github/workflows/ubuntu-26-canary.yml",
    ]) {
      const workflow = parseWorkflow(await repositoryFile(path));
      const installers = Object.values(workflow.jobs)
        .flatMap(({ steps = [] }) => steps)
        .filter(({ uses }) => uses?.startsWith("sigstore/cosign-installer@"));

      expect(installers, path).not.toHaveLength(0);
      for (const installer of installers) {
        expect(installer.uses, path).toBe(
          "sigstore/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6",
        );
      }
    }
  });
});

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main as deployMain } from "../../scripts/ops/deploy.mjs";
import {
  assertNoEnvironmentKeyOverlap,
  composeArgv,
  expectedDeploymentConfirmation,
  expectedProductionConfirmation,
  expectedRollbackConfirmation,
  normalizeEnvironment,
  parseCliArguments,
  parseFlyTomlEnvironment,
  run,
  validateBuildManifest,
  validateDeployConfig,
  validateDeploymentConfirmation,
  validateEnvFileKeys,
  validateFlyRuntimeEnvironment,
  validateFlyWebEnvironment,
  validateProductionConfirmation,
  validateRollbackConfirmation,
} from "../../scripts/ops/lib.mjs";
import { main as productBuildMain, withPreservedFiles } from "../../scripts/ops/product-build.mjs";
import { main as serviceMain } from "../../scripts/ops/service.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const buildId = "a".repeat(40);
const serverDigest = `sha256:${"b".repeat(64)}`;
const webDigest = `sha256:${"c".repeat(64)}`;

function stagingConfig() {
  return {
    schemaVersion: 1,
    environment: "staging",
    deploymentMode: "fly",
    publicWebUrl: "https://staging.example.test",
    publicApiUrl: "https://api.staging.example.test",
    imageRepository: "ghcr.io/example/openround",
    imagePlatform: "linux/amd64",
    billingMode: "disabled",
    fly: {
      serverApp: "openround-staging-server",
      webApp: "openround-staging-web",
      serverConfig: "config/deploy/fly/staging-server.toml",
      webConfig: "config/deploy/fly/staging-web.toml",
    },
    health: {
      timeoutSeconds: 300,
      intervalSeconds: 5,
      requestTimeoutSeconds: 8,
    },
    requireSigning: false,
    requireReadinessGate: false,
  };
}

function productionConfig() {
  return {
    ...stagingConfig(),
    environment: "production",
    publicWebUrl: "https://example.test",
    publicApiUrl: "https://api.example.test",
    billingMode: "stripe",
    fly: {
      serverApp: "openround-production-server",
      webApp: "openround-production-web",
      serverConfig: "config/deploy/fly/production-server.toml",
      webConfig: "config/deploy/fly/production-web.toml",
    },
    requireSigning: true,
    requireReadinessGate: true,
    readinessTarget: "canadian-beta",
    cosignIdentityRegexp: "^https://github\\.com/example/openround/.*$",
    cosignOidcIssuer: "https://token.actions.githubusercontent.com",
  };
}

function buildManifest(environment = "staging", manifestBuildId = buildId) {
  const repository = "ghcr.io/riojung/openround/openround";
  return {
    schemaVersion: 1,
    environment,
    buildId: manifestBuildId,
    createdAt: "2026-09-21T00:00:00.000Z",
    nextPublicApiUrl: `https://openround-ca-${environment === "production" ? "" : "staging-"}server.fly.dev`,
    imagePlatform: "linux/amd64",
    source: { commit: manifestBuildId, dirty: false },
    images: {
      server: {
        repository: `${repository}-server`,
        tag: `${repository}-server:${environment}-${manifestBuildId}`,
        digest: serverDigest,
        ref: `${repository}-server@${serverDigest}`,
        signed: environment === "production",
      },
      web: {
        repository: `${repository}-web`,
        tag: `${repository}-web:${environment}-${manifestBuildId}`,
        digest: webDigest,
        ref: `${repository}-web@${webDigest}`,
        signed: environment === "production",
      },
    },
  };
}

async function captureStdout(operation: () => Promise<void>) {
  let output = "";
  const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  try {
    await operation();
    return output;
  } finally {
    write.mockRestore();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("operations environment contract", () => {
  it("normalizes the documented development alias and rejects unknown environments", () => {
    expect(normalizeEnvironment(" dev ")).toBe("development");
    expect(normalizeEnvironment("STAGING")).toBe("staging");
    expect(normalizeEnvironment("production")).toBe("production");
    expect(() => normalizeEnvironment("preview")).toThrow("Unsupported environment");
  });

  it("keeps runtime and migration credentials in separate environment files", () => {
    expect(
      validateEnvFileKeys("DATABASE_URL=postgres://runtime\nSESSION_SECRET=value", "runtime"),
    ).toEqual(["DATABASE_URL", "SESSION_SECRET"]);
    expect(
      validateEnvFileKeys(
        "DATABASE_MIGRATION_URL=postgres://owner\nOPENROUND_MIGRATIONS_DIR=/app/migrations",
        "migration",
      ),
    ).toEqual(["DATABASE_MIGRATION_URL", "OPENROUND_MIGRATIONS_DIR"]);

    expect(() => validateEnvFileKeys("DATABASE_MIGRATION_URL=postgres://owner", "runtime")).toThrow(
      "runtime environment must not contain DATABASE_MIGRATION_URL",
    );
    expect(() => validateEnvFileKeys("DATABASE_URL=postgres://runtime", "migration")).toThrow(
      "migration environment must not contain DATABASE_URL",
    );
  });

  it("rejects runtime or provider secrets that override reviewed Fly environment keys", () => {
    expect(
      assertNoEnvironmentKeyOverlap(
        ["DATABASE_URL", "SESSION_SECRET"],
        ["NODE_ENV", "PUBLIC_API_URL"],
        "runtime environment file",
        "checked Fly environment",
      ),
    ).toBe(true);
    expect(() =>
      assertNoEnvironmentKeyOverlap(
        ["DATABASE_URL", "PUBLIC_API_URL"],
        ["NODE_ENV", "PUBLIC_API_URL"],
        "Fly secrets",
        "checked Fly environment",
      ),
    ).toThrow("Fly secrets and checked Fly environment must not both define: PUBLIC_API_URL");
  });

  it("keeps deployment credentials out of every Docker build context", async () => {
    const dockerIgnore = await readFile(join(repositoryRoot, ".dockerignore"), "utf8");
    expect(dockerIgnore).toMatch(/^artifacts$/m);
    expect(dockerIgnore).toMatch(/^\.deploy$/m);
    expect(dockerIgnore).toMatch(/^\*\.runtime\.env$/m);
    expect(dockerIgnore).toMatch(/^\*\*\/\*\.runtime\.env$/m);
    expect(dockerIgnore).toMatch(/^\*\.migration\.env$/m);
    expect(dockerIgnore).toMatch(/^\*\*\/\*\.migration\.env$/m);
  });

  it("requires an environment and exact full build ID for deployment confirmation", () => {
    expect(expectedDeploymentConfirmation("staging", buildId)).toBe(`staging:${buildId}`);
    expect(expectedProductionConfirmation(buildId)).toBe(`production:${buildId}`);
    expect(validateDeploymentConfirmation(`staging:${buildId}`, "staging", buildId)).toBe(true);
    expect(validateProductionConfirmation(`production:${buildId}`, buildId)).toBe(true);
    expect(() =>
      validateDeploymentConfirmation(`production:${buildId}`, "staging", buildId),
    ).toThrow("Deployment confirmation must exactly match");
    expect(() =>
      validateProductionConfirmation(`production:${buildId.slice(0, 12)}`, buildId),
    ).toThrow("Production confirmation must exactly match");
  });

  it("binds rollback confirmation to the target and currently running full build IDs", () => {
    const targetBuildId = "d".repeat(40);
    const confirmation = `rollback:production:${targetBuildId}:from:${buildId}`;
    expect(expectedRollbackConfirmation("production", targetBuildId, buildId)).toBe(confirmation);
    expect(validateRollbackConfirmation(confirmation, "production", targetBuildId, buildId)).toBe(
      true,
    );
    expect(() =>
      validateRollbackConfirmation(confirmation, "staging", targetBuildId, buildId),
    ).toThrow("Rollback confirmation must exactly match");
    expect(() => expectedRollbackConfirmation("production", buildId, buildId)).toThrow(
      "must differ",
    );
  });
});

describe("deployment configuration and manifest validation", () => {
  it("accepts a complete hosted config and rejects target, URL, and production-gate drift", () => {
    expect(validateDeployConfig(stagingConfig(), "staging").environment).toBe("staging");
    expect(validateDeployConfig(productionConfig(), "production").environment).toBe("production");

    expect(() => validateDeployConfig(stagingConfig(), "production")).toThrow(
      "does not match target",
    );
    expect(() =>
      validateDeployConfig(
        { ...stagingConfig(), publicApiUrl: "http://api.example.test" },
        "staging",
      ),
    ).toThrow("publicApiUrl must be a credential-free HTTPS URL");
    expect(() =>
      validateDeployConfig(
        { ...stagingConfig(), publicApiUrl: "https://api.example.test/v1" },
        "staging",
      ),
    ).toThrow(/origin/);
    expect(() =>
      validateDeployConfig({ ...productionConfig(), requireSigning: false }, "production"),
    ).toThrow("production must require image signing");
    expect(() => validateDeployConfig({ ...stagingConfig(), unexpected: true }, "staging")).toThrow(
      "unsupported key unexpected",
    );
  });

  it("accepts only digest-pinned, internally consistent image manifests", () => {
    const manifest = buildManifest();
    expect(
      validateBuildManifest(manifest, {
        environment: "staging",
        buildId,
        imageRepository: "ghcr.io/riojung/openround/openround",
        imagePlatform: "linux/amd64",
        publicApiUrl: "https://openround-ca-staging-server.fly.dev",
      }),
    ).toBe(manifest);

    const mutableReference = structuredClone(manifest);
    mutableReference.images.server.ref = mutableReference.images.server.tag;
    expect(() =>
      validateBuildManifest(mutableReference, {
        environment: "staging",
        imageRepository: "ghcr.io/riojung/openround/openround",
        imagePlatform: "linux/amd64",
      }),
    ).toThrow("must exactly match repository and digest");

    const malformedDigest = structuredClone(manifest);
    malformedDigest.images.web.digest = "sha256:not-a-digest";
    expect(() =>
      validateBuildManifest(malformedDigest, {
        environment: "staging",
        imageRepository: "ghcr.io/riojung/openround/openround",
        imagePlatform: "linux/amd64",
      }),
    ).toThrow("images.web.digest must be sha256");
  });

  it("rejects a web image compiled for a different public API", () => {
    expect(() =>
      validateBuildManifest(buildManifest(), {
        environment: "staging",
        imageRepository: "ghcr.io/riojung/openround/openround",
        imagePlatform: "linux/amd64",
        publicApiUrl: "https://other-api.example.test",
      }),
    ).toThrow("NEXT_PUBLIC_API_URL does not match the target config");
  });

  it("validates the exact non-secret Fly environments and rejects secret or URL drift", async () => {
    const checkedConfig = validateDeployConfig(
      JSON.parse(await readFile(join(repositoryRoot, "config/deploy/staging.json"), "utf8")),
      "staging",
    );
    const serverEnvironment = parseFlyTomlEnvironment(
      await readFile(join(repositoryRoot, checkedConfig.fly.serverConfig), "utf8"),
    );
    const webEnvironment = parseFlyTomlEnvironment(
      await readFile(join(repositoryRoot, checkedConfig.fly.webConfig), "utf8"),
    );

    expect(validateFlyRuntimeEnvironment(serverEnvironment, checkedConfig)).toBe(serverEnvironment);
    expect(validateFlyWebEnvironment(webEnvironment, checkedConfig)).toBe(webEnvironment);
    expect(() =>
      validateFlyRuntimeEnvironment(
        { ...serverEnvironment, DATABASE_URL: "postgresql://secret" },
        checkedConfig,
      ),
    ).toThrow(/unsupported key DATABASE_URL|secret-bearing key DATABASE_URL/);
    expect(() =>
      validateFlyWebEnvironment(
        { ...webEnvironment, NEXT_PUBLIC_API_URL: "https://wrong.example.test" },
        checkedConfig,
      ),
    ).toThrow("NEXT_PUBLIC_API_URL");
  });
});

describe("local service command construction", () => {
  it("uses bounded, non-destructive Compose commands for the lifecycle actions", () => {
    const prefix = ["compose", "--project-name", "openround", "--file", "compose.yaml"];
    expect(composeArgv("start")).toEqual([...prefix, "up", "--detach", "--build", "--wait"]);
    expect(composeArgv("stop")).toEqual([...prefix, "stop"]);
    expect(composeArgv("restart", { noBuild: true })).toEqual([
      ...prefix,
      "up",
      "--detach",
      "--force-recreate",
      "--no-build",
      "--wait",
    ]);
    expect(composeArgv("logs")).toEqual([...prefix, "logs", "--tail", "200"]);
    expect(composeArgv("logs", { follow: true })).toEqual([
      ...prefix,
      "logs",
      "--follow",
      "--tail",
      "200",
    ]);

    for (const action of ["start", "stop", "restart", "status", "logs"]) {
      const argv = composeArgv(action);
      expect(argv).not.toContain("down");
      expect(argv).not.toContain("--volumes");
    }
  });

  it("selects only the fixed Compose files for named profiles", () => {
    expect(composeArgv("status", { profile: "media" })).toContain("compose.media.yaml");
    const observability = composeArgv("status", { profile: "observability" });
    expect(observability).toEqual([
      "compose",
      "--project-name",
      "openround",
      "--file",
      "compose.yaml",
      "--file",
      "compose.media.yaml",
      "--file",
      "compose.observability.yaml",
      "--profile",
      "observability",
      "ps",
    ]);
    expect(() => composeArgv("start", { profile: "../../arbitrary" })).toThrow(
      "Unsupported Compose profile",
    );
  });
});

describe("operations CLI dry runs", () => {
  it("restores generated tracked files after successful and failed host builds", async () => {
    const artifactsRoot = join(repositoryRoot, "artifacts");
    await mkdir(artifactsRoot, { recursive: true });
    const fixtureRoot = await mkdtemp(join(artifactsRoot, "preserved-build-file "));
    const generatedPath = join(fixtureRoot, "generated.d.ts");
    try {
      await writeFile(generatedPath, "original\n");
      await withPreservedFiles([generatedPath], async () => {
        await writeFile(generatedPath, "generated\n");
      });
      expect(await readFile(generatedPath, "utf8")).toBe("original\n");

      await expect(
        withPreservedFiles([generatedPath], async () => {
          await writeFile(generatedPath, "failed build output\n");
          throw new Error("build failed");
        }),
      ).rejects.toThrow("build failed");
      expect(await readFile(generatedPath, "utf8")).toBe("original\n");
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("accepts development build and service dry runs without Docker", async () => {
    const buildOutput = await captureStdout(() => productBuildMain(["dev", "--dry-run"]));
    expect(buildOutput).toContain("pnpm check:docker-context");
    expect(buildOutput).toContain("pnpm build");
    expect(buildOutput).toContain("docker compose");
    expect(buildOutput).toContain("Dry run complete for development");

    const serviceOutput = await captureStdout(() =>
      serviceMain(["development", "restart", "--profile", "media", "--no-build", "--dry-run"]),
    );
    expect(serviceOutput).toContain("docker compose");
    expect(serviceOutput).toContain("compose.media.yaml");
    expect(serviceOutput).toContain("--force-recreate");
    expect(serviceOutput).not.toContain(" down ");
    expect(serviceOutput).not.toContain("--volumes");
  });

  it("rejects hosted service control and hosted build options that omit explicit push", async () => {
    await expect(serviceMain(["staging", "start", "--dry-run"])).rejects.toThrow(
      "service.sh is development-only",
    );
    await expect(
      productBuildMain([
        "staging",
        "--api-url",
        "https://api.staging.example.test",
        "--registry",
        "ghcr.io/example/openround",
        "--dry-run",
      ]),
    ).rejects.toThrow("Hosted builds require explicit --push");
    await expect(
      deployMain(["development", "--confirm", `development:${buildId}`, "--dry-run"]),
    ).rejects.toThrow("Hosted deployment options are not valid for development");
  });

  it("rejects hosted build target drift and manifest output outside the deployment artifacts", async () => {
    await expect(
      productBuildMain([
        "staging",
        "--api-url",
        "https://wrong.example.test",
        "--registry",
        "ghcr.io/riojung/openround/openround",
        "--push",
        "--dry-run",
      ]),
    ).rejects.toThrow("--api-url must exactly match");
    await expect(
      productBuildMain([
        "staging",
        "--api-url",
        "https://openround-ca-staging-server.fly.dev",
        "--registry",
        "ghcr.io/riojung/openround/openround",
        "--push",
        "--manifest",
        "package.json",
        "--dry-run",
      ]),
    ).rejects.toThrow("build manifest output must be inside");
  });

  it("preserves spaces and apostrophes as single argv values", async () => {
    const unusualPath = "/tmp/OpenRound team's reviewed manifest.json";
    const parsed = parseCliArguments(["--manifest", unusualPath], {
      valueOptions: ["manifest"],
    });
    expect(parsed.values.get("manifest")).toBe(unusualPath);

    const output = await captureStdout(() =>
      run("example-command", ["--manifest", unusualPath], { dryRun: true }).then(() => undefined),
    );
    expect(output).toContain("example-command --manifest");
    expect(output).toContain("OpenRound team");

    const executed = await run(
      process.execPath,
      ["-e", "process.stdout.write(process.argv[1])", unusualPath],
      { capture: true },
    );
    expect(executed.stdout).toBe(unusualPath);
  });

  it("validates and prints a complete hosted deployment without invoking providers", async () => {
    const artifactsRoot = join(repositoryRoot, "artifacts", "deploy", "staging");
    await mkdir(artifactsRoot, { recursive: true });
    const fixtureRoot = await mkdtemp(join(artifactsRoot, "operations team's dry run "));
    const manifestPath = join(fixtureRoot, "reviewed build manifest.json");
    const runtimePath = join(fixtureRoot, "runtime credentials.env");
    const migrationPath = join(fixtureRoot, "migration owner's credentials.env");
    try {
      await writeFile(manifestPath, `${JSON.stringify(buildManifest(), null, 2)}\n`);
      await writeFile(runtimePath, "DATABASE_URL=postgres://runtime\n", { mode: 0o600 });
      await writeFile(migrationPath, "DATABASE_MIGRATION_URL=postgres://owner\n", {
        mode: 0o600,
      });

      const output = await captureStdout(() =>
        deployMain([
          "staging",
          "--manifest",
          manifestPath,
          "--runtime-env",
          runtimePath,
          "--migration-env",
          migrationPath,
          "--confirm",
          `staging:${buildId}`,
          "--dry-run",
        ]),
      );
      expect(output.match(/flyctl config validate --strict/g)).toHaveLength(2);
      expect(output).toContain("--app openround-ca-staging-server");
      expect(output).toContain("--app openround-ca-staging-web");
      expect(output.lastIndexOf("flyctl config validate --strict")).toBeLessThan(
        output.indexOf("dist/migrate.js"),
      );
      expect(output).toContain("docker run");
      expect(output).toContain("flyctl deploy");
      expect(output).toContain("Dry run complete");
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("prints a code-only rollback without accepting or running migration credentials", async () => {
    const artifactsRoot = join(repositoryRoot, "artifacts", "deploy", "staging");
    await mkdir(artifactsRoot, { recursive: true });
    const fixtureRoot = await mkdtemp(join(artifactsRoot, "operations rollback dry run "));
    const historyPath = join(fixtureRoot, "history.txt");
    const manifestPath = join(fixtureRoot, "rollback build manifest.json");
    const runtimePath = join(fixtureRoot, "runtime credentials.env");
    const previousGitDirectory = process.env.GIT_DIR;
    const previousGitWorkTree = process.env.GIT_WORK_TREE;
    try {
      await run("git", ["init", "--quiet"], { cwd: fixtureRoot, capture: true });
      await run("git", ["config", "user.name", "OpenRound Test"], {
        cwd: fixtureRoot,
        capture: true,
      });
      await run("git", ["config", "user.email", "test@example.invalid"], {
        cwd: fixtureRoot,
        capture: true,
      });
      await writeFile(historyPath, "rollback target\n");
      await run("git", ["add", "history.txt"], { cwd: fixtureRoot, capture: true });
      await run("git", ["commit", "--quiet", "--message", "rollback target"], {
        cwd: fixtureRoot,
        capture: true,
      });
      const targetBuildId = (
        await run("git", ["rev-parse", "--verify", "HEAD"], {
          cwd: fixtureRoot,
          capture: true,
        })
      ).stdout.trim();

      await writeFile(historyPath, "currently deployed source\n");
      await run("git", ["add", "history.txt"], { cwd: fixtureRoot, capture: true });
      await run("git", ["commit", "--quiet", "--message", "deployed source"], {
        cwd: fixtureRoot,
        capture: true,
      });
      const sourceBuildId = (
        await run("git", ["rev-parse", "--verify", "HEAD"], {
          cwd: fixtureRoot,
          capture: true,
        })
      ).stdout.trim();

      process.env.GIT_DIR = join(fixtureRoot, ".git");
      process.env.GIT_WORK_TREE = repositoryRoot;
      await writeFile(
        manifestPath,
        `${JSON.stringify(buildManifest("staging", targetBuildId), null, 2)}\n`,
      );
      await writeFile(runtimePath, "DATABASE_URL=postgres://runtime\n", { mode: 0o600 });

      const output = await captureStdout(() =>
        deployMain([
          "staging",
          "--rollback",
          "--rollback-from",
          sourceBuildId,
          "--manifest",
          manifestPath,
          "--runtime-env",
          runtimePath,
          "--confirm",
          `rollback:staging:${targetBuildId}:from:${sourceBuildId}`,
          "--dry-run",
        ]),
      );
      expect(output).toContain("Code rollback selected");
      expect(output).not.toContain("dist/migrate.js");
      expect(output).not.toContain("migration credentials");
      expect(output.match(/flyctl deploy/g)).toHaveLength(2);
    } finally {
      if (previousGitDirectory === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = previousGitDirectory;
      if (previousGitWorkTree === undefined) delete process.env.GIT_WORK_TREE;
      else process.env.GIT_WORK_TREE = previousGitWorkTree;
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("rejects deployment credential files outside the target's Docker-ignored subtree", async () => {
    const artifactsRoot = join(repositoryRoot, "artifacts");
    await mkdir(artifactsRoot, { recursive: true });
    const fixtureRoot = await mkdtemp(join(artifactsRoot, "outside target "));
    const manifestPath = join(fixtureRoot, "manifest.json");
    const runtimePath = join(fixtureRoot, "runtime.env");
    const migrationPath = join(fixtureRoot, "migration.env");
    try {
      await writeFile(manifestPath, `${JSON.stringify(buildManifest(), null, 2)}\n`);
      await writeFile(runtimePath, "DATABASE_URL=postgres://runtime\n", { mode: 0o600 });
      await writeFile(migrationPath, "DATABASE_MIGRATION_URL=postgres://owner\n", {
        mode: 0o600,
      });
      await expect(
        deployMain([
          "staging",
          "--manifest",
          manifestPath,
          "--runtime-env",
          runtimePath,
          "--migration-env",
          migrationPath,
          "--confirm",
          `staging:${buildId}`,
          "--dry-run",
        ]),
      ).rejects.toThrow("runtime environment file must be inside");
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});

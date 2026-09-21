#!/usr/bin/env node

import { lstat, open, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";
import {
  assertCommandAvailable,
  assertFullGitSha,
  assertNoEnvironmentKeyOverlap,
  assertPathWithin,
  assertPrivateIgnoredEnvFile,
  ensureIgnoredEnvFile,
  isHostedEnvironment,
  normalizeEnvironment,
  parseCliArguments,
  parseFlyTomlEnvironment,
  readStrictJson,
  run,
  validateBuildManifest,
  validateDeployConfig,
  validateDeploymentConfirmation,
  validateFlyRuntimeEnvironment,
  validateFlyWebEnvironment,
  validateRollbackConfirmation,
} from "./lib.mjs";
import { main as serviceMain } from "./service.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const staleLockAgeMilliseconds = 30 * 60 * 1_000;

function usage() {
  return `Usage: scripts/deploy.sh development [--dry-run]
       scripts/deploy.sh <staging|production> --config PATH --manifest PATH \\
         --runtime-env PATH --migration-env PATH --confirm ENVIRONMENT:BUILD_ID [options]
       scripts/deploy.sh --environment <environment> [options]

Production additionally requires --backup-reference REFERENCE. Use --recover-lock only after
verifying the recorded local owner is gone and the lock is stale. A rollback requires --rollback,
--rollback-from CURRENT_BUILD_ID, and the exact rollback confirmation shown by the command contract;
it omits the owner migration credential and never reverses schema.`;
}

function configFileName(environment) {
  return environment === "development" ? "dev.json" : `${environment}.json`;
}

function strictTargetPath(path, expectedRelative, label) {
  const expected = resolve(repositoryRoot, expectedRelative);
  const selected = resolve(repositoryRoot, path ?? expectedRelative);
  if (selected !== expected) {
    throw new Error(`${label} must be the checked-in target file ${expectedRelative}`);
  }
  return selected;
}

function backupReference(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{2,199}$/.test(value)) {
    throw new Error("--backup-reference must be a non-secret provider backup identifier");
  }
  return value;
}

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}

async function recoverDeploymentLock(path, environment) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Refusing to recover non-regular deployment lock ${path}`);
  }
  let record;
  try {
    record = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Refusing to recover unreadable deployment lock ${path}`, { cause: error });
  }
  const startedAt = Date.parse(record.startedAt);
  if (
    record.schemaVersion !== 1 ||
    record.environment !== environment ||
    !Number.isInteger(record.pid) ||
    record.pid <= 0 ||
    typeof record.hostname !== "string" ||
    !record.hostname ||
    Number.isNaN(startedAt)
  ) {
    throw new Error(`Refusing to recover invalid deployment lock ${path}`);
  }
  const age = Date.now() - startedAt;
  if (age < staleLockAgeMilliseconds) {
    throw new Error("Deployment lock is not old enough for explicit recovery");
  }
  if (record.hostname === hostname() && processIsRunning(record.pid)) {
    throw new Error(`Deployment lock owner PID ${record.pid} is still running on this host`);
  }
  const recoveredPath = `${path}.recovered-${new Date().toISOString().replaceAll(":", "-")}`;
  await rename(path, recoveredPath);
  process.stdout.write(`Recovered stale deployment lock to ${recoveredPath}.\n`);
}

async function acquireLock(environment, buildId, { recover = false } = {}) {
  const directory = join(repositoryRoot, ".deploy", "locks");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${environment}.lock`);
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") {
      if (!recover) {
        throw new Error(
          `A ${environment} deployment lock already exists at ${relative(repositoryRoot, path)}; inspect it and use --recover-lock only when its owner is gone`,
          { cause: error },
        );
      }
      await recoverDeploymentLock(path, environment);
      handle = await open(path, "wx", 0o600);
    } else {
      throw error;
    }
  }
  await handle.writeFile(
    `${JSON.stringify({ schemaVersion: 1, environment, buildId, pid: process.pid, hostname: hostname(), startedAt: new Date().toISOString() })}\n`,
  );
  await handle.close();
  return path;
}

async function writeReceipt({
  environment,
  buildId,
  config,
  manifestPath,
  backup,
  startedAt,
  rollback,
  rollbackFrom,
}) {
  const completedAt = new Date().toISOString();
  const timestamp = completedAt.replaceAll(":", "-");
  const directory = join(repositoryRoot, "artifacts", "deploy", environment, "receipts");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${timestamp}-${buildId}.json`);
  const receipt = {
    schemaVersion: 1,
    environment,
    buildId,
    operation: rollback ? "rollback" : "deploy",
    ...(rollbackFrom ? { rollbackFrom } : {}),
    startedAt,
    completedAt,
    manifest: relative(repositoryRoot, manifestPath),
    images: {
      server: config.manifest.images.server.ref,
      web: config.manifest.images.web.ref,
    },
    fly: { serverApp: config.fly.serverApp, webApp: config.fly.webApp },
    ...(backup ? { backupReference: backup } : {}),
    verification: {
      configuration: true,
      imageBuildIds: true,
      migration: rollback ? "skipped_for_code_rollback" : "applied",
      migrationSkipped: rollback,
      serverLive: true,
      serverReady: true,
      webBuildId: true,
    },
  };
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o644 });
  await rename(temporary, path);
  return path;
}

async function request(url, timeoutSeconds) {
  return await globalThis.fetch(url, {
    redirect: "error",
    signal: globalThis.AbortSignal.timeout(timeoutSeconds * 1_000),
  });
}

async function delay(milliseconds) {
  await sleep(milliseconds);
}

export async function waitForDeploymentHealth(config, buildId) {
  const deadline = Date.now() + config.health.timeoutSeconds * 1_000;
  let lastProblem = "no response received";
  while (Date.now() < deadline) {
    try {
      const liveResponse = await request(
        `${config.publicApiUrl}/health/live`,
        config.health.requestTimeoutSeconds,
      );
      const live = liveResponse.ok ? await liveResponse.json() : null;
      const readyResponse = await request(
        `${config.publicApiUrl}/health/ready`,
        config.health.requestTimeoutSeconds,
      );
      const ready = readyResponse.ok ? await readyResponse.json() : null;
      if (live?.status === "ok" && live.buildId === buildId && ready?.status === "ready") return;
      lastProblem = `server live=${liveResponse.status}, ready=${readyResponse.status}, build=${String(live?.buildId ?? "missing")}`;
    } catch (error) {
      lastProblem = error.message;
    }
    await delay(config.health.intervalSeconds * 1_000);
  }
  throw new Error(`Server health did not converge before timeout (${lastProblem})`);
}

export async function waitForWebBuild(config, buildId) {
  const deadline = Date.now() + config.health.timeoutSeconds * 1_000;
  let lastProblem = "no response received";
  while (Date.now() < deadline) {
    try {
      const response = await request(config.publicWebUrl, config.health.requestTimeoutSeconds);
      const runningBuild = response.headers.get("x-openround-build-id");
      if (response.ok && runningBuild === buildId) return;
      lastProblem = `web status=${response.status}, build=${runningBuild ?? "missing"}`;
    } catch (error) {
      lastProblem = error.message;
    }
    await delay(config.health.intervalSeconds * 1_000);
  }
  throw new Error(`Web build ID did not converge before timeout (${lastProblem})`);
}

function assertConfigCheckSummary(summary, config, buildId) {
  const expected = {
    valid: true,
    buildId,
    nodeEnvironment: "production",
    publicApiUrl: config.publicApiUrl,
    webOrigin: config.publicWebUrl,
    communityMode: false,
    persistence: "postgresql",
    coordination: "redis-streams",
    billing: config.billingMode,
    metrics: "disabled",
  };
  for (const [key, value] of Object.entries(expected)) {
    if (summary?.[key] !== value) {
      throw new Error(`The exact server image config-check returned unexpected ${key}`);
    }
  }
  for (const key of [
    "signups",
    "roundExperiences",
    "audiencePulse",
    "roomChat",
    "uxBeta",
    "recoveryRehearsal",
    "practiceAssignments",
    "workspaceShell",
    "builderV2",
    "presentations",
    "groups",
    "discover",
  ]) {
    if (summary.featureFlags?.[key] !== false) {
      throw new Error(`The exact server image config-check left feature flag ${key} enabled`);
    }
  }
  for (const key of ["sessionCreation", "mediaUploads"]) {
    if (summary.featureFlags?.[key] !== true) {
      throw new Error(`The exact server image config-check disabled core feature flag ${key}`);
    }
  }
}

async function verifyConfigCheck(serverImage, runtimeEnv, config, flyEnvironment, buildId, dryRun) {
  const args = ["run", "--rm", "--platform", config.imagePlatform, "--env-file", runtimeEnv];
  for (const [key, value] of Object.entries(flyEnvironment).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    args.push("--env", `${key}=${value}`);
  }
  args.push("--entrypoint", "node", serverImage, "dist/config-check.js");
  if (dryRun) {
    await run("docker", args, { cwd: repositoryRoot, dryRun: true });
    return;
  }
  const result = await run("docker", args, { cwd: repositoryRoot, capture: true });
  let summary;
  try {
    summary = JSON.parse(result.stdout);
  } catch {
    throw new Error("The server image config-check did not return valid JSON");
  }
  assertConfigCheckSummary(summary, config, buildId);
  process.stdout.write(`Server configuration validated for build ${buildId}.\n`);
}

async function verifyEmbeddedWebBuild(webImage, config, buildId, dryRun) {
  const args = [
    "run",
    "--rm",
    "--platform",
    config.imagePlatform,
    "--entrypoint",
    "/bin/cat",
    webImage,
    "/app/BUILD_ID",
  ];
  if (dryRun) {
    await run("docker", args, { cwd: repositoryRoot, dryRun: true });
    return;
  }
  const result = await run("docker", args, { cwd: repositoryRoot, capture: true });
  if (result.stdout.trim() !== buildId) {
    throw new Error("The exact web image contains a different /app/BUILD_ID");
  }
  process.stdout.write(`Web image build ID validated for build ${buildId}.\n`);
}

async function verifyRollbackSource(config, rollbackFrom, targetBuildId, dryRun) {
  if (dryRun) {
    process.stdout.write(
      `[dry-run] verify current ${config.environment} deployment build is ${rollbackFrom}\n`,
    );
    return;
  }
  const response = await request(
    `${config.publicApiUrl}/health/live`,
    config.health.requestTimeoutSeconds,
  );
  let live;
  try {
    live = response.ok ? await response.json() : undefined;
  } catch {
    throw new Error("The current deployment live endpoint did not return valid JSON");
  }
  const expectedBuildIds = new Set([rollbackFrom, targetBuildId]);
  if (!response.ok || live?.status !== "ok" || !expectedBuildIds.has(live.buildId)) {
    throw new Error(
      "Rollback found an unexpected server build; the environment is not in a recoverable source/target state",
    );
  }
  const webResponse = await request(config.publicWebUrl, config.health.requestTimeoutSeconds);
  const webBuildId = webResponse.headers.get("x-openround-build-id");
  if (!webResponse.ok || !expectedBuildIds.has(webBuildId)) {
    throw new Error(
      "Rollback found an unexpected web build; the environment is not in a recoverable source/target state",
    );
  }
}

async function verifyRollbackAncestry(targetBuildId, sourceBuildId) {
  try {
    await run("git", ["merge-base", "--is-ancestor", targetBuildId, sourceBuildId], {
      cwd: repositoryRoot,
      capture: true,
    });
  } catch (error) {
    throw new Error(
      "Rollback target must be a Git ancestor of --rollback-from; fetch the release history and verify the selected manifests",
      { cause: error },
    );
  }
}

async function verifySignatures(config, manifest, dryRun) {
  if (!config.requireSigning) return;
  for (const component of ["server", "web"]) {
    await run(
      "cosign",
      [
        "verify",
        "--certificate-identity-regexp",
        config.cosignIdentityRegexp,
        "--certificate-oidc-issuer",
        config.cosignOidcIssuer,
        manifest.images[component].ref,
      ],
      { cwd: repositoryRoot, dryRun },
    );
  }
}

async function verifyFlySecretSeparation(
  app,
  reviewedEnvironment,
  dryRun,
  requiredSecretKeys = [],
) {
  const args = ["secrets", "list", "--app", app, "--json"];
  if (dryRun) {
    await run("flyctl", args, { cwd: repositoryRoot, dryRun: true });
    return;
  }
  const result = await run("flyctl", args, { cwd: repositoryRoot, capture: true });
  let records;
  try {
    records = JSON.parse(result.stdout);
  } catch {
    throw new Error(`flyctl did not return valid secret metadata for ${app}`);
  }
  if (!Array.isArray(records)) {
    throw new Error(`flyctl secret metadata for ${app} must be an array`);
  }
  const secretKeys = records.map((record) => record?.Name ?? record?.name);
  if (secretKeys.some((key) => typeof key !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(key))) {
    throw new Error(`flyctl returned invalid secret metadata for ${app}`);
  }
  const providerSecretKeys = new Set(secretKeys);
  const missing = [...new Set(requiredSecretKeys)]
    .filter((key) => !providerSecretKeys.has(key))
    .sort();
  if (missing.length > 0) {
    throw new Error(`Fly app ${app} is missing candidate runtime secrets: ${missing.join(", ")}`);
  }
  const required = new Set(requiredSecretKeys);
  const unexpected = secretKeys.filter((key) => !required.has(key)).sort();
  if (unexpected.length > 0) {
    throw new Error(
      `Fly app ${app} has secrets absent from the candidate environment: ${unexpected.join(", ")}`,
    );
  }
  assertNoEnvironmentKeyOverlap(
    secretKeys,
    Object.keys(reviewedEnvironment),
    `Fly secrets for ${app}`,
    "checked Fly environment",
  );
}

async function validateFlyConfigs(config, serverConfigPath, webConfigPath, dryRun) {
  for (const [app, configPath] of [
    [config.fly.serverApp, serverConfigPath],
    [config.fly.webApp, webConfigPath],
  ]) {
    await run("flyctl", ["config", "validate", "--strict", "--app", app, "--config", configPath], {
      cwd: repositoryRoot,
      dryRun,
    });
  }
}

async function deployHosted({ environment, parsed, dryRun }) {
  const expectedConfig = `config/deploy/${configFileName(environment)}`;
  const configPath = strictTargetPath(parsed.values.get("config"), expectedConfig, "--config");
  const config = await readStrictJson(configPath, validateDeployConfig, environment);
  const expectedServerConfig = `config/deploy/fly/${environment}-server.toml`;
  const serverConfigPath = strictTargetPath(
    config.fly.serverConfig,
    expectedServerConfig,
    "server Fly config",
  );
  const flyEnvironment = validateFlyRuntimeEnvironment(
    parseFlyTomlEnvironment(await readFile(serverConfigPath, "utf8")),
    config,
  );
  const configCheckEnvironment = {
    ...flyEnvironment,
    FEATURE_SESSION_CREATION: "true",
    FEATURE_MEDIA_UPLOADS: "true",
  };
  const expectedWebConfig = `config/deploy/fly/${environment}-web.toml`;
  const webConfigPath = strictTargetPath(config.fly.webConfig, expectedWebConfig, "web Fly config");
  const flyWebEnvironment = validateFlyWebEnvironment(
    parseFlyTomlEnvironment(await readFile(webConfigPath, "utf8")),
    config,
  );
  const manifestPath = resolve(
    repositoryRoot,
    parsed.values.get("manifest") ?? `artifacts/deploy/${environment}/build-manifest.json`,
  );
  const manifest = await readStrictJson(manifestPath, validateBuildManifest, {
    environment,
    imageRepository: config.imageRepository,
    imagePlatform: config.imagePlatform,
    publicApiUrl: config.publicApiUrl,
    requireSigning: config.requireSigning,
  });
  config.manifest = manifest;

  const rollback = parsed.flags.has("rollback");
  const rollbackFrom = parsed.values.get("rollback-from");
  if (rollback) {
    assertFullGitSha(rollbackFrom, "rollback source build ID");
    validateRollbackConfirmation(
      parsed.values.get("confirm"),
      environment,
      manifest.buildId,
      rollbackFrom,
    );
    await verifyRollbackAncestry(manifest.buildId, rollbackFrom);
  } else {
    if (rollbackFrom) throw new Error("--rollback-from requires --rollback");
    validateDeploymentConfirmation(parsed.values.get("confirm"), environment, manifest.buildId);
  }
  const runtimePath = parsed.values.get("runtime-env");
  const migrationPath = parsed.values.get("migration-env");
  if (!runtimePath || (!rollback && !migrationPath)) {
    throw new Error(
      "Hosted deployments require --runtime-env and, unless rolling back, --migration-env",
    );
  }
  if (rollback && migrationPath) {
    throw new Error("--migration-env must be omitted with --rollback");
  }
  const configuredSecretsRoot = join(repositoryRoot, "artifacts", "deploy", environment);
  const selectedRuntimePath = resolve(repositoryRoot, runtimePath);
  assertPathWithin(selectedRuntimePath, configuredSecretsRoot, "runtime environment file");
  const selectedMigrationPath = migrationPath ? resolve(repositoryRoot, migrationPath) : undefined;
  if (migrationPath) {
    assertPathWithin(selectedMigrationPath, configuredSecretsRoot, "migration environment file");
  }
  const secretsRoot = await realpath(configuredSecretsRoot);
  if (secretsRoot !== configuredSecretsRoot) {
    throw new Error(`Deployment secrets directory must not contain symlinked path components`);
  }
  const runtimeEnv = await assertPrivateIgnoredEnvFile(runtimePath, "runtime", repositoryRoot);
  const migrationEnv = migrationPath
    ? await assertPrivateIgnoredEnvFile(migrationPath, "migration", repositoryRoot)
    : undefined;
  if (runtimeEnv.absolute !== selectedRuntimePath) {
    throw new Error("runtime environment file path must not contain symlinked path components");
  }
  if (migrationPath && migrationEnv.absolute !== selectedMigrationPath) {
    throw new Error("migration environment file path must not contain symlinked path components");
  }
  assertPathWithin(runtimeEnv.absolute, secretsRoot, "runtime environment file");
  if (migrationEnv) {
    assertPathWithin(migrationEnv.absolute, secretsRoot, "migration environment file");
  }
  assertNoEnvironmentKeyOverlap(
    runtimeEnv.keys,
    Object.keys(configCheckEnvironment),
    "runtime environment file",
    "checked Fly environment",
  );
  await ensureIgnoredEnvFile(runtimeEnv, repositoryRoot, "runtime");
  if (migrationEnv) await ensureIgnoredEnvFile(migrationEnv, repositoryRoot, "migration");

  let backup;
  if (environment === "production") {
    backup = backupReference(parsed.values.get("backup-reference"));
  } else if (parsed.values.has("backup-reference")) {
    backup = backupReference(parsed.values.get("backup-reference"));
  }

  for (const command of [
    "docker",
    "flyctl",
    ...(rollback ? ["git"] : []),
    ...(config.requireSigning ? ["cosign"] : []),
  ]) {
    await assertCommandAvailable(command, { cwd: repositoryRoot, dryRun });
  }
  await validateFlyConfigs(config, serverConfigPath, webConfigPath, dryRun);
  if (config.requireReadinessGate) {
    await run(
      process.execPath,
      ["scripts/check-release-readiness.mjs", `--require=${config.readinessTarget}`],
      { cwd: repositoryRoot, dryRun },
    );
  }
  await verifySignatures(config, manifest, dryRun);
  await verifyFlySecretSeparation(
    config.fly.serverApp,
    configCheckEnvironment,
    dryRun,
    runtimeEnv.keys,
  );
  await verifyFlySecretSeparation(config.fly.webApp, flyWebEnvironment, dryRun);

  const startedAt = new Date().toISOString();
  const lockPath = dryRun
    ? undefined
    : await acquireLock(environment, manifest.buildId, {
        recover: parsed.flags.has("recover-lock"),
      });
  try {
    if (rollback) {
      await verifyRollbackSource(config, rollbackFrom, manifest.buildId, dryRun);
    }
    await verifyConfigCheck(
      manifest.images.server.ref,
      runtimeEnv.absolute,
      config,
      configCheckEnvironment,
      manifest.buildId,
      dryRun,
    );
    await verifyEmbeddedWebBuild(manifest.images.web.ref, config, manifest.buildId, dryRun);
    if (rollback) {
      process.stdout.write("Code rollback selected; forward-only database migration is skipped.\n");
    } else {
      await run(
        "docker",
        [
          "run",
          "--rm",
          "--platform",
          config.imagePlatform,
          "--env-file",
          migrationEnv.absolute,
          "--entrypoint",
          "node",
          manifest.images.server.ref,
          "dist/migrate.js",
        ],
        { cwd: repositoryRoot, dryRun },
      );
    }
    await run(
      "flyctl",
      [
        "deploy",
        "--config",
        config.fly.serverConfig,
        "--app",
        config.fly.serverApp,
        "--image",
        manifest.images.server.ref,
        "--remote-only",
        "--wait-timeout",
        `${config.health.timeoutSeconds}s`,
        "--yes",
      ],
      { cwd: repositoryRoot, dryRun },
    );
    if (!dryRun) await waitForDeploymentHealth(config, manifest.buildId);
    await run(
      "flyctl",
      [
        "deploy",
        "--config",
        config.fly.webConfig,
        "--app",
        config.fly.webApp,
        "--image",
        manifest.images.web.ref,
        "--remote-only",
        "--wait-timeout",
        `${config.health.timeoutSeconds}s`,
        "--yes",
      ],
      { cwd: repositoryRoot, dryRun },
    );
    if (!dryRun) await waitForWebBuild(config, manifest.buildId);
    if (!dryRun) {
      const receipt = await writeReceipt({
        environment,
        buildId: manifest.buildId,
        config,
        manifestPath,
        backup,
        startedAt,
        rollback,
        rollbackFrom,
      });
      process.stdout.write(`Deployment receipt: ${receipt}\n`);
    } else {
      process.stdout.write(
        "Dry run complete; no migration, deployment, health probe, or receipt ran.\n",
      );
    }
  } finally {
    if (lockPath) await rm(lockPath, { force: true });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseCliArguments(argv, {
    valueOptions: [
      "environment",
      "config",
      "manifest",
      "runtime-env",
      "migration-env",
      "confirm",
      "backup-reference",
      "profile",
      "rollback-from",
    ],
    booleanOptions: ["dry-run", "no-build", "rollback", "recover-lock", "help"],
  });
  if (parsed.flags.has("help")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (parsed.positionals.length > 1) throw new Error("Too many positional arguments");
  const explicit = parsed.values.get("environment");
  const positional = parsed.positionals[0];
  if (
    explicit &&
    positional &&
    normalizeEnvironment(explicit) !== normalizeEnvironment(positional)
  ) {
    throw new Error("The positional environment conflicts with --environment");
  }
  const environment = normalizeEnvironment(explicit ?? positional);
  const dryRun = parsed.flags.has("dry-run");
  if (!isHostedEnvironment(environment)) {
    const hostedOptions = [
      "config",
      "manifest",
      "runtime-env",
      "migration-env",
      "confirm",
      "backup-reference",
      "rollback-from",
    ];
    if (hostedOptions.some((option) => parsed.values.has(option))) {
      throw new Error("Hosted deployment options are not valid for development");
    }
    if (parsed.flags.has("rollback") || parsed.flags.has("recover-lock")) {
      throw new Error("--rollback and --recover-lock are valid only for hosted environments");
    }
    await serviceMain([
      "--environment",
      "development",
      "start",
      ...(parsed.values.has("profile") ? ["--profile", parsed.values.get("profile")] : []),
      ...(parsed.flags.has("no-build") ? ["--no-build"] : []),
      ...(dryRun ? ["--dry-run"] : []),
    ]);
    return;
  }
  if (parsed.values.has("profile") || parsed.flags.has("no-build")) {
    throw new Error("--profile and --no-build are development-only");
  }
  await deployHosted({ environment, parsed, dryRun });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Deployment failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

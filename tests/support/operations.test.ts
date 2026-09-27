import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HOSTED_DEPLOYMENT_AUTOMATION_FILES,
  REMOTE_CURRENT_BUILD_SCRIPT,
  REMOTE_DEACTIVATE_FAILED_CURRENT_SCRIPT,
  REMOTE_DEPLOY_SCRIPT,
  REMOTE_PREPARE_SCRIPT,
  REMOTE_REMOVE_INCOMING_SCRIPT,
  REMOTE_RESTORE_PREVIOUS_SCRIPT,
  REMOTE_WRITE_SCRIPT,
  assertProductionReleaseRevision,
  assertRemoteRollbackSource,
  assertRemoteTargetNotActive,
  main as deployMain,
  resolveReviewedDeploymentInputHashes,
  validateSingleVmRuntimeValues,
  verifyForwardDeploymentAncestry,
  verifySignatures,
} from "../../scripts/ops/deploy.mjs";
import {
  assertNoEnvironmentKeyOverlap,
  composeArgv,
  expectedDeploymentConfirmation,
  expectedProductionConfirmation,
  expectedRollbackConfirmation,
  normalizeEnvironment,
  parseCliArguments,
  parseFlyTomlEnvironment,
  resolveCheckedRepositoryFile,
  run,
  sshArgv,
  validateBuildManifest,
  validateDeployConfig,
  validateDeploymentConfirmation,
  validateEnvFileKeys,
  validateFlyRuntimeEnvironment,
  validateFlyWebEnvironment,
  validateProductionConfirmation,
  validateRollbackConfirmation,
  validateSingleVmConfig,
} from "../../scripts/ops/lib.mjs";
import { main as productBuildMain, withPreservedFiles } from "../../scripts/ops/product-build.mjs";
import { validateReleaseBinding } from "../../scripts/ops/release-acceptance.mjs";
import { REMOTE_SERVICE_SCRIPT, main as serviceMain } from "../../scripts/ops/service.mjs";

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

function singleVmConfig(environment: "staging" | "production" = "staging") {
  const production = environment === "production";
  return {
    schemaVersion: 1,
    environment,
    deploymentMode: "single-vm",
    publicWebUrl: production
      ? "https://app.openround.example"
      : "https://staging.openround.example",
    publicApiUrl: production
      ? "https://app.openround.example"
      : "https://staging.openround.example",
    publicMediaUrl: production
      ? "https://media.openround.example"
      : "https://media-staging.openround.example",
    imageRepository: "ghcr.io/riojung/openround/openround",
    imagePlatform: "linux/amd64",
    billingMode: production ? "stripe" : "disabled",
    singleVm: {
      host: production ? "production-vm.openround.example" : "staging-vm.openround.example",
      port: 22,
      user: "openround",
      deployPath: production ? "/opt/openround/production" : "/opt/openround/staging",
      composeFiles: ["compose.single-vm.yaml"],
      deploymentFiles: ["infra/single-vm/Caddyfile", "infra/single-vm/postgres-init.sh"],
      knownHostsFile: production
        ? "config/deploy/ssh/production_known_hosts"
        : "config/deploy/ssh/staging_known_hosts",
      projectName: production ? "openround-production" : "openround-staging",
    },
    health: {
      timeoutSeconds: production ? 420 : 300,
      intervalSeconds: 5,
      requestTimeoutSeconds: 8,
    },
    requireSigning: true,
    requireReadinessGate: production,
    ...(production ? { readinessTarget: "single-vm-beta" } : {}),
    cosignIdentityRegexp: production
      ? "^https://github\\.com/example/openround/.*$"
      : "^https://github\\.com/example/openround/.github/workflows/staging-images\\.yml@refs/heads/main$",
    cosignOidcIssuer: "https://token.actions.githubusercontent.com",
  };
}

function singleVmRuntimeEnvironment(environment: "staging" | "production" = "staging") {
  const domain =
    environment === "production" ? "app.openround.example" : "staging.openround.example";
  return [
    `OPENROUND_DEPLOYMENT_ENVIRONMENT=${environment}`,
    `OPENROUND_APP_DOMAIN=${domain}`,
    `OPENROUND_MEDIA_DOMAIN=${environment === "production" ? "media.openround.example" : "media-staging.openround.example"}`,
    "OPENROUND_ACME_EMAIL=ops@openround.example",
    "OPENROUND_SERVER_INGRESS_SUBNET=172.30.255.0/29",
    "OPENROUND_CADDY_PROXY_IP=172.30.255.2",
    "POSTGRES_OWNER_PASSWORD=owner-secret",
    "POSTGRES_APP_PASSWORD=app-secret",
    "DATABASE_URL=postgresql://openround_app:app-secret@postgres:5432/openround",
    "VALKEY_PASSWORD=valkey-secret",
    "REDIS_URL=redis://:valkey-secret@valkey:6379",
    "MINIO_ROOT_USER=openround-root",
    "MINIO_ROOT_PASSWORD=minio-root-secret",
    "MINIO_APP_ACCESS_KEY=openround-app",
    "MINIO_APP_SECRET_KEY=minio-app-secret",
    "SMTP_URL=smtps://mailer:mail-secret@smtp.example.com:465",
    "EMAIL_FROM=OpenRound <noreply@example.com>",
    "METRICS_TOKEN=metrics-token-with-at-least-24-characters",
    "ADMIN_TOKEN=admin-token-with-at-least-24-characters",
    `BILLING_MODE=${environment === "production" ? "stripe" : "disabled"}`,
    "COMMUNITY_MODE=false",
    "NODE_ENV=production",
    "COOKIE_SECURE=true",
    "ALLOW_IN_MEMORY=false",
    "RUN_MIGRATIONS=false",
    "",
  ].join("\n");
}

function buildManifest(environment = "staging", manifestBuildId = buildId) {
  const repository = "ghcr.io/riojung/openround/openround";
  return {
    schemaVersion: 1,
    environment,
    buildId: manifestBuildId,
    createdAt: "2026-09-21T00:00:00.000Z",
    nextPublicApiUrl:
      environment === "production"
        ? "https://app.openround.example"
        : "https://staging.openround.example",
    imagePlatform: "linux/amd64",
    source: { commit: manifestBuildId, dirty: false },
    images: {
      server: {
        repository: `${repository}-server`,
        tag: `${repository}-server:${environment}-${manifestBuildId}`,
        digest: serverDigest,
        ref: `${repository}-server@${serverDigest}`,
        signed: true,
      },
      web: {
        repository: `${repository}-web`,
        tag: `${repository}-web:${environment}-${manifestBuildId}`,
        digest: webDigest,
        ref: `${repository}-web@${webDigest}`,
        signed: true,
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

async function withReviewedDeploymentGitState<T>(
  callback: (revisions: { head: string; parent: string }) => Promise<T>,
) {
  const artifactsRoot = join(repositoryRoot, "artifacts");
  await mkdir(artifactsRoot, { recursive: true });
  const fixtureRoot = await mkdtemp(join(artifactsRoot, "reviewed deployment git state "));
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
    process.env.GIT_DIR = join(fixtureRoot, ".git");
    process.env.GIT_WORK_TREE = repositoryRoot;
    await run(
      "git",
      [
        "add",
        "--",
        ".gitignore",
        "scripts/deploy.sh",
        "scripts/ops/deploy.mjs",
        "scripts/ops/lib.mjs",
        "scripts/ops/release-acceptance.mjs",
        "scripts/ops/service.mjs",
        "scripts/check-release-readiness.mjs",
        "docs/release-readiness.json",
        "config/deploy/staging.json",
        "config/deploy/production.json",
        "config/deploy/ssh/staging_known_hosts",
        "config/deploy/ssh/production_known_hosts",
        "compose.single-vm.yaml",
        "infra/single-vm/Caddyfile",
        "infra/single-vm/postgres-init.sh",
      ],
      { cwd: repositoryRoot, capture: true },
    );
    await run("git", ["commit", "--quiet", "--no-gpg-sign", "--message", "reviewed inputs"], {
      cwd: repositoryRoot,
      capture: true,
    });
    const parent = (
      await run("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, capture: true })
    ).stdout.trim();
    await run(
      "git",
      ["commit", "--quiet", "--allow-empty", "--no-gpg-sign", "--message", "release source"],
      { cwd: repositoryRoot, capture: true },
    );
    const head = (
      await run("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, capture: true })
    ).stdout.trim();
    return await callback({ head, parent });
  } finally {
    if (previousGitDirectory === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previousGitDirectory;
    if (previousGitWorkTree === undefined) delete process.env.GIT_WORK_TREE;
    else process.env.GIT_WORK_TREE = previousGitWorkTree;
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function withSignedReleaseAcceptance<T>(
  options: {
    changeOtherGate?: boolean;
    extraChangedPath?: boolean;
    manifestDigestOverride?: string;
    publishAcceptance?: boolean;
    serverDigestOverride?: string;
  },
  callback: (fixture: {
    root: string;
    buildId: string;
    operationsRevision: string;
    manifest: ReturnType<typeof buildManifest>;
    manifestPath: string;
    trustedRemoteUrls: string[];
    tagObjectLookup: (tagObject: string) => Promise<unknown>;
  }) => Promise<T>,
) {
  const artifactsRoot = join(repositoryRoot, "artifacts");
  await mkdir(artifactsRoot, { recursive: true });
  const root = await mkdtemp(join(artifactsRoot, "signed release acceptance "));
  try {
    await run("git", ["init", "--quiet"], { cwd: root, capture: true });
    await run("git", ["config", "user.name", "OpenRound Test"], { cwd: root, capture: true });
    await run("git", ["config", "user.email", "test@example.invalid"], {
      cwd: root,
      capture: true,
    });
    const trustedOrigin = join(root, ".trusted-origin.git");
    await run("git", ["init", "--bare", "--quiet", trustedOrigin], {
      cwd: root,
      capture: true,
    });
    await run("git", ["remote", "add", "origin", trustedOrigin], {
      cwd: root,
      capture: true,
    });
    const readinessPath = join(root, "docs", "release-readiness.json");
    await mkdir(dirname(readinessPath), { recursive: true });
    const taggedLedger = {
      schemaVersion: 1,
      updatedAt: "2026-09-25",
      releaseTarget: "single-vm-beta",
      gates: [
        {
          id: "source-ci",
          name: "Source CI",
          owner: "engineering",
          requiredFor: ["single-vm-beta-preflight", "single-vm-beta"],
          status: "complete",
          criterion: "The exact release source passed every required source check.",
          evidence: ["https://example.test/source-ci"],
        },
        {
          id: "signed-release",
          name: "Signed release",
          owner: "maintainer",
          requiredFor: ["single-vm-beta"],
          status: "pending",
          criterion: "The exact candidate has retained signed release evidence.",
          evidence: [],
          nextAction: "Create and verify the protected release candidate.",
        },
      ],
    };
    await writeFile(readinessPath, `${JSON.stringify(taggedLedger, null, 2)}\n`);
    await run("git", ["add", "--", "docs/release-readiness.json"], {
      cwd: root,
      capture: true,
    });
    await run("git", ["commit", "--quiet", "--no-gpg-sign", "--message", "release source"], {
      cwd: root,
      capture: true,
    });
    const candidateBuildId = await run("git", ["rev-parse", "HEAD"], {
      cwd: root,
      capture: true,
    }).then(({ stdout }) => stdout.trim());
    await run("git", ["tag", "--annotate", "v0.9.0", "--message", "OpenRound v0.9.0"], {
      cwd: root,
      capture: true,
    });
    const tagObject = await run("git", ["rev-parse", "refs/tags/v0.9.0"], {
      cwd: root,
      capture: true,
    }).then(({ stdout }) => stdout.trim());
    await run(
      "git",
      ["push", "origin", "HEAD:refs/heads/main", "refs/tags/v0.9.0:refs/tags/v0.9.0"],
      { cwd: root, capture: true },
    );
    const manifest = buildManifest("production", candidateBuildId);
    const manifestPath = join(root, "build-manifest.json");
    const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(manifestPath, manifestContent);
    const manifestDigest = `sha256:${createHash("sha256").update(manifestContent).digest("hex")}`;
    const acceptedLedger = structuredClone(taggedLedger);
    const signedRelease = acceptedLedger.gates.find(({ id }) => id === "signed-release")!;
    signedRelease.status = "complete";
    signedRelease.evidence = ["https://example.test/releases/v0.9.0/evidence"];
    delete signedRelease.nextAction;
    Object.assign(signedRelease, {
      releaseBinding: {
        schemaVersion: 1,
        tag: "v0.9.0",
        tagObject,
        buildId: candidateBuildId,
        manifestDigest: options.manifestDigestOverride ?? manifestDigest,
        imageDigests: {
          server: options.serverDigestOverride ?? manifest.images.server.digest,
          web: manifest.images.web.digest,
        },
      },
    });
    if (options.changeOtherGate) acceptedLedger.gates[0].owner = "unreviewed-owner";
    await writeFile(readinessPath, `${JSON.stringify(acceptedLedger, null, 2)}\n`);
    if (options.extraChangedPath) {
      await writeFile(join(root, "deployment-code.txt"), "unreviewed deployment change\n");
    }
    await run(
      "git",
      [
        "add",
        "--",
        "docs/release-readiness.json",
        ...(options.extraChangedPath ? ["deployment-code.txt"] : []),
      ],
      { cwd: root, capture: true },
    );
    await run(
      "git",
      ["commit", "--quiet", "--no-gpg-sign", "--message", "accept release evidence"],
      { cwd: root, capture: true },
    );
    const operationsRevision = await run("git", ["rev-parse", "HEAD"], {
      cwd: root,
      capture: true,
    }).then(({ stdout }) => stdout.trim());
    if (options.publishAcceptance !== false) {
      await run("git", ["push", "origin", "HEAD:refs/heads/main"], {
        cwd: root,
        capture: true,
      });
    }
    return await callback({
      root,
      buildId: candidateBuildId,
      operationsRevision,
      manifest,
      manifestPath,
      trustedRemoteUrls: [trustedOrigin],
      tagObjectLookup: async (requestedTagObject) => ({
        sha: requestedTagObject,
        tag: "v0.9.0",
        object: { type: "commit", sha: candidateBuildId },
        verification: { verified: true, reason: "valid" },
      }),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("operations environment contract", () => {
  it("requires reviewed deployment inputs to be tracked and byte-clean", async () => {
    await expect(
      resolveCheckedRepositoryFile("LICENSE", repositoryRoot, "reviewed fixture", {
        requireGitClean: true,
      }),
    ).resolves.toBe(join(repositoryRoot, "LICENSE"));
    const artifactsRoot = join(repositoryRoot, "artifacts");
    await mkdir(artifactsRoot, { recursive: true });
    const fixtureRoot = await mkdtemp(join(artifactsRoot, "untracked deployment input "));
    try {
      const untracked = join(fixtureRoot, "compose.yaml");
      await writeFile(untracked, "services: {}\n");
      await expect(
        resolveCheckedRepositoryFile(untracked, repositoryRoot, "unreviewed fixture", {
          requireGitClean: true,
        }),
      ).rejects.toThrow("must be tracked by Git");
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("hashes hosted deployment automation only when it matches reviewed HEAD", async () => {
    const artifactsRoot = join(repositoryRoot, "artifacts");
    await mkdir(artifactsRoot, { recursive: true });
    const fixtureRoot = await mkdtemp(join(artifactsRoot, "reviewed automation inputs "));
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
      for (const path of HOSTED_DEPLOYMENT_AUTOMATION_FILES) {
        await mkdir(dirname(join(fixtureRoot, path)), { recursive: true });
        await writeFile(join(fixtureRoot, path), `reviewed ${path}\n`);
      }
      await run("git", ["add", "--", ...HOSTED_DEPLOYMENT_AUTOMATION_FILES], {
        cwd: fixtureRoot,
        capture: true,
      });
      await run("git", ["commit", "--quiet", "--no-gpg-sign", "--message", "reviewed"], {
        cwd: fixtureRoot,
        capture: true,
      });

      const hashes = await resolveReviewedDeploymentInputHashes(
        HOSTED_DEPLOYMENT_AUTOMATION_FILES,
        fixtureRoot,
      );
      expect(Object.keys(hashes)).toEqual([...HOSTED_DEPLOYMENT_AUTOMATION_FILES]);
      for (const path of HOSTED_DEPLOYMENT_AUTOMATION_FILES) {
        const expected = createHash("sha256")
          .update(await readFile(join(fixtureRoot, path)))
          .digest("hex");
        expect(hashes[path]).toBe(expected);
      }

      await writeFile(join(fixtureRoot, "scripts/deploy.sh"), "unreviewed automation\n");
      await expect(
        resolveReviewedDeploymentInputHashes(HOSTED_DEPLOYMENT_AUTOMATION_FILES, fixtureRoot),
      ).rejects.toThrow("must match the reviewed HEAD revision");
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("permits a production release only through its exact evidence-only acceptance commit", async () => {
    await withSignedReleaseAcceptance({}, async (fixture) => {
      await expect(
        assertProductionReleaseRevision({
          operationsRevision: fixture.operationsRevision,
          manifest: fixture.manifest,
          manifestPath: fixture.manifestPath,
          root: fixture.root,
          trustedRemoteUrls: fixture.trustedRemoteUrls,
          tagObjectLookup: fixture.tagObjectLookup,
        }),
      ).resolves.toMatchObject({
        tag: "v0.9.0",
        buildId: fixture.buildId,
        certificateIdentity:
          "https://github.com/riojung/openround/.github/workflows/release.yml@refs/tags/v0.9.0",
        imageDigests: {
          server: fixture.manifest.images.server.digest,
          web: fixture.manifest.images.web.digest,
        },
      });
    });
  });

  it("rejects array values that stringify to valid release-binding fields", () => {
    const manifestDigest = `sha256:${"d".repeat(64)}`;
    const validBinding = {
      schemaVersion: 1,
      tag: "v0.9.0",
      tagObject: "e".repeat(40),
      buildId,
      manifestDigest,
      imageDigests: { server: serverDigest, web: webDigest },
    };
    const cases = [
      {
        field: "tag",
        binding: { ...validBinding, tag: [validBinding.tag] },
      },
      {
        field: "tagObject",
        binding: { ...validBinding, tagObject: [validBinding.tagObject] },
      },
      {
        field: "buildId",
        binding: { ...validBinding, buildId: [validBinding.buildId] },
      },
      {
        field: "manifestDigest",
        binding: { ...validBinding, manifestDigest: [validBinding.manifestDigest] },
      },
      {
        field: "imageDigests.server",
        binding: {
          ...validBinding,
          imageDigests: { ...validBinding.imageDigests, server: [serverDigest] },
        },
      },
      {
        field: "imageDigests.web",
        binding: {
          ...validBinding,
          imageDigests: { ...validBinding.imageDigests, web: [webDigest] },
        },
      },
    ];

    for (const { field, binding } of cases) {
      expect(() => validateReleaseBinding(binding)).toThrow(`releaseBinding.${field} must be`);
    }
  });

  it("verifies production images against the exact accepted release-tag identity", async () => {
    const certificateIdentity =
      "https://github.com/riojung/openround/.github/workflows/release.yml@refs/tags/v0.9.0";
    const output = await captureStdout(() =>
      verifySignatures(productionConfig(), buildManifest("production"), true, certificateIdentity),
    );

    expect(output.match(/cosign verify/g)).toHaveLength(2);
    expect(output).toContain(`--certificate-identity ${certificateIdentity}`);
    expect(output).not.toContain("--certificate-identity-regexp");
  });

  it("rejects an unsigned or substituted published release tag object", async () => {
    await withSignedReleaseAcceptance({}, async (fixture) => {
      await expect(
        assertProductionReleaseRevision({
          operationsRevision: fixture.operationsRevision,
          manifest: fixture.manifest,
          manifestPath: fixture.manifestPath,
          root: fixture.root,
          trustedRemoteUrls: fixture.trustedRemoteUrls,
          tagObjectLookup: async (tagObject) => ({
            sha: tagObject,
            tag: "v0.9.0",
            object: { type: "commit", sha: fixture.buildId },
            verification: { verified: false, reason: "unsigned" },
          }),
        }),
      ).rejects.toThrow("has not verified the exact annotated release tag object signature");

      await expect(
        assertProductionReleaseRevision({
          operationsRevision: fixture.operationsRevision,
          manifest: fixture.manifest,
          manifestPath: fixture.manifestPath,
          root: fixture.root,
          trustedRemoteUrls: fixture.trustedRemoteUrls,
          tagObjectLookup: async () => ({
            sha: "d".repeat(40),
            tag: "v0.9.0",
            object: { type: "commit", sha: fixture.buildId },
            verification: { verified: true, reason: "valid" },
          }),
        }),
      ).rejects.toThrow("does not match the signed release acceptance");
    });
  });

  it("rejects a non-descendant acceptance state and a local-only acceptance commit", async () => {
    await withSignedReleaseAcceptance({}, async (fixture) => {
      await expect(
        assertProductionReleaseRevision({
          operationsRevision: fixture.buildId,
          manifest: fixture.manifest,
          manifestPath: fixture.manifestPath,
          root: fixture.root,
          trustedRemoteUrls: fixture.trustedRemoteUrls,
          tagObjectLookup: fixture.tagObjectLookup,
        }),
      ).rejects.toThrow("must be a strict evidence-only descendant");
    });
    await withSignedReleaseAcceptance({ publishAcceptance: false }, async (fixture) => {
      await expect(
        assertProductionReleaseRevision({
          operationsRevision: fixture.operationsRevision,
          manifest: fixture.manifest,
          manifestPath: fixture.manifestPath,
          root: fixture.root,
          trustedRemoteUrls: fixture.trustedRemoteUrls,
          tagObjectLookup: fixture.tagObjectLookup,
        }),
      ).rejects.toThrow("HEAD must match the fetched origin/main commit");
    });
  });

  it("rejects a release acceptance descendant that changes anything outside the ledger", async () => {
    await withSignedReleaseAcceptance({ extraChangedPath: true }, async (fixture) => {
      await expect(
        assertProductionReleaseRevision({
          operationsRevision: fixture.operationsRevision,
          manifest: fixture.manifest,
          manifestPath: fixture.manifestPath,
          root: fixture.root,
          trustedRemoteUrls: fixture.trustedRemoteUrls,
          tagObjectLookup: fixture.tagObjectLookup,
        }),
      ).rejects.toThrow("may differ from the release build only by docs/release-readiness.json");
    });
  });

  it("rejects unrelated gate changes and artifact drift in a release acceptance", async () => {
    await withSignedReleaseAcceptance({ changeOtherGate: true }, async (fixture) => {
      await expect(
        assertProductionReleaseRevision({
          operationsRevision: fixture.operationsRevision,
          manifest: fixture.manifest,
          manifestPath: fixture.manifestPath,
          root: fixture.root,
          trustedRemoteUrls: fixture.trustedRemoteUrls,
          tagObjectLookup: fixture.tagObjectLookup,
        }),
      ).rejects.toThrow("descendant may not change gate source-ci");
    });
    await withSignedReleaseAcceptance(
      { manifestDigestOverride: `sha256:${"f".repeat(64)}` },
      async (fixture) => {
        await expect(
          assertProductionReleaseRevision({
            operationsRevision: fixture.operationsRevision,
            manifest: fixture.manifest,
            manifestPath: fixture.manifestPath,
            root: fixture.root,
            trustedRemoteUrls: fixture.trustedRemoteUrls,
            tagObjectLookup: fixture.tagObjectLookup,
          }),
        ).rejects.toThrow("manifestDigest does not match the selected release artifact");
      },
    );
    await withSignedReleaseAcceptance(
      { serverDigestOverride: `sha256:${"f".repeat(64)}` },
      async (fixture) => {
        await expect(
          assertProductionReleaseRevision({
            operationsRevision: fixture.operationsRevision,
            manifest: fixture.manifest,
            manifestPath: fixture.manifestPath,
            root: fixture.root,
            trustedRemoteUrls: fixture.trustedRemoteUrls,
            tagObjectLookup: fixture.tagObjectLookup,
          }),
        ).rejects.toThrow("server digest does not match the build manifest");
      },
    );
  });

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

    expect(validateEnvFileKeys(singleVmRuntimeEnvironment(), "single-vm-runtime")).toContain(
      "DATABASE_URL",
    );
    expect(() =>
      validateEnvFileKeys(
        singleVmRuntimeEnvironment().replace("COMMUNITY_MODE=false\n", ""),
        "single-vm-runtime",
      ),
    ).toThrow("single-vm runtime environment requires COMMUNITY_MODE");
    expect(() =>
      validateEnvFileKeys(
        `${singleVmRuntimeEnvironment()}NODE_OPTIONS=--require=/tmp/unreviewed.js\n`,
        "single-vm-runtime",
      ),
    ).toThrow("must not contain NODE_OPTIONS");
    expect(() =>
      validateEnvFileKeys(
        `${singleVmRuntimeEnvironment()}DATABASE_MIGRATION_URL=postgres://owner\n`,
        "single-vm-runtime",
      ),
    ).toThrow("must not contain DATABASE_MIGRATION_URL");
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
        publicApiUrl: "https://staging.openround.example",
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
      {
        ...stagingConfig(),
        publicWebUrl: "https://openround-ca-staging-web.fly.dev",
        publicApiUrl: "https://openround-ca-staging-server.fly.dev",
        imageRepository: "ghcr.io/riojung/openround/openround",
        fly: {
          serverApp: "openround-ca-staging-server",
          webApp: "openround-ca-staging-web",
          serverConfig: "config/deploy/fly/staging-server.toml",
          webConfig: "config/deploy/fly/staging-web.toml",
        },
      },
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

  it("validates single-VM targets, strict SSH arguments, and safe runtime values", () => {
    const config = validateDeployConfig(singleVmConfig(), "staging");
    expect(validateSingleVmConfig(config.singleVm)).toBe(config.singleVm);
    expect(
      sshArgv(config.singleVm, "/reviewed/known_hosts", [
        "sh",
        "-se",
        "--",
        config.singleVm.deployPath,
        config.singleVm.projectName,
      ]),
    ).toEqual(
      expect.arrayContaining([
        "StrictHostKeyChecking=yes",
        "UserKnownHostsFile=/reviewed/known_hosts",
        "openround@staging-vm.openround.example",
      ]),
    );
    expect(validateSingleVmRuntimeValues(singleVmRuntimeEnvironment(), config)).toBe(true);
    expect(() =>
      validateSingleVmRuntimeValues(
        singleVmRuntimeEnvironment().replace(
          "OPENROUND_DEPLOYMENT_ENVIRONMENT=staging",
          "OPENROUND_DEPLOYMENT_ENVIRONMENT=production",
        ),
        config,
      ),
    ).toThrow("OPENROUND_DEPLOYMENT_ENVIRONMENT must match");
    for (const unsafeCommunityMode of ["", "COMMUNITY_MODE=true\n"]) {
      expect(() =>
        validateSingleVmRuntimeValues(
          singleVmRuntimeEnvironment().replace("COMMUNITY_MODE=false\n", unsafeCommunityMode),
          config,
        ),
      ).toThrow("COMMUNITY_MODE must be false");
    }
    expect(() =>
      validateSingleVmRuntimeValues(
        singleVmRuntimeEnvironment().replace("NODE_ENV=production", "NODE_ENV=development"),
        config,
      ),
    ).toThrow("NODE_ENV must be production");
    expect(() =>
      validateSingleVmRuntimeValues(
        singleVmRuntimeEnvironment().replace(
          "OPENROUND_APP_DOMAIN=staging.openround.example",
          "OPENROUND_APP_DOMAIN=attacker.example",
        ),
        config,
      ),
    ).toThrow("must match the reviewed");
    expect(() =>
      validateSingleVmRuntimeValues(
        singleVmRuntimeEnvironment().replace(
          "POSTGRES_OWNER_PASSWORD=owner-secret",
          "POSTGRES_OWNER_PASSWORD=replace-owner-secret",
        ),
        config,
      ),
    ).toThrow("POSTGRES_OWNER_PASSWORD must contain a non-placeholder value");
    expect(() =>
      validateSingleVmRuntimeValues(
        singleVmRuntimeEnvironment().replace(
          "MINIO_APP_SECRET_KEY=minio-app-secret",
          "MINIO_APP_SECRET_KEY=   ",
        ),
        config,
      ),
    ).toThrow("MINIO_APP_SECRET_KEY must contain a non-placeholder value");
    expect(() =>
      validateSingleVmRuntimeValues(
        singleVmRuntimeEnvironment().replace(
          "OPENROUND_MEDIA_DOMAIN=media-staging.openround.example",
          "OPENROUND_MEDIA_DOMAIN=staging.openround.example",
        ),
        config,
      ),
    ).toThrow("must match the reviewed media origin");
    expect(() =>
      validateDeployConfig(
        {
          ...singleVmConfig(),
          singleVm: { ...singleVmConfig().singleVm, host: "host;touch-pwned" },
        },
        "staging",
      ),
    ).toThrow("singleVm.host");
    expect(() =>
      validateDeployConfig(
        {
          ...singleVmConfig(),
          singleVm: {
            ...singleVmConfig().singleVm,
            composeFiles: ["compose.single-vm.yaml\n../../unreviewed.yaml"],
          },
        },
        "staging",
      ),
    ).toThrow("safe repository-relative path");
    expect(assertRemoteTargetNotActive(undefined, buildId)).toBe(true);
    expect(() => assertRemoteTargetNotActive(buildId, buildId)).toThrow("already the active");
    expect(assertRemoteRollbackSource(buildId, buildId)).toBe(true);
    expect(() => assertRemoteRollbackSource("b".repeat(40), buildId)).toThrow(
      "is not the active single-VM release",
    );
  });

  it("requires normal single-VM targets to descend from the active remote build", async () => {
    await withReviewedDeploymentGitState(async ({ head, parent }) => {
      const parentTree = (
        await run("git", ["rev-parse", `${parent}^{tree}`], {
          cwd: repositoryRoot,
          capture: true,
        })
      ).stdout.trim();
      const divergentBuild = (
        await run("git", ["commit-tree", parentTree, "-p", parent, "-m", "divergent release"], {
          cwd: repositoryRoot,
          capture: true,
        })
      ).stdout.trim();
      await expect(verifyForwardDeploymentAncestry(undefined, head)).resolves.toBe(true);
      await expect(verifyForwardDeploymentAncestry(parent, head)).resolves.toBe(true);
      await expect(verifyForwardDeploymentAncestry(head, parent)).rejects.toThrow(
        "Normal deployment target must descend from the active remote build",
      );
      await expect(verifyForwardDeploymentAncestry(head, divergentBuild)).rejects.toThrow(
        "Normal deployment target must descend from the active remote build",
      );
    });
  });

  it("keeps every remote single-VM script valid POSIX shell", async () => {
    for (const script of [
      REMOTE_PREPARE_SCRIPT,
      REMOTE_WRITE_SCRIPT,
      REMOTE_CURRENT_BUILD_SCRIPT,
      REMOTE_DEACTIVATE_FAILED_CURRENT_SCRIPT,
      REMOTE_DEPLOY_SCRIPT,
      REMOTE_RESTORE_PREVIOUS_SCRIPT,
      REMOTE_REMOVE_INCOMING_SCRIPT,
      REMOTE_SERVICE_SCRIPT,
    ]) {
      await expect(run("sh", ["-n"], { capture: true, input: script })).resolves.toMatchObject({
        code: 0,
      });
    }
  });

  it("sweeps only stale unlocked incoming deployments", async () => {
    const artifactsRoot = join(repositoryRoot, "artifacts");
    await mkdir(artifactsRoot, { recursive: true });
    const fixtureRoot = await mkdtemp(join(artifactsRoot, "remote-incoming-sweep-"));
    const remoteRoot = join(fixtureRoot, "remote");
    const incomingRoot = join(remoteRoot, "incoming");
    try {
      const stale = join(incomingRoot, "stale-upload");
      const fresh = join(incomingRoot, "fresh-upload");
      await mkdir(stale, { recursive: true });
      await mkdir(fresh, { recursive: true });
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000);
      await utimes(stale, twoDaysAgo, twoDaysAgo);

      await run("sh", ["-se", "--", remoteRoot, "candidate-one"], {
        capture: true,
        input: REMOTE_PREPARE_SCRIPT,
      });
      const sweptEntries = await readdir(incomingRoot);
      expect(sweptEntries).not.toContain("stale-upload");
      expect(sweptEntries).toEqual(expect.arrayContaining(["candidate-one", "fresh-upload"]));

      const lockedStale = join(incomingRoot, "locked-stale-upload");
      await mkdir(lockedStale);
      await utimes(lockedStale, twoDaysAgo, twoDaysAgo);
      await mkdir(join(remoteRoot, ".deploy.lock"));
      await run("sh", ["-se", "--", remoteRoot, "candidate-two"], {
        capture: true,
        input: REMOTE_PREPARE_SCRIPT,
      });
      expect(await readdir(incomingRoot)).toContain("locked-stale-upload");
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("tears down a partially started first release", async () => {
    const artifactsRoot = join(repositoryRoot, "artifacts");
    await mkdir(artifactsRoot, { recursive: true });
    const fixtureRoot = await mkdtemp(join(artifactsRoot, "remote-first-release-failure-"));
    const remoteRoot = join(fixtureRoot, "remote");
    const token = "first-release-token";
    const incoming = join(remoteRoot, "incoming", token);
    const fakeBin = join(fixtureRoot, "bin");
    const dockerLog = join(fixtureRoot, "docker.log");
    try {
      await mkdir(incoming, { recursive: true });
      await mkdir(fakeBin, { recursive: true });
      await writeFile(join(incoming, ".compose-files"), "compose.single-vm.yaml\n");
      await writeFile(join(incoming, "compose.single-vm.yaml"), "services: {}\n");
      await writeFile(join(incoming, ".env"), `OPENROUND_BUILD_ID=${buildId}\n`, {
        mode: 0o600,
      });
      await writeFile(
        join(incoming, ".migration.env"),
        "DATABASE_MIGRATION_URL=postgresql://owner\n",
        { mode: 0o600 },
      );
      const fakeDocker = join(fakeBin, "docker");
      await writeFile(
        fakeDocker,
        [
          "#!/bin/sh",
          'printf "%s\\n" "$*" >> "$FAKE_DOCKER_LOG"',
          'case " $* " in',
          '  *" --entrypoint /bin/cat server /app/BUILD_ID "*|*" --entrypoint /bin/cat web /app/BUILD_ID "*) printf "%s\\n" "$FAKE_BUILD_ID" ;;',
          '  *" up --detach --wait --remove-orphans "*) exit 9 ;;',
          "esac",
          "exit 0",
          "",
        ].join("\n"),
      );
      await chmod(fakeDocker, 0o755);

      await expect(
        run(
          "sh",
          ["-se", "--", remoteRoot, "openround-staging", buildId, token, "0", "0", "none", "none"],
          {
            capture: true,
            input: REMOTE_DEPLOY_SCRIPT,
            env: {
              ...process.env,
              PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
              FAKE_BUILD_ID: buildId,
              FAKE_DOCKER_LOG: dockerLog,
            },
          },
        ),
      ).rejects.toMatchObject({ exitCode: 9 });

      expect(await readFile(dockerLog, "utf8")).toContain("down --remove-orphans");
      await expect(readFile(join(remoteRoot, "current-build"), "utf8")).rejects.toThrow();
      await expect(
        readFile(join(remoteRoot, "releases", buildId, ".env"), "utf8"),
      ).rejects.toThrow();
      await expect(readFile(join(remoteRoot, ".deploy.lock", "pid"), "utf8")).rejects.toThrow();
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("preserves a committed release when post-commit maintenance is interrupted", async () => {
    const artifactsRoot = join(repositoryRoot, "artifacts");
    await mkdir(artifactsRoot, { recursive: true });
    const fixtureRoot = await mkdtemp(join(artifactsRoot, "remote-committed-interrupt-"));
    const remoteRoot = join(fixtureRoot, "remote");
    const token = "committed-release-token";
    const incoming = join(remoteRoot, "incoming", token);
    const fakeBin = join(fixtureRoot, "bin");
    const dockerLog = join(fixtureRoot, "docker.log");
    try {
      await mkdir(incoming, { recursive: true });
      await mkdir(fakeBin, { recursive: true });
      await writeFile(join(incoming, ".compose-files"), "compose.single-vm.yaml\n");
      await writeFile(join(incoming, "compose.single-vm.yaml"), "services: {}\n");
      await writeFile(join(incoming, ".env"), `OPENROUND_BUILD_ID=${buildId}\n`, {
        mode: 0o600,
      });
      await writeFile(
        join(incoming, ".migration.env"),
        "DATABASE_MIGRATION_URL=postgresql://owner\n",
        { mode: 0o600 },
      );
      const fakeDocker = join(fakeBin, "docker");
      const fakeMove = join(fakeBin, "mv");
      await writeFile(
        fakeDocker,
        [
          "#!/bin/sh",
          'printf "%s\\n" "$*" >> "$FAKE_DOCKER_LOG"',
          'case " $* " in',
          '  *" --entrypoint /bin/cat server /app/BUILD_ID "*|*" --entrypoint /bin/cat web /app/BUILD_ID "*) printf "%s\\n" "$FAKE_BUILD_ID" ;;',
          '  *" image prune "*) kill -TERM "$PPID"; sleep 1 ;;',
          "esac",
          "exit 0",
          "",
        ].join("\n"),
      );
      await writeFile(
        fakeMove,
        [
          "#!/bin/sh",
          'if [ "${1:-}" = "-Tf" ]; then',
          '  rm -f "$3"',
          '  exec /bin/mv -f "$2" "$3"',
          "fi",
          'exec /bin/mv "$@"',
          "",
        ].join("\n"),
      );
      await chmod(fakeDocker, 0o755);
      await chmod(fakeMove, 0o755);

      await expect(
        run(
          "sh",
          ["-se", "--", remoteRoot, "openround-staging", buildId, token, "0", "0", "none", "none"],
          {
            capture: true,
            input: REMOTE_DEPLOY_SCRIPT,
            env: {
              ...process.env,
              PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
              FAKE_BUILD_ID: buildId,
              FAKE_DOCKER_LOG: dockerLog,
            },
          },
        ),
      ).rejects.toMatchObject({ exitCode: 143 });

      expect(await readlink(join(remoteRoot, "current"))).toBe(`releases/${buildId}`);
      expect((await readFile(join(remoteRoot, "current-build"), "utf8")).trim()).toBe(buildId);
      expect(await readFile(join(remoteRoot, "releases", buildId, ".env"), "utf8")).toContain(
        buildId,
      );

      await run("sh", ["-se", "--", remoteRoot, "openround-staging", buildId], {
        capture: true,
        input: REMOTE_DEACTIVATE_FAILED_CURRENT_SCRIPT,
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          FAKE_BUILD_ID: buildId,
          FAKE_DOCKER_LOG: dockerLog,
        },
      });
      expect(await readFile(dockerLog, "utf8")).toContain("down --remove-orphans");
      await expect(readFile(join(remoteRoot, "current-build"), "utf8")).rejects.toThrow();
      await expect(
        readFile(join(remoteRoot, "releases", buildId, ".env"), "utf8"),
      ).rejects.toThrow();
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("activates a remote release with one-shot migration credentials and immutable state", async () => {
    const artifactsRoot = join(repositoryRoot, "artifacts");
    await mkdir(artifactsRoot, { recursive: true });
    const fixtureRoot = await mkdtemp(join(artifactsRoot, "remote-deployment-simulation-"));
    const remoteRoot = join(fixtureRoot, "remote");
    const token = "test-token";
    const incoming = join(remoteRoot, "incoming", token);
    const fakeBin = join(fixtureRoot, "bin");
    const dockerLog = join(fixtureRoot, "docker.log");
    const previousBuildId = "b".repeat(40);
    try {
      await mkdir(incoming, { recursive: true });
      await mkdir(fakeBin, { recursive: true });
      const previousRelease = join(remoteRoot, "releases", previousBuildId);
      await mkdir(previousRelease, { recursive: true });
      await writeFile(join(previousRelease, ".compose-files"), "compose.single-vm.yaml\n");
      await writeFile(join(previousRelease, "compose.single-vm.yaml"), "services: {}\n");
      await writeFile(join(previousRelease, ".env"), `OPENROUND_BUILD_ID=${previousBuildId}\n`, {
        mode: 0o600,
      });
      await symlink(`releases/${previousBuildId}`, join(remoteRoot, "current"));
      await writeFile(join(remoteRoot, "current-build"), `${previousBuildId}\n`);
      await mkdir(join(remoteRoot, "releases", "c".repeat(40)), { recursive: true });
      await mkdir(join(remoteRoot, "releases", "d".repeat(40)), { recursive: true });
      await mkdir(join(remoteRoot, "releases", `.replaced-${buildId}-stale`), {
        recursive: true,
      });
      await writeFile(join(incoming, ".compose-files"), "compose.single-vm.yaml\n");
      await writeFile(join(incoming, "compose.single-vm.yaml"), "services: {}\n");
      await writeFile(join(incoming, ".env"), `OPENROUND_BUILD_ID=${buildId}\n`, { mode: 0o600 });
      await writeFile(
        join(incoming, ".migration.env"),
        "DATABASE_MIGRATION_URL=postgresql://owner\n",
        { mode: 0o600 },
      );
      const fakeDocker = join(fakeBin, "docker");
      const fakeMove = join(fakeBin, "mv");
      await writeFile(
        fakeDocker,
        [
          "#!/bin/sh",
          'printf "%s\\n" "$*" >> "$FAKE_DOCKER_LOG"',
          'case " $* " in',
          '  *" --entrypoint /bin/cat server /app/BUILD_ID "*) printf "%s\\n" "${FAKE_SERVER_BUILD_ID:-$FAKE_BUILD_ID}" ;;',
          '  *" --entrypoint /bin/cat web /app/BUILD_ID "*) printf "%s\\n" "${FAKE_WEB_BUILD_ID:-$FAKE_BUILD_ID}" ;;',
          "esac",
          "exit 0",
          "",
        ].join("\n"),
      );
      await writeFile(
        fakeMove,
        [
          "#!/bin/sh",
          'if [ "${1:-}" = "-Tf" ]; then',
          '  rm -f "$3"',
          '  exec /bin/mv -f "$2" "$3"',
          "fi",
          'exec /bin/mv "$@"',
          "",
        ].join("\n"),
      );
      await chmod(fakeDocker, 0o755);
      await chmod(fakeMove, 0o755);

      await run(
        "sh",
        [
          "-se",
          "--",
          remoteRoot,
          "openround-staging",
          buildId,
          token,
          "0",
          "0",
          previousBuildId,
          "none",
        ],
        {
          capture: true,
          input: REMOTE_DEPLOY_SCRIPT,
          env: {
            ...process.env,
            PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
            FAKE_BUILD_ID: buildId,
            FAKE_DOCKER_LOG: dockerLog,
          },
        },
      );

      const release = join(remoteRoot, "releases", buildId);
      const commands = await readFile(dockerLog, "utf8");
      expect(commands).toContain("config --quiet");
      expect(commands).toContain("run --rm --no-deps server node dist/config-check.js");
      expect(commands).toContain("--entrypoint /bin/cat server /app/BUILD_ID");
      expect(commands).toContain("--profile operations run --rm migrate");
      expect(commands).toContain("up --detach --wait --remove-orphans");
      await expect(readFile(join(release, ".migration.env"), "utf8")).rejects.toThrow();
      expect(await readlink(join(remoteRoot, "current"))).toBe(`releases/${buildId}`);
      expect((await readFile(join(remoteRoot, "current-build"), "utf8")).trim()).toBe(buildId);
      const retainedReleases = await readdir(join(remoteRoot, "releases"));
      expect(retainedReleases.some((entry) => entry.startsWith(".replaced-"))).toBe(false);
      expect(retainedReleases.filter((entry) => /^[a-f0-9]{40}$/.test(entry))).toHaveLength(3);

      await run("sh", ["-se", "--", remoteRoot, "openround-staging", previousBuildId], {
        capture: true,
        input: REMOTE_RESTORE_PREVIOUS_SCRIPT,
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          FAKE_BUILD_ID: buildId,
          FAKE_DOCKER_LOG: dockerLog,
        },
      });
      expect(await readlink(join(remoteRoot, "current"))).toBe(`releases/${previousBuildId}`);
      expect(await readlink(join(remoteRoot, "previous"))).toBe(`releases/${buildId}`);
      expect((await readFile(join(remoteRoot, "current-build"), "utf8")).trim()).toBe(
        previousBuildId,
      );

      await expect(
        run(
          "sh",
          [
            "-se",
            "--",
            remoteRoot,
            "openround-staging",
            previousBuildId,
            "concurrent-token",
            "0",
            "1",
            previousBuildId,
            previousBuildId,
          ],
          {
            capture: true,
            input: REMOTE_DEPLOY_SCRIPT,
            env: {
              ...process.env,
              PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
              FAKE_BUILD_ID: previousBuildId,
              FAKE_DOCKER_LOG: dockerLog,
            },
          },
        ),
      ).rejects.toMatchObject({
        exitCode: 70,
        stderr: expect.stringContaining("Target build is already active"),
      });
      expect(await readlink(join(remoteRoot, "current"))).toBe(`releases/${previousBuildId}`);

      await expect(
        run(
          "sh",
          [
            "-se",
            "--",
            remoteRoot,
            "openround-staging",
            buildId,
            "stale-deploy-token",
            "0",
            "0",
            "c".repeat(40),
            "none",
          ],
          {
            capture: true,
            input: REMOTE_DEPLOY_SCRIPT,
            env: {
              ...process.env,
              PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
              FAKE_BUILD_ID: buildId,
              FAKE_DOCKER_LOG: dockerLog,
            },
          },
        ),
      ).rejects.toMatchObject({
        exitCode: 75,
        stderr: expect.stringContaining("Active build changed after deployment preflight"),
      });

      await expect(
        run(
          "sh",
          [
            "-se",
            "--",
            remoteRoot,
            "openround-staging",
            buildId,
            "stale-rollback-token",
            "0",
            "1",
            previousBuildId,
            "c".repeat(40),
          ],
          {
            capture: true,
            input: REMOTE_DEPLOY_SCRIPT,
            env: {
              ...process.env,
              PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
              FAKE_BUILD_ID: buildId,
              FAKE_DOCKER_LOG: dockerLog,
            },
          },
        ),
      ).rejects.toMatchObject({
        exitCode: 71,
        stderr: expect.stringContaining("Rollback source is no longer active"),
      });

      const mismatchedBuildId = "c".repeat(40);
      const mismatchedToken = "mismatched-server-token";
      const mismatchedIncoming = join(remoteRoot, "incoming", mismatchedToken);
      await mkdir(mismatchedIncoming, { recursive: true });
      await writeFile(join(mismatchedIncoming, ".compose-files"), "compose.single-vm.yaml\n");
      await writeFile(join(mismatchedIncoming, "compose.single-vm.yaml"), "services: {}\n");
      await writeFile(
        join(mismatchedIncoming, ".env"),
        `OPENROUND_BUILD_ID=${mismatchedBuildId}\n`,
        { mode: 0o600 },
      );
      await writeFile(
        join(mismatchedIncoming, ".migration.env"),
        "DATABASE_MIGRATION_URL=postgresql://owner\n",
        { mode: 0o600 },
      );
      await writeFile(dockerLog, "");
      await expect(
        run(
          "sh",
          [
            "-se",
            "--",
            remoteRoot,
            "openround-staging",
            mismatchedBuildId,
            mismatchedToken,
            "0",
            "0",
            previousBuildId,
            "none",
          ],
          {
            capture: true,
            input: REMOTE_DEPLOY_SCRIPT,
            env: {
              ...process.env,
              PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
              FAKE_BUILD_ID: mismatchedBuildId,
              FAKE_SERVER_BUILD_ID: "d".repeat(40),
              FAKE_WEB_BUILD_ID: mismatchedBuildId,
              FAKE_DOCKER_LOG: dockerLog,
            },
          },
        ),
      ).rejects.toMatchObject({
        exitCode: 67,
        stderr: expect.stringContaining("Server image BUILD_ID does not match release"),
      });
      expect(await readFile(dockerLog, "utf8")).not.toContain("--profile operations");
      expect(await readlink(join(remoteRoot, "current"))).toBe(`releases/${previousBuildId}`);
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("keeps remote lifecycle interrupts non-successful and releases the mutation lock", async () => {
    const artifactsRoot = join(repositoryRoot, "artifacts");
    await mkdir(artifactsRoot, { recursive: true });
    const fixtureRoot = await mkdtemp(join(artifactsRoot, "remote service signal simulation "));
    const remoteRoot = join(fixtureRoot, "remote");
    const release = join(remoteRoot, "releases", buildId);
    const fakeBin = join(fixtureRoot, "bin");
    try {
      await mkdir(release, { recursive: true });
      await mkdir(fakeBin, { recursive: true });
      await writeFile(join(release, ".compose-files"), "compose.single-vm.yaml\n");
      await writeFile(join(release, "compose.single-vm.yaml"), "services: {}\n");
      await writeFile(join(release, ".env"), `OPENROUND_BUILD_ID=${buildId}\n`, { mode: 0o600 });
      await symlink(`releases/${buildId}`, join(remoteRoot, "current"));
      const fakeDocker = join(fakeBin, "docker");
      await writeFile(
        fakeDocker,
        ["#!/bin/sh", 'kill -TERM "$PPID"', "sleep 1", "exit 0", ""].join("\n"),
      );
      await chmod(fakeDocker, 0o755);

      await expect(
        run("sh", ["-se", "--", remoteRoot, "openround-staging", "start", "0"], {
          capture: true,
          input: REMOTE_SERVICE_SCRIPT,
          env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
        }),
      ).rejects.toMatchObject({ exitCode: 143 });
      await expect(readFile(join(remoteRoot, ".deploy.lock", "pid"), "utf8")).rejects.toThrow();
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
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

  it("uses strict SSH for hosted service control and requires explicit push for hosted builds", async () => {
    const hostedServiceOutput = await withReviewedDeploymentGitState(() =>
      captureStdout(() => serviceMain(["staging", "restart", "--dry-run"])),
    );
    expect(hostedServiceOutput).toContain("ssh -T");
    expect(hostedServiceOutput).toContain("StrictHostKeyChecking=yes");
    expect(hostedServiceOutput).toContain("openround@staging-vm.openround.example");
    expect(hostedServiceOutput).toContain("openround-staging restart 0");
    expect(hostedServiceOutput).not.toContain(" down ");
    expect(hostedServiceOutput).not.toContain("--volumes");
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
        "https://staging.openround.example",
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
      await writeFile(runtimePath, singleVmRuntimeEnvironment(), { mode: 0o600 });
      await writeFile(migrationPath, "DATABASE_MIGRATION_URL=postgres://owner\n", {
        mode: 0o600,
      });

      const output = await withReviewedDeploymentGitState(async ({ head }) => {
        await writeFile(
          manifestPath,
          `${JSON.stringify(buildManifest("staging", head), null, 2)}\n`,
        );
        return await captureStdout(() =>
          deployMain([
            "staging",
            "--manifest",
            manifestPath,
            "--runtime-env",
            runtimePath,
            "--migration-env",
            migrationPath,
            "--confirm",
            `staging:${head}`,
            "--dry-run",
          ]),
        );
      });
      expect(output).toContain("ssh -T");
      expect(output.match(/cosign verify/g)).toHaveLength(2);
      expect(output.lastIndexOf("cosign verify")).toBeLessThan(output.indexOf("ssh -T"));
      expect(output).toContain("StrictHostKeyChecking=yes");
      expect(output).toContain("openround@staging-vm.openround.example");
      expect(output).toContain("/opt/openround/staging");
      expect(output).toContain("openround-staging");
      expect(output).not.toContain("owner-secret");
      expect(output).not.toContain("app-secret");
      expect(output).toContain("Dry run complete");
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("prints a code-only rollback without accepting or running migration credentials", async () => {
    const artifactsRoot = join(repositoryRoot, "artifacts", "deploy", "staging");
    await mkdir(artifactsRoot, { recursive: true });
    const fixtureRoot = await mkdtemp(join(artifactsRoot, "operations rollback dry run "));
    const manifestPath = join(fixtureRoot, "rollback build manifest.json");
    const runtimePath = join(fixtureRoot, "runtime credentials.env");
    try {
      await writeFile(runtimePath, singleVmRuntimeEnvironment(), { mode: 0o600 });

      const output = await withReviewedDeploymentGitState(async ({ head, parent }) => {
        await writeFile(
          manifestPath,
          `${JSON.stringify(buildManifest("staging", parent), null, 2)}\n`,
        );
        return await captureStdout(() =>
          deployMain([
            "staging",
            "--rollback",
            "--rollback-from",
            head,
            "--manifest",
            manifestPath,
            "--runtime-env",
            runtimePath,
            "--confirm",
            `rollback:staging:${parent}:from:${head}`,
            "--dry-run",
          ]),
        );
      });
      expect(output).toContain("Code rollback selected");
      expect(output).not.toContain("dist/migrate.js");
      expect(output).not.toContain("migration credentials");
      expect(output).toContain("ssh -T");
      expect(output).not.toContain("flyctl deploy");
    } finally {
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
      await writeFile(runtimePath, singleVmRuntimeEnvironment(), { mode: 0o600 });
      await writeFile(migrationPath, "DATABASE_MIGRATION_URL=postgres://owner\n", {
        mode: 0o600,
      });
      await withReviewedDeploymentGitState(async ({ head }) => {
        await writeFile(
          manifestPath,
          `${JSON.stringify(buildManifest("staging", head), null, 2)}\n`,
        );
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
            `staging:${head}`,
            "--dry-run",
          ]),
        ).rejects.toThrow("runtime environment file must be inside");
      });
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});

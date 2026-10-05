#!/usr/bin/env node

import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import {
  assertConfiguredHostedTarget,
  assertKnownHostsTarget,
  isHostedEnvironment,
  normalizeEnvironment,
  readStrictJson,
  resolveCheckedRepositoryFile,
  validateDeployConfig,
} from "./ops/lib.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function usage() {
  return "Usage: node scripts/check-deployment-target.mjs <staging|production>";
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && ["-h", "--help"].includes(argv[0])) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (argv.length !== 1) throw new Error(usage());
  const environment = normalizeEnvironment(argv[0]);
  if (!isHostedEnvironment(environment)) {
    throw new Error("Deployment target check requires staging or production");
  }
  const configPath = await resolveCheckedRepositoryFile(
    `config/deploy/${environment}.json`,
    repositoryRoot,
    "deployment config",
    { requireGitClean: true },
  );
  const config = await readStrictJson(configPath, validateDeployConfig, environment);
  assertConfiguredHostedTarget(config);
  if (config.deploymentMode === "single-vm") {
    const knownHostsFile = await resolveCheckedRepositoryFile(
      config.singleVm.knownHostsFile,
      repositoryRoot,
      "SSH known-hosts file",
      { requireGitClean: true },
    );
    await assertKnownHostsTarget(knownHostsFile, config.singleVm);
  }
  process.stdout.write(`Hosted deployment target ${environment} is configured.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Deployment target check failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

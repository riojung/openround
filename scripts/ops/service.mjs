#!/usr/bin/env node

import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import {
  assertCommandAvailable,
  composeArgv,
  normalizeEnvironment,
  parseCliArguments,
  run,
} from "./lib.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const ACTIONS = new Set(["start", "stop", "restart", "status", "logs"]);

function usage() {
  return `Usage: scripts/service.sh development <start|stop|restart|status|logs> [options]
       scripts/service.sh --environment development <action> [options]

Options:
  --profile <core|media|observability>  Select a fixed Compose file set (default: core)
  --no-build                           Do not build images during start or restart
  --follow                             Follow logs instead of returning after the last 200 lines
  --dry-run                            Print the fixed Docker argv without running it

The service command intentionally manages only the fixed local development Compose project.`;
}

function serviceSelection(parsed) {
  const explicitEnvironment = parsed.values.get("environment");
  let environment;
  let action;
  if (explicitEnvironment) {
    if (parsed.positionals.length !== 1) {
      throw new Error("Exactly one service action is required with --environment");
    }
    environment = normalizeEnvironment(explicitEnvironment);
    action = parsed.positionals[0];
  } else {
    if (parsed.positionals.length !== 2) {
      throw new Error("The development environment and one service action are required");
    }
    environment = normalizeEnvironment(parsed.positionals[0]);
    action = parsed.positionals[1];
  }
  if (environment !== "development") {
    throw new Error("service.sh is development-only; use deploy.sh for hosted environments");
  }
  if (!ACTIONS.has(action)) throw new Error(`Unsupported service action ${JSON.stringify(action)}`);
  return { environment, action };
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseCliArguments(argv, {
    valueOptions: ["environment", "profile"],
    booleanOptions: ["dry-run", "no-build", "follow", "help"],
  });
  if (parsed.flags.has("help")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const { action } = serviceSelection(parsed);
  if (parsed.flags.has("no-build") && !["start", "restart"].includes(action)) {
    throw new Error("--no-build is valid only for start or restart");
  }
  if (parsed.flags.has("follow") && action !== "logs") {
    throw new Error("--follow is valid only for logs");
  }
  const dryRun = parsed.flags.has("dry-run");
  await assertCommandAvailable("docker", { cwd: repositoryRoot, dryRun });
  await run(
    "docker",
    composeArgv(action, {
      follow: parsed.flags.has("follow"),
      noBuild: parsed.flags.has("no-build"),
      profile: parsed.values.get("profile") ?? "core",
    }),
    { cwd: repositoryRoot, dryRun },
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Service command failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

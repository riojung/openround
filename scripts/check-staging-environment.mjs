#!/usr/bin/env node

import process from "node:process";
import { fileURLToPath } from "node:url";

const repository = "riojung/pollingpops";
const environmentName = "single-vm-staging";

export function validateStagingEnvironment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Staging environment response must be an object");
  }
  if (value.name !== environmentName) {
    throw new Error("Staging environment response has the wrong name");
  }
  if (value.can_admins_bypass !== false) {
    throw new Error("Staging environment must disable administrator bypass");
  }
  if (!Array.isArray(value.protection_rules)) {
    throw new Error("Staging environment protection rules are missing");
  }

  const protectedByReviewer = value.protection_rules.some(
    (rule) =>
      rule?.type === "required_reviewers" &&
      rule.prevent_self_review === true &&
      Array.isArray(rule.reviewers) &&
      rule.reviewers.some(
        (entry) =>
          (entry?.type === "User" || entry?.type === "Team") &&
          Number.isSafeInteger(entry.reviewer?.id) &&
          entry.reviewer.id > 0,
      ),
  );
  if (!protectedByReviewer) {
    throw new Error("Staging environment requires an independent required reviewer");
  }
  return value;
}

export async function main({
  token = process.env.GITHUB_TOKEN,
  githubRepository = process.env.GITHUB_REPOSITORY,
  fetchImpl = fetch,
} = {}) {
  if (githubRepository !== repository) {
    throw new Error("Staging environment check requires the reviewed repository");
  }
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("GitHub token is required to check staging environment protection");
  }

  const response = await fetchImpl(
    `https://api.github.com/repos/${repository}/environments/${environmentName}`,
    {
      method: "GET",
      redirect: "error",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (response.status !== 200) {
    throw new Error(`GitHub staging environment lookup failed with HTTP ${response.status}`);
  }
  validateStagingEnvironment(await response.json());
  process.stdout.write("Staging environment requires independent review.\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`Staging environment check failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

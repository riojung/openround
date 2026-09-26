import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  assertRestrictedRuntimeDatabasePrincipal,
  PostgresRepository,
  type Repository,
  type RuntimeDatabasePrincipalSecurity,
} from "@openround/db";
import { z } from "zod";
import { loadConfig, type AppConfig } from "./config.js";

const fullGitSha = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const requestId = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{2,199}$/;
const workspaceIdSchema = z.string().uuid();

export const STAGING_CAPACITY_PARTICIPANTS = 250;
export const STAGING_CAPACITY_ENABLEMENT = "enabled";

type ProvisioningRepository = Pick<Repository, "provisionCapacityTestWorkspace"> &
  Pick<PostgresRepository, "inspectRuntimeDatabasePrincipal">;

export function stagingCapacityConfirmation(workspaceId: string) {
  return `provision-staging-capacity:${workspaceId}:team-250`;
}

export function validateStagingCapacityRuntime(
  config: Pick<
    AppConfig,
    | "NODE_ENV"
    | "OPENROUND_DEPLOYMENT_ENVIRONMENT"
    | "COMMUNITY_MODE"
    | "BILLING_MODE"
    | "MAX_SESSION_PARTICIPANTS"
    | "ALLOW_IN_MEMORY"
    | "DATABASE_URL"
    | "DATABASE_MIGRATION_URL"
    | "OPENROUND_BUILD_ID"
  >,
  enablement: string | undefined,
) {
  if (enablement !== STAGING_CAPACITY_ENABLEMENT) {
    throw new Error(
      `OPENROUND_STAGING_CAPACITY_PROVISIONING must be ${STAGING_CAPACITY_ENABLEMENT} for this one-shot command`,
    );
  }
  if (config.NODE_ENV !== "production" || config.OPENROUND_DEPLOYMENT_ENVIRONMENT !== "staging") {
    throw new Error("Capacity provisioning is restricted to the hosted staging environment");
  }
  if (config.COMMUNITY_MODE) {
    throw new Error("Capacity provisioning requires COMMUNITY_MODE=false");
  }
  if (config.BILLING_MODE !== "disabled") {
    throw new Error("Capacity provisioning requires BILLING_MODE=disabled");
  }
  if (config.MAX_SESSION_PARTICIPANTS !== STAGING_CAPACITY_PARTICIPANTS) {
    throw new Error(
      `Capacity provisioning requires MAX_SESSION_PARTICIPANTS=${STAGING_CAPACITY_PARTICIPANTS}`,
    );
  }
  if (config.ALLOW_IN_MEMORY || !config.DATABASE_URL) {
    throw new Error("Capacity provisioning requires the durable PostgreSQL runtime repository");
  }
  if (config.DATABASE_MIGRATION_URL) {
    throw new Error("Capacity provisioning must not receive the owner migration credential");
  }
  if (!fullGitSha.test(config.OPENROUND_BUILD_ID)) {
    throw new Error("Capacity provisioning requires a build with an immutable Git build ID");
  }
  return true;
}

export function validateRestrictedDatabasePrincipal(principal: RuntimeDatabasePrincipalSecurity) {
  return assertRestrictedRuntimeDatabasePrincipal(principal);
}

export async function provisionStagingCapacity(options: {
  config: Parameters<typeof validateStagingCapacityRuntime>[0];
  enablement: string | undefined;
  workspaceId: string;
  requestId: string;
  confirmation: string;
  repository: ProvisioningRepository;
}) {
  validateStagingCapacityRuntime(options.config, options.enablement);
  const workspaceId = workspaceIdSchema.parse(options.workspaceId);
  if (!requestId.test(options.requestId)) {
    throw new Error(
      "--request-id must be a non-secret 3-200 character change or exercise reference",
    );
  }
  const expectedConfirmation = stagingCapacityConfirmation(workspaceId);
  if (options.confirmation !== expectedConfirmation) {
    throw new Error(`--confirm must exactly match ${expectedConfirmation}`);
  }
  validateRestrictedDatabasePrincipal(await options.repository.inspectRuntimeDatabasePrincipal());
  return options.repository.provisionCapacityTestWorkspace(workspaceId, options.requestId);
}

function usage() {
  return `Usage: node dist/staging-capacity-provision.js \\
  --workspace-id UUID \\
  --request-id CHANGE_REFERENCE \\
  --confirm provision-staging-capacity:UUID:team-250`;
}

export async function main(argv = process.argv.slice(2), environment = process.env) {
  const parsed = parseArgs({
    args: argv,
    options: {
      "workspace-id": { type: "string" },
      "request-id": { type: "string" },
      confirm: { type: "string" },
      help: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (parsed.values.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const workspaceId = parsed.values["workspace-id"];
  const operationRequestId = parsed.values["request-id"];
  const confirmation = parsed.values.confirm;
  if (!workspaceId || !operationRequestId || !confirmation) {
    throw new Error(usage());
  }

  const config = loadConfig(environment);
  validateStagingCapacityRuntime(config, environment.OPENROUND_STAGING_CAPACITY_PROVISIONING);
  const repository = new PostgresRepository(config.DATABASE_URL!);
  try {
    await repository.initialize();
    const result = await provisionStagingCapacity({
      config,
      enablement: environment.OPENROUND_STAGING_CAPACITY_PROVISIONING,
      workspaceId,
      requestId: operationRequestId,
      confirmation,
      repository,
    });
    process.stdout.write(
      `${JSON.stringify({
        requestId: operationRequestId,
        ...result,
        maxParticipants: STAGING_CAPACITY_PARTICIPANTS,
        auditRecorded: result.changed,
      })}\n`,
    );
  } finally {
    await repository.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`Staging capacity provisioning failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

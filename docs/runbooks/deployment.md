# Build, service, and deployment runbook

This runbook defines the supported operator interfaces for building OpenRound, controlling the
local service stack, and promoting a release to a hosted environment. The scripts are safety
wrappers around existing build, Compose, validation, migration, and Fly.io tooling; they are not
evidence that a staging or production environment has been provisioned or deployed.

## Environment boundary

| Environment   | Runtime path                         | Image policy                                  |
| ------------- | ------------------------------------ | --------------------------------------------- |
| `development` | Local Docker Compose only            | Local images; pushing is not required         |
| `staging`     | Fly.io hosted deployment             | Registry images selected by immutable digest  |
| `production`  | Fly.io hosted deployment after gates | Registry images selected by digest and signed |

Compose is local-only. Do not use Compose to represent, update, or roll back a hosted staging or
production environment. Conversely, `service.sh` deliberately does not operate hosted services.
The lifecycle wrapper uses the repository's existing `openround` Compose project, so it operates
the same services and persistent volumes as the documented quick-start commands.

All three scripts accept the environment as the first positional argument. The explicit
`--environment development|staging|production` form is an equivalent alias when it makes an
automated invocation easier to read.

## Command summary

### Build product images

Build the development images:

```bash
./scripts/product-build.sh development
```

Hosted builds require the target environment, the public HTTPS API URL compiled into the web
application, a registry prefix, `--push`, and Docker with the Buildx plugin available:

```bash
./scripts/product-build.sh staging \
  --api-url https://openround-ca-staging-server.fly.dev \
  --registry ghcr.io/riojung/openround/openround \
  --push
```

The hosted API URL and registry must match the reviewed target configuration. Hosted builds also
require a clean Git worktree so the full source commit can serve as the build identifier; do not
build a release from staged, unstaged, or untracked changes. The wrapper restores Next.js's
generated `next-env.d.ts` after the host build and verifies cleanliness again immediately before
Buildx receives the Docker context.

Production builds use this same script only inside the protected, tag-triggered
`.github/workflows/release.yml` job. That job supplies the required GitHub Actions OIDC identity,
builds the configured `linux/amd64` target, signs and verifies both images, and uploads the
deployment manifest. High and critical fixed-vulnerability scan findings fail before signing. An
arbitrary local signer cannot satisfy the configured production identity, and the policy must not
be weakened to make a workstation build pass.

The hosted build records its target platform, immutable image references, and build identifier in:

```text
artifacts/deploy/<environment>/build-manifest.json
```

That manifest is deployment input and release evidence. Do not replace its digest references with
mutable tags. A successful build or registry push does not change any running environment.

### Operate local services

The local service interface is:

```text
./scripts/service.sh development start|stop|restart|status|logs \
  [--profile core|media|observability] [--no-build] [--follow]
```

Examples:

```bash
./scripts/service.sh development start --profile core
./scripts/service.sh development restart --profile media --no-build
./scripts/service.sh development status --profile observability
./scripts/service.sh development logs --profile core --follow
./scripts/service.sh development stop --profile core
```

- `core` runs the base local stack.
- `media` adds the production-equivalent local quarantine and malware-scanning path.
- `observability` includes the media overlay and adds the local metrics and dashboard services.
- `--no-build` reuses existing images for actions that would otherwise build them.
- `--follow` follows log output and is intended for the `logs` action.

Use `status` and the documented readiness endpoint after `start` or `restart`; process startup
alone is not application readiness. Local data, reset behavior, profile requirements, and first
use remain documented in the [quick start](../quick-start.md).

### Deploy an environment

Development deployment is a local convenience path:

```bash
./scripts/deploy.sh development
```

Use `service.sh` when explicit local start, stop, restart, status, or log control is needed.

A hosted deployment has this interface:

```text
./scripts/deploy.sh staging|production \
  --config <deployment-config.json> \
  [--manifest <build-manifest.json>] \
  --runtime-env <runtime.env> \
  --migration-env <migration.env> \
  --confirm <environment>:<build-id> \
  [--backup-reference <reference>] \
  [--recover-lock]
```

For a reviewed code-only rollback, omit `--migration-env` and use the distinct rollback contract:

```text
./scripts/deploy.sh staging|production \
  --rollback \
  --rollback-from <current-build-id> \
  --manifest <target-build-manifest.json> \
  --runtime-env <runtime.env> \
  --confirm rollback:<environment>:<target-build-id>:from:<current-build-id> \
  [--backup-reference <reference>]
```

The default manifest is
`artifacts/deploy/<environment>/build-manifest.json`; use `--manifest` only to select another
reviewed manifest explicitly. The checked-in non-secret configuration files are:

```text
config/deploy/dev.json
config/deploy/staging.json
config/deploy/production.json
```

Production requires `--backup-reference`. The reference identifies the operator-verified backup
or point-in-time recovery anchor for the release. Supplying it does not create a backup or prove
that a restore works.

Hosted deployments acquire one local lock per environment before migration or provider changes.
If an interrupted command leaves a lock behind, inspect its recorded host, process ID, build, and
start time first. `--recover-lock` only recovers a lock at least 30 minutes old, refuses a still-live
owner process on the same host, and archives the stale record before acquiring a replacement. It
is an explicit recovery tool, not a concurrency override; dry runs never create or recover locks.

## Secret-file boundary

Runtime and migration credentials must remain separate:

- The runtime environment file contains only credentials and settings required by the long-lived
  application. It must use the non-owner PostgreSQL role and must not contain
  `DATABASE_MIGRATION_URL`. The deployment script uses this file to run the exact image's
  configuration preflight; it does not upload or replace Fly.io application secrets.
- The migration environment file is provided only to the one-shot migration command. It contains
  the owner-level `DATABASE_MIGRATION_URL` and must not be installed in, or passed to, the
  long-lived server or web application.

Both files must be regular non-symlink files, excluded from Git, mode `0600`, and located under the
literal non-symlinked `artifacts/deploy/<environment>/` subtree. This fixed subtree is excluded from
the Docker build context so credentials cannot be sent to BuildKit. The deployment script rejects
files that do not meet that boundary. Prepare them with:

```bash
mkdir -p artifacts/deploy/staging
chmod 700 artifacts/deploy/staging
touch artifacts/deploy/staging/runtime.env artifacts/deploy/staging/migration.env
chmod 600 artifacts/deploy/staging/runtime.env artifacts/deploy/staging/migration.env
git check-ignore artifacts/deploy/staging/runtime.env artifacts/deploy/staging/migration.env
```

`artifacts/` is ignored by this repository. Prefer a managed secret injection path in CI; if
temporary files are required, remove them after the deployment evidence has been retained. Never
put secret values in the non-secret deployment config, build manifest, command arguments, logs, or
release artifacts.

Provision the corresponding runtime secrets through the hosted provider's approved secret path
before promotion. The candidate runtime file's key set must exactly match the server app's Fly
secret names, while the web app must have no provider secrets; secret values remain local and are
used only for the exact-image preflight. The operator also needs authenticated registry, Fly.io,
and signing access appropriate to the target; the scripts validate tools and inputs but do not
provision provider accounts.

## Staging promotion

1. Complete the applicable clean-checkout tests and review the non-secret
   `config/deploy/staging.json` values, public URLs, regions, feature ceilings, and service names.
2. Build and push the staging images:

   ```bash
   ./scripts/product-build.sh staging \
     --api-url https://openround-ca-staging-server.fly.dev \
     --registry ghcr.io/riojung/openround/openround \
     --push
   ```

3. Read the build identifier and digest-pinned image references from
   `artifacts/deploy/staging/build-manifest.json`. Review the manifest as an immutable unit; do not
   combine a web image from one build with a server image from another.
4. Prepare separate ignored `0600` runtime and migration files, then deploy using the exact build
   identifier as the confirmation value:

   ```bash
   ./scripts/deploy.sh staging \
     --config config/deploy/staging.json \
     --manifest artifacts/deploy/staging/build-manifest.json \
     --runtime-env artifacts/deploy/staging/runtime.env \
     --migration-env artifacts/deploy/staging/migration.env \
     --confirm staging:<build-id>
   ```

5. Retain the non-secret preflight summary and deployment evidence. Run the
   [staging readiness](staging-readiness.md) workflow and the target-region checks required for the
   release. Repository tests and a public probe are not production-capacity evidence.

The explicit confirmation binds operator intent to both the target environment and the manifest's
build identifier. Copy the identifier from the reviewed manifest; do not use a tag or a shortened
guess.

## Production promotion

Production is a separate build and promotion. Do not promote merely because the same source
revision passed locally.

1. Complete the [production readiness checklist](production-readiness.md), including required
   legal, security, accessibility, provider, restore, staging, target-region load, observability,
   incident-response, and human approval evidence. The deployment script can enforce mechanical
   checks, but it cannot manufacture these approvals.
2. Confirm a current backup or point-in-time recovery anchor and a successful restore exercise.
   Record the approved anchor as the `--backup-reference` value.
3. Create the approved signed semantic-version tag. The protected `Release images` workflow runs
   the production build under the allowlisted GitHub Actions OIDC identity, scans the images, and
   uploads `release-deployment-manifest-<tag>` together with the per-image release evidence.
4. Download and review its `build-manifest.json`, including the `linux/amd64` target, build
   identifier, digest-pinned images, and signing result. Place the reviewed file at
   `artifacts/deploy/production/build-manifest.json`, then prepare production-only ignored `0600`
   runtime and migration files.
5. Promote the reviewed manifest:

   ```bash
   ./scripts/deploy.sh production \
     --config config/deploy/production.json \
     --manifest artifacts/deploy/production/build-manifest.json \
     --runtime-env artifacts/deploy/production/runtime.env \
     --migration-env artifacts/deploy/production/migration.env \
     --confirm production:<build-id> \
     --backup-reference <verified-backup-or-pitr-reference>
   ```

6. Verify dependency readiness and the web and server build markers before increasing traffic.
   Observe the rehearsed promotion signals and stop when a gate is not met.

Neither this command nor the checked-in Fly.io profile claims that the production apps, domains,
managed data services, paging routes, or provider accounts exist. Provisioning and credential
verification remain operator responsibilities.

## Deployment sequence and credential isolation

For a hosted deployment, the scripts keep these phases distinct and use the exact digest-selected
server image from the reviewed manifest:

1. **Validate inputs and gates.** Check the environment/config/manifest relationship, confirmation
   string, target platform, immutable image references, secret-file permissions, reviewed Fly
   environment, and environment-specific gates.
2. **Configuration preflight.** Run `node dist/config-check.js` with the runtime environment. This
   combines the runtime secrets with the checked Fly non-secret environment, then validates the
   exact candidate application's schema, public origins, persistence/coordination mode, rollout
   ceilings, and cross-field configuration without exposing secret values. It does not prove that
   external credentials authenticate or that provider secrets have not drifted.
3. **One-shot migration.** Run `node dist/migrate.js` separately with only the migration
   environment. Migrations are forward-only and rerunnable; the owner credential never enters the
   long-lived application environment.
4. **Fly.io release.** Update the hosted web and server applications using the reviewed image
   digests, then wait for the configured health/readiness checks. A live process is not sufficient;
   dependency readiness must pass.
5. **Post-deploy verification.** Compare the running server and web build markers with the
   manifest, then run the environment's smoke, observability, and promotion checks.

Do not merge configuration preflight and migration into one privileged long-lived process. If
preflight fails, do not migrate. If migration fails, do not promote application images; preserve
the failure evidence and follow the migration's forward-repair plan.

## Failure and rollback policy

- Stop when a build, signature, preflight, migration, Fly.io readiness, build-marker, or promotion
  gate fails. Do not change the confirmation value to bypass a mismatch.
- Application rollback is **code-only**: redeploy a previously approved manifest whose immutable
  web and server digests are compatible with the current schema.
- Do not reverse a production database migration. Database changes are forward-only; use the
  release's documented forward repair when a schema or data correction is required.
- A prior image is not a safe rollback candidate unless its code tolerates the current schema.
  Expand/contract changes must keep old and new application versions compatible throughout the
  rollout window.
- A rollback uses `--rollback`, omits the owner-only migration file, verifies that the selected
  target is a Git ancestor of `--rollback-from`, and checks that the running build markers are in
  the expected source/target state before changing either app. The confirmation must exactly match
  `rollback:<environment>:<target-build-id>:from:<current-build-id>`.
- A production rollback still requires a current `--backup-reference`; this control is not waived
  during an incident.
- After rollback or forward repair, verify readiness, build markers, live-session behavior,
  reports, background work, and observability before closing the incident. Follow the
  [incident-response runbook](incident-response.md) for ownership and communication.

See the [upgrade and rollback runbook](upgrade.md) for schema compatibility rules and the
[backup and restore runbook](backup-restore.md) for recovery evidence.

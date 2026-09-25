# Build, service, and deployment runbook

This runbook defines the supported operator interfaces for building OpenRound and running every
environment on one Linux host. It does not claim that a staging or production host, domain, backup,
monitoring route, or provider account has been provisioned.

## Supported topology

| Environment   | Single-host implementation                      | Image policy                                 |
| ------------- | ----------------------------------------------- | -------------------------------------------- |
| `development` | Local `compose.yaml` and optional overlays      | Locally built images                         |
| `staging`     | Remote `compose.single-vm.yaml` over pinned SSH | Registry images selected by immutable digest |
| `production`  | Remote `compose.single-vm.yaml` after all gates | Signed digest-selected registry images       |

The hosted stack places Caddy, web, API/realtime, PostgreSQL, Valkey, MinIO, and ClamAV on one VM.
Only TCP 80/443 and UDP 443 are published by Compose. The database, cache, scanner, and MinIO
administration port are not published. Caddy obtains TLS certificates and routes the application
origin to web/API services and the separate media origin to MinIO.

This is an initial alpha/beta topology. A host, disk, kernel, Docker daemon, or availability-zone
failure can interrupt every service at once. It has no high-availability or SLA claim. Keep
encrypted database and media backups off the VM, rehearse restoration onto a clean replacement
host, and do not call the deployment production-ready until the release ledger is complete.

## Command summary

All wrappers accept the environment as their first positional argument. The explicit
`--environment development|staging|production` form is equivalent.

### Build product images

Build local development images:

```bash
./scripts/product-build.sh development
```

Hosted builds require a clean Git worktree, Buildx, an HTTPS application origin matching the
checked-in target config, a registry prefix matching that config, and `--push`. This is the
underlying command used by the protected staging-image workflow:

```bash
./scripts/product-build.sh staging \
  --api-url https://staging.openround.example \
  --registry ghcr.io/riojung/openround/openround \
  --push
```

Active staging requires signatures from `.github/workflows/staging-images.yml` running on `main`;
an arbitrary workstation signature cannot satisfy its identity policy. Dispatch **Staging images**
after the target config is reviewed, then download its signed manifest. Before a real deployment,
replace the `.example` domains and placeholder host names in
`config/deploy/staging.json` and `config/deploy/production.json`. The build writes digest-selected
references and the full Git commit to:

```text
artifacts/deploy/<environment>/build-manifest.json
```

Do not replace digest references with mutable tags or combine server and web images from different
manifests. Production images are built by the protected tag-triggered release workflow, scanned,
signed using its allowlisted OIDC identity, and verified before promotion.

### Operate services

Local development supports fixed profiles:

```text
./scripts/service.sh development start|stop|restart|status|logs \
  [--profile core|media|observability] [--no-build] [--follow]
```

| Profile         | Services                                                                  |
| --------------- | ------------------------------------------------------------------------- |
| `core`          | PostgreSQL, Valkey, MinIO, Mailpit, server, web, and Caddy                |
| `media`         | Core plus ClamAV                                                          |
| `observability` | Media plus Prometheus and Grafana; this is the complete development stack |

Examples:

```bash
./scripts/service.sh development start --profile core
./scripts/service.sh development restart --profile media --no-build
./scripts/service.sh development status --profile observability
./scripts/service.sh development logs --profile core --follow
./scripts/service.sh development stop --profile core
```

#### Reclaim local Docker disk space and rebuild

`pnpm service development restart --profile core` rebuilds and force-recreates only the core
profile. It does not start the optional media or observability services, remove old images, or
reclaim unrelated Docker storage. Inspect usage before cleanup:

```bash
docker system df
docker system df --verbose
```

To remove the complete local OpenRound Compose project and every image referenced by its core,
media, and observability services while preserving named data volumes, run from the repository
root:

```bash
docker compose \
  --project-name openround \
  --file compose.yaml \
  --file compose.media.yaml \
  --file compose.observability.yaml \
  --profile observability \
  down --remove-orphans --rmi all
```

This targets the `openround` project's containers, networks, and service images. It deliberately
omits `--volumes`, so the PostgreSQL, MinIO, Valkey, ClamAV, and Prometheus named volumes remain.
Grafana's checked-in provisioned dashboards and data-source configuration are recreated on start,
but its runtime database, runtime-created dashboards, users, and settings are ephemeral because
`/var/lib/grafana` has no data volume. Mailpit messages are also ephemeral. Export any runtime state
that matters before teardown. Images shared with another project may need to be pulled again the
next time that project starts.

If host-wide cleanup is also required, review `docker system df --verbose` first, then run:

```bash
docker system prune --all --force
```

This second command is global: it removes stopped containers, unused networks, unused images, and
build cache from every Docker project on the host, not only OpenRound. It does not remove volumes
without an explicit volume option.

**Data-preservation boundary:** do not add `--volumes`, and do not run `docker volume prune` or
`docker volume prune --all`, unless an intentional data reset has been approved and PostgreSQL and
MinIO backups have been created and verified. Those operations can permanently remove databases,
uploaded media, queued state, malware signatures, and monitoring history.

Rebuild the OpenRound application images once, start the complete stack without rebuilding them a
second time, and verify application and observability health:

```bash
pnpm product:build development
pnpm service development start --profile observability --no-build
pnpm service development status --profile observability
pnpm smoke:compose
pnpm smoke:observability
docker system df
```

Replace `observability` with `media` or `core` only when the corresponding smaller profile is the
intended target. For a routine rebuild and restart that does not need disk cleanup, use
`pnpm service development restart --profile observability`.

For staging and production the same interface operates the already-deployed remote release through
strict host-key-checked SSH:

```text
./scripts/service.sh staging|production start|stop|restart|status|logs \
  --config config/deploy/<environment>.json \
  [--ssh-identity /path/to/private-key] [--follow]
```

The identity option is optional when a suitable key is already loaded in `ssh-agent`. A supplied
identity must be a regular, non-symlink file with mode `0600`. Hosted lifecycle actions use the
Compose project and current-release path from the checked-in configuration; they do not accept an
arbitrary host or remote command.

### Deploy an environment

Development deployment starts the local Compose stack:

```bash
./scripts/deploy.sh development
```

The hosted deployment contract is:

```text
./scripts/deploy.sh staging|production \
  --config config/deploy/<environment>.json \
  [--manifest artifacts/deploy/<environment>/build-manifest.json] \
  --runtime-env artifacts/deploy/<environment>/runtime.env \
  --migration-env artifacts/deploy/<environment>/migration.env \
  --confirm <environment>:<full-build-id> \
  [--ssh-identity /path/to/private-key] \
  [--backup-reference <reference>] [--recover-lock] [--dry-run]
```

Production requires `--backup-reference`. The value identifies an operator-verified off-host
backup or recovery anchor; passing a string neither creates a backup nor proves restoration.

Code-only rollback selects a previously approved, schema-compatible manifest:

```text
./scripts/deploy.sh staging|production \
  --rollback \
  --rollback-from <current-full-build-id> \
  --manifest <target-build-manifest.json> \
  --runtime-env artifacts/deploy/<environment>/runtime.env \
  --confirm rollback:<environment>:<target-build-id>:from:<current-build-id> \
  [--ssh-identity /path/to/private-key] [--backup-reference <reference>]
```

Rollback omits the migration file and never reverses a database migration.

## Provision each hosted VM

Provision staging and production independently. At minimum:

1. Select a supported Linux VM whose architecture matches `imagePlatform` (`linux/amd64` or
   `linux/arm64`). Start with measured resources; the example resource limits assume roughly four
   vCPUs and 8 GB of memory.
2. Install current Docker Engine and the Compose v2 plugin. Configure Docker to start at boot and
   authenticate the deployment user to the image registry without putting a token in this repo.
3. Create a dedicated non-root `openround` deployment user, its SSH key, and the configured deploy
   root (for example `/opt/openround/staging`) owned only by that user. Docker control is effectively
   host-administrator access even without `sudo`; restrict this account and key to the dedicated VM,
   prohibit unrelated workloads, and do not grant additional passwordless administration.
4. Permit inbound HTTP/HTTPS only (TCP 80/443 and optionally UDP 443) plus SSH from the approved
   operator or CI network. Do not expose PostgreSQL, Valkey, MinIO administration, ClamAV, or the
   Docker socket.
5. Point the application and media DNS names at the VM. Caddy can obtain certificates only after
   public DNS and the firewall are correct.
6. Obtain the VM's SSH host key through an independently verified channel and place the exact entry
   in `config/deploy/ssh/<environment>_known_hosts`. The checked-in comment is deliberately not a
   usable key. Never populate it from an unverified connection or disable strict checking.
7. Configure an external SMTP service. Configure an external telemetry/paging destination before
   a customer beta. Schedule encrypted PostgreSQL and MinIO backups to storage that does not share
   the VM's credentials or failure domain.

The active non-secret target files are:

```text
config/deploy/dev.json
config/deploy/staging.json
config/deploy/production.json
compose.single-vm.yaml
infra/single-vm/Caddyfile
infra/single-vm/postgres-init.sh
```

The historical `infra/fly/` profiles remain reference material and are not the active target.

## Runtime and migration environment files

Start from the checked-in templates, then restrict the copies:

```bash
mkdir -p artifacts/deploy/staging
chmod 700 artifacts/deploy/staging
cp .env.single-vm.example artifacts/deploy/staging/runtime.env
cp .env.single-vm.migration.example artifacts/deploy/staging/migration.env
chmod 600 artifacts/deploy/staging/runtime.env artifacts/deploy/staging/migration.env
git check-ignore artifacts/deploy/staging/runtime.env artifacts/deploy/staging/migration.env
```

Replace every placeholder and make domain, billing, community-mode, regional, and feature-flag
values agree with the reviewed target. Use URL-encoded passwords inside connection URLs. For the
professional alpha, enable workspace features deliberately and prefer a workspace allowlist before
broad enablement. Do not copy staging secrets into production.

The runtime file is the complete reviewed Compose input for long-lived services. It includes the
restricted application database URL and infrastructure credentials required by their respective
containers, but must not contain `DATABASE_MIGRATION_URL`. The migration file contains only the
owner-level `DATABASE_MIGRATION_URL` (and optional migrations directory) and is transferred only for
the one-shot migration. Automation deletes the remote migration file after use. The server and web
containers never receive that owner URL.

Both files must be regular non-symlink files, ignored by Git, mode `0600`, and located under the
literal non-symlinked `artifacts/deploy/<environment>/` directory. Do not put secrets in target
JSON, manifests, command arguments, logs, receipts, or release artifacts.

## Promotion sequence

For staging:

1. Review and update `config/deploy/staging.json`, DNS, host-key pin, runtime values, and VM sizing.
2. Dispatch the protected **Staging images** workflow from `main`. It builds, scans, signs, and
   verifies both image digests. Download and review its complete manifest.
3. Run the deploy command first with `--dry-run`, then without it using the exact confirmation value.
4. The deployer verifies inputs and gates, uploads a private incoming release, validates Compose,
   pulls exact images, runs the candidate configuration check, verifies the embedded web build ID,
   starts data dependencies, runs the one-shot migration, and activates the full stack under a
   remote deployment lock.
5. The deployer verifies public API readiness and web/server build markers. If post-activation
   verification fails, it attempts to restore the previously active release. Retain the non-secret
   deployment receipt and failure evidence.
6. Run the [staging readiness workflow](staging-readiness.md), physical-device tests, restore drill,
   and target-region load/soak checks. A public health response is not capacity evidence.

Production repeats the process with an independently reviewed signed release manifest, all
[production readiness](production-readiness.md) gates complete, a verified off-host backup
reference, a rehearsed replacement-host restore, named responders, and a rollback decision owner.

## Failure and rollback policy

- Stop on signature, configuration, migration, pull, Compose readiness, public health, build-marker,
  backup, or release-gate failure. Do not weaken a check to make a deployment pass.
- Remote deploy and lifecycle actions share a lock. `--recover-lock` is only for a verified dead
  owner after the minimum stale interval; it is not a concurrency override.
- Database migrations are forward-only. Repair schema/data with a reviewed forward migration.
- A code rollback is safe only when the older images tolerate the current schema. Preserve
  expand/contract compatibility during every rollout window.
- Keep at least the current and previous approved release available on the VM, but treat the
  off-host database/media backup as the disaster-recovery source when the host is lost.
- After rollback or recovery, verify readiness, build markers, live-session behavior, reports,
  background work, email, media, and telemetry before closing the incident.

See the [upgrade runbook](upgrade.md), [backup and restore runbook](backup-restore.md), and
[incident-response runbook](incident-response.md) for the corresponding evidence and ownership.

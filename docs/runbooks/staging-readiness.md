# Single-VM staging readiness workflow

The API-triggered `Staging readiness` GitHub workflow separates three kinds of evidence. A GitHub-hosted
Ubuntu runner probes public TLS, dependency health, feature flags, security headers, and the
effective beta switches for one dedicated synthetic workspace. A self-hosted runner located near
the target VM runs fixed 50- and 250-client Round and Presentation profiles plus a bounded soak. A
separate GitHub-hosted job can rehearse signed Stripe webhook ordering. The jobs emit separate
redacted JSON artifacts; the public probe is not target-host capacity evidence, and the workflow
neither provisions a VM nor proves an actual provider-originated Stripe delivery.

The active staging target is one remote VM running `compose.single-vm.yaml`. Caddy, web,
API/realtime, PostgreSQL, Valkey, MinIO, and ClamAV share that host. The profile has no automatic
failover, high availability, or SLA. A passing workflow does not remove the requirements for
encrypted off-host backups, a clean replacement-VM restore drill, host patching, monitoring,
strict SSH host-key verification, or public-production approval.

The workflow accepts only the `staging-readiness` `repository_dispatch` event. GitHub therefore
loads the workflow definition from the repository's default branch instead of letting a caller
select a branch containing different self-hosted-runner or environment steps. The first unprotected
job also requires the checked-out revision to be the current `main` tip and validates the complete
client payload before any protected or self-hosted job can run.

Open a [single-VM staging evidence record](../evidence/single-vm-staging.md) before provisioning so
the candidate identity, host baseline, independent reviewer, service checks, and redacted artifact
references are captured consistently. A completed workflow without an accepted record does not
close the staging gate.

## GitHub environment

Create a protected `single-vm-staging` environment with required reviewers. Configure these
non-secret variables:

| Variable                                   | Example/purpose                                              |
| ------------------------------------------ | ------------------------------------------------------------ |
| `OPENROUND_API_URL`                        | Public HTTPS API/Socket.IO origin; same origin as web        |
| `OPENROUND_WEB_URL`                        | Public HTTPS application origin                              |
| `OPENROUND_MEDIA_URL`                      | Public HTTPS MinIO/S3 media origin                           |
| `OPENROUND_EXPECTED_BILLING`               | `disabled` for the active staging profile                    |
| `OPENROUND_EXPECTED_COMMUNITY_MODE`        | Reviewed staging value                                       |
| `OPENROUND_EXPECTED_SIGNUPS`               | Expected public signup switch                                |
| `OPENROUND_EXPECTED_SESSION_CREATION`      | `true` when running the game                                 |
| `OPENROUND_EXPECTED_MEDIA_UPLOADS`         | Expected scanner-backed media switch                         |
| `OPENROUND_EXPECTED_UX_BETA`               | Expected deployment-level UX beta switch                     |
| `OPENROUND_EXPECTED_RECOVERY_REHEARSAL`    | Expected Rehearsal kill switch                               |
| `OPENROUND_EXPECTED_PRACTICE_ASSIGNMENTS`  | Expected practice-assignment kill switch                     |
| `OPENROUND_EXPECTED_WORKSPACE_SHELL`       | Expected professional workspace shell switch                 |
| `OPENROUND_EXPECTED_BUILDER_V2`            | Expected interactive Round Builder v2 switch                 |
| `OPENROUND_EXPECTED_PRESENTATIONS`         | Expected Presentation artifact switch                        |
| `OPENROUND_EXPECTED_PRESENTATION_REALTIME` | Expected Presentation realtime workspace allowlist           |
| `OPENROUND_EXPECTED_GROUPS`                | Expected facilitator Groups switch                           |
| `OPENROUND_EXPECTED_DISCOVER`              | Expected approved-content Discover switch                    |
| `OPENROUND_EXPECTED_HOME_REGION`           | Workspace home-region value approved for this staging target |
| `OPENROUND_LOAD_RUNNER_REGION`             | Location of the VM and nearby isolated load generator        |

Configure these encrypted environment secrets:

| Secret                              | Scope                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `OPENROUND_CREATOR_COOKIE`          | Dedicated synthetic creator with capacity for 250 participants         |
| `OPENROUND_STRIPE_REHEARSAL_COOKIE` | Separate synthetic creator used only for an approved billing rehearsal |
| `OPENROUND_STRIPE_WEBHOOK_SECRET`   | Test endpoint secret; only present for the optional replay             |

Store only the cookie name/value pair, not copied browser headers. Create accounts through the
normal magic-link path, never use a human or customer account, rotate/revoke sessions after an
exercise, and restrict environment access. Select only an approved synthetic workspace before
capturing `OPENROUND_CREATOR_COOKIE`. The public probe uses that cookie to assert the synthetic
workspace's effective workspace-shell, Builder, Presentations, Presentation realtime, Groups, Discover, and other
workspace-resolved switches; it never writes account or workspace IDs to artifacts. The load
workflow deletes disposable Round sessions and archives temporary Round and Presentation content;
finished Presentation sessions remain subject to the configured retention policy.

The checked-in staging deployment keeps billing disabled. Do not set the expected value to
`stripe` merely to make the optional replay run. Billing evidence requires a separately reviewed
test configuration, isolated synthetic workspace, and a real provider test-mode checkout; locally
signed payloads alone do not complete that gate.

## Target-VM load runner

Register an ephemeral or tightly controlled GitHub Actions runner near the staging VM and give it
both the standard `self-hosted` label and the custom `single-vm-staging` label. Restrict it to this
repository, use an outbound-only network policy, keep its OS and Node tooling patched, and destroy
or reimage it after the exercise. The workflow deliberately leaves latency and soak queued when no
matching runner is online; do not relabel a distant runner to make the job start.

Set `OPENROUND_LOAD_RUNNER_REGION` to the documented VM/load-generator location. The workflow stores
that value, required labels, and non-secret runner metadata in `load-runner-provenance.json`. This
is a declared provenance record, not independent proof of physical location, so reconcile it
against the VM and runner inventory. Do not run unrelated jobs during measurement. Record provider,
location, machine class, network path, runner version, resource limits, and UTC availability window
in the private exercise record.

## Before running

1. Provision the staging VM from the approved baseline, but do not treat checked-in files as proof
   that it exists. Patch the OS, restrict inbound traffic to the approved SSH and HTTPS paths,
   configure the non-root deployment user, and record its CPU, memory, disk, and provider details.
2. Obtain the SSH host key through an independently verified provisioning channel and commit the
   reviewed key to the staging known-hosts file. Deployment must use `StrictHostKeyChecking=yes`;
   never accept a key interactively or use trust-on-first-use.
3. Point the application and media DNS names at the VM. Confirm Caddy has issued valid public
   certificates for both names, HTTP redirects to HTTPS, and certificate-expiry monitoring has an
   owner.
4. Create and protect the `single-vm-staging` GitHub environment before invoking the
   default-branch-only `staging-images` repository dispatch documented in the
   [deployment runbook](deployment.md#build-product-images). Do not use a ref-selectable workflow
   dispatch. Download the signed manifest only after its unprotected `main` preflight and protected
   build both pass, and after the workflow builds, scans, signs, and verifies both application-image
   digests with the allowlisted GitHub Actions identity. A workstation build or signature is not
   promotable. Run `node dist/config-check.js` against the reviewed environment and deploy with that
   manifest through the checked single-VM workflow. Keep owner-level migration credentials out of
   the long-lived server.
5. Confirm `docker compose ps`, the server `/health/ready` dependency checks, the web build marker,
   the media quarantine/scan path, and external TLS probes all pass for the exact build ID.
6. Configure the private metrics collector and every expected feature variable above. Omitted
   expectations fail the workflow; they are never treated as “do not check.”
7. Configure encrypted database and object backups to storage outside the VM. Verify checksums and
   alerting, then complete the current [clean replacement-VM restore drill](backup-restore.md) before
   treating staging as disaster-recovery evidence.
8. Confirm the synthetic creator has room for temporary published content, has an entitlement and
   deployment ceiling of at least 250 participants, belongs to both required Presentation
   allowlists, and that `/v1/workspaces` reports the configured expected home region. Raising this
   synthetic ceiling does not change the public Free 20 or Pro 100 promises.

### Provision the synthetic capacity workspace

The hosted runtime must set `OPENROUND_DEPLOYMENT_ENVIRONMENT=staging`, keep
`COMMUNITY_MODE=false` and `BILLING_MODE=disabled`, and set `MAX_SESSION_PARTICIPANTS=250` before
the capacity exercise. After the dedicated synthetic creator has signed in, copy its exact
workspace UUID from `/v1/workspaces` and run this one-shot command from the active staging release:

```bash
export OPENROUND_CAPACITY_WORKSPACE_ID="the-reviewed-synthetic-workspace-uuid"
export OPENROUND_CAPACITY_REQUEST_ID="the-approved-change-or-exercise-reference"
COMPOSE_PROJECT_NAME=openround-staging docker compose \
  --env-file .env \
  -f compose.single-vm.yaml \
  run --rm --no-deps \
  -e OPENROUND_STAGING_CAPACITY_PROVISIONING=enabled \
  server node dist/staging-capacity-provision.js \
  --workspace-id "$OPENROUND_CAPACITY_WORKSPACE_ID" \
  --request-id "$OPENROUND_CAPACITY_REQUEST_ID" \
  --confirm "provision-staging-capacity:${OPENROUND_CAPACITY_WORKSPACE_ID}:team-250"
```

The command has no HTTP route and inspects PostgreSQL before mutation. It requires membership in
the restricted `openround_runtime` role and rejects database principals that are superusers, bypass
RLS, can create roles or databases, can replicate, entered through `SET ROLE`, inherit any role
other than `openround_runtime`, or own (or can assume the owner of) the database or public-schema
objects. It never receives the migration-owner credential. It also refuses non-staging, Community,
billing-enabled, non-durable, unversioned, below-250, missing, or provider-linked targets, and any
initial state other than untouched Free. The plan change commits in one transaction with its matching
`operations.staging_capacity.provision` audit event. A successful retry is a no-op only when that
durable audit marker already exists for the same workspace; an unrelated pre-existing Team
workspace is rejected. Retain the redacted JSON result and approved request reference with the
staging evidence record; do not retain the creator cookie there.

Dispatch the first run with no soak:

```bash
gh api --method POST repos/riojung/openround/dispatches --input - <<'JSON'
{
  "event_type": "staging-readiness",
  "client_payload": {
    "run_stripe_replay": false,
    "soak_minutes": "0"
  }
}
JSON
```

The payload may contain only `run_stripe_replay` (a JSON boolean) and `soak_minutes` (the string
`"0"`, `"15"`, or `"60"`). Omitting either field retains the safe defaults shown above. Unknown
keys, stringified booleans, numeric soak values, and unsupported durations fail the workflow before
protected jobs run. The caller needs repository Contents write access; environment reviewers still
approve jobs that consume `single-vm-staging` secrets.

Confirm the `single-vm-staging-remote-probe-*` artifact from
the hosted runner and all four build-matched target-region artifacts from the target-VM runner:

- `target-region-round-50.json`
- `target-region-presentation-50.json`
- `target-region-round-250.json`
- `target-region-presentation-250.json`

After the fixed matrix passes, dispatch the same event with `"soak_minutes": "15"` and inspect every per-game artifact.
Use the 60-minute option for a release candidate only after confirming VM resources, disk
headroom, backup timing, and synthetic-account isolation. The workflow asserts correctness,
latency, reconnect, client-receipt, and report-reconciliation thresholds, cleans up disposable
content according to each harness's lifecycle, and writes a redacted soak summary. Complete the
[target-region evidence record](../evidence/target-region-load.md); one passing profile or a local
Compose run cannot substitute for the four-row target-region matrix.

The disposable local capacity workflow separately clears and restarts Valkey before the
250-participant Presentation process restart. Retain that coordination-loss artifact as a
correctness check; it does not substitute for any target-region latency row.

The local workflow enables `PRESENTATION_CONCURRENT_RESPONSE_WRITES` because its disposable stack
has no mixed-version window. On a target deployment, keep that switch off through the canary and
old-image overlap, then enable it only after every serving image reads the commit-visible aggregate
fence. Disable it before any prior-image rollback; follow the
[upgrade runbook](upgrade.md#presentation-concurrent-response-rollout).

Retain the workflow, VM inventory, runner inventory, and artifact URLs. The remote probe compares
both the API's `/health/live` marker and the web root's `X-OpenRound-Build-Id` header with the
candidate, and verifies the separate media origin over public TLS; the load probe independently
checks the API marker. Artifacts record the verified build ID, and `GITHUB_SHA` is not accepted as
unverified metadata. Retain the four load artifacts, runner provenance, soak summary, and VM
saturation evidence together. Run sustained load against the actual VM size and networking path:
local desktop results and a GitHub-hosted public probe are not capacity evidence for this target.

Set `"run_stripe_replay": true` only when an approved test configuration is active and no provider test
is manipulating the rehearsal workspace. The replay proves signature, duplicate, stale-event, and
cancellation handling using locally signed payloads and is stored separately as
`single-vm-staging-stripe-replay-*`; complete a real Stripe test-mode checkout, portal, delivery
retry, and cancellation in the [live billing rehearsal record](../evidence/live-billing-rehearsal.md)
before marking the billing gate complete.

If a run fails, preserve workflow logs and partial artifacts, open an issue linked to the candidate
commit, and do not update `docs/release-readiness.json` to complete. Even after a passing staging
run, public production remains blocked until every legal, accessibility, independent security,
capacity, off-host restore, monitoring, and operations gate is evidenced.

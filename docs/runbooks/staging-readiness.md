# Single-VM staging readiness workflow

The manual `Staging readiness` GitHub workflow separates three kinds of evidence. A GitHub-hosted
Ubuntu runner probes public TLS, dependency health, feature flags, security headers, and the
effective beta switches for one dedicated synthetic workspace. A self-hosted runner located near
the target VM runs the multi-client latency game and bounded soak. A separate GitHub-hosted job can
rehearse signed Stripe webhook ordering. The jobs emit separate redacted JSON artifacts; the public
probe is not target-host capacity evidence, and the workflow neither provisions a VM nor proves an
actual provider-originated Stripe delivery.

The active staging target is one remote VM running `compose.single-vm.yaml`. Caddy, web,
API/realtime, PostgreSQL, Valkey, MinIO, and ClamAV share that host. The profile has no automatic
failover, high availability, or SLA. A passing workflow does not remove the requirements for
encrypted off-host backups, a clean replacement-VM restore drill, host patching, monitoring,
strict SSH host-key verification, or public-production approval.

## GitHub environment

Create a protected `single-vm-staging` environment with required reviewers. Configure these
non-secret variables:

| Variable                                  | Example/purpose                                              |
| ----------------------------------------- | ------------------------------------------------------------ |
| `OPENROUND_API_URL`                       | Public HTTPS API/Socket.IO origin; same origin as web        |
| `OPENROUND_WEB_URL`                       | Public HTTPS application origin                              |
| `OPENROUND_MEDIA_URL`                     | Public HTTPS MinIO/S3 media origin                           |
| `OPENROUND_EXPECTED_BILLING`              | `disabled` for the active staging profile                    |
| `OPENROUND_EXPECTED_COMMUNITY_MODE`       | Reviewed staging value                                       |
| `OPENROUND_EXPECTED_SIGNUPS`              | Expected public signup switch                                |
| `OPENROUND_EXPECTED_SESSION_CREATION`     | `true` when running the game                                 |
| `OPENROUND_EXPECTED_MEDIA_UPLOADS`        | Expected scanner-backed media switch                         |
| `OPENROUND_EXPECTED_UX_BETA`              | Expected deployment-level UX beta switch                     |
| `OPENROUND_EXPECTED_RECOVERY_REHEARSAL`   | Expected Rehearsal kill switch                               |
| `OPENROUND_EXPECTED_PRACTICE_ASSIGNMENTS` | Expected practice-assignment kill switch                     |
| `OPENROUND_EXPECTED_WORKSPACE_SHELL`      | Expected professional workspace shell switch                 |
| `OPENROUND_EXPECTED_BUILDER_V2`           | Expected interactive Round Builder v2 switch                 |
| `OPENROUND_EXPECTED_PRESENTATIONS`        | Expected Presentation artifact switch                        |
| `OPENROUND_EXPECTED_GROUPS`               | Expected facilitator Groups switch                           |
| `OPENROUND_EXPECTED_DISCOVER`             | Expected approved-content Discover switch                    |
| `OPENROUND_EXPECTED_HOME_REGION`          | Workspace home-region value approved for this staging target |
| `OPENROUND_LOAD_RUNNER_REGION`            | Location of the VM and nearby isolated load generator        |

Configure these encrypted environment secrets:

| Secret                              | Scope                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `OPENROUND_CREATOR_COOKIE`          | Dedicated synthetic creator with capacity for the selected client count |
| `OPENROUND_STRIPE_REHEARSAL_COOKIE` | Separate synthetic creator used only for an approved billing rehearsal  |
| `OPENROUND_STRIPE_WEBHOOK_SECRET`   | Test endpoint secret; only present for the optional replay              |

Store only the cookie name/value pair, not copied browser headers. Create accounts through the
normal magic-link path, never use a human or customer account, rotate/revoke sessions after an
exercise, and restrict environment access. Select only an approved synthetic workspace before
capturing `OPENROUND_CREATOR_COOKIE`. The public probe uses that cookie to assert the synthetic
workspace's effective workspace-shell, Builder, Presentations, Groups, Discover, and other
workspace-resolved switches; it never writes account or workspace IDs to artifacts. The load
workflow deletes its session and archives its temporary Round.

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
4. Dispatch the protected **Staging images** workflow from `main` for the exact candidate commit.
   Download its signed manifest only after the workflow builds, scans, signs, and verifies both
   application-image digests with the allowlisted GitHub Actions identity. A workstation build or
   signature is not promotable. Run `node dist/config-check.js` against the reviewed environment
   and deploy with that manifest through the checked single-VM workflow. Keep owner-level migration
   credentials out of the long-lived server.
5. Confirm `docker compose ps`, the server `/health/ready` dependency checks, the web build marker,
   the media quarantine/scan path, and external TLS probes all pass for the exact build ID.
6. Configure the private metrics collector and every expected feature variable above. Omitted
   expectations fail the workflow; they are never treated as “do not check.”
7. Configure encrypted database and object backups to storage outside the VM. Verify checksums and
   alerting, then complete the current [clean replacement-VM restore drill](backup-restore.md) before
   treating staging as disaster-recovery evidence.
8. Confirm the synthetic creator has room for a temporary published Round, belongs to the intended
   allowlisted workspace, and that `/v1/workspaces` reports the configured expected home region.

Run the workflow first with 20 clients and no soak. Confirm both the
`single-vm-staging-remote-probe-*` artifact from the hosted runner and the
`single-vm-staging-load-*` artifact from the target-VM runner. After that passes, run 100 clients
with the 15-minute soak and inspect every per-game artifact. Use the 60-minute option for a release
candidate only after confirming VM resources, disk headroom, backup timing, and synthetic-account
isolation. The workflow asserts correctness and latency thresholds, archives its temporary Round,
deletes its session, and writes a redacted soak summary.

Retain the workflow, VM inventory, runner inventory, and artifact URLs. The remote probe compares
both the API's `/health/live` marker and the web root's `X-OpenRound-Build-Id` header with the
candidate, and verifies the separate media origin over public TLS; the load probe independently
checks the API marker. Artifacts record the verified build ID, and `GITHUB_SHA` is not accepted as
unverified metadata. Run sustained load against the actual VM size and networking path: local
desktop results and a GitHub-hosted public probe are not capacity evidence for this target.

Enable the Stripe replay only when an approved test configuration is active and no provider test
is manipulating the rehearsal workspace. The replay proves signature, duplicate, stale-event, and
cancellation handling using locally signed payloads and is stored separately as
`single-vm-staging-stripe-replay-*`; complete a real Stripe test-mode checkout, portal, delivery
retry, and cancellation before marking the billing gate complete.

If a run fails, preserve workflow logs and partial artifacts, open an issue linked to the candidate
commit, and do not update `docs/release-readiness.json` to complete. Even after a passing staging
run, public production remains blocked until every legal, accessibility, independent security,
capacity, off-host restore, monitoring, and operations gate is evidenced.

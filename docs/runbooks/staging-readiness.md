# Canadian staging readiness workflow

The manual `Staging readiness` GitHub workflow separates three kinds of evidence. A GitHub-hosted
Ubuntu runner probes public TLS, dependency health, feature flags, security headers, and the
effective beta switches for one dedicated synthetic workspace. A self-hosted runner physically
located in the target Canadian region runs the multi-client latency game and bounded soak. A
separate GitHub-hosted job can rehearse signed Stripe webhook ordering. The jobs emit separate
redacted JSON artifacts; the hosted probe is not target-region latency evidence, and the workflow
does not provision infrastructure or prove an actual provider-originated Stripe delivery.

## GitHub environment

Create a protected `canada-staging` environment with required reviewers. Configure these
non-secret variables:

| Variable                                  | Example/purpose                                    |
| ----------------------------------------- | -------------------------------------------------- |
| `OPENROUND_API_URL`                       | Public HTTPS API/Socket.IO origin                  |
| `OPENROUND_WEB_URL`                       | Public HTTPS web origin and allowed browser origin |
| `OPENROUND_EXPECTED_BILLING`              | `stripe` for hosted staging                        |
| `OPENROUND_EXPECTED_COMMUNITY_MODE`       | `false`                                            |
| `OPENROUND_EXPECTED_SIGNUPS`              | Expected public signup switch                      |
| `OPENROUND_EXPECTED_SESSION_CREATION`     | `true` when running the game                       |
| `OPENROUND_EXPECTED_MEDIA_UPLOADS`        | Expected scanner-backed media switch               |
| `OPENROUND_EXPECTED_UX_BETA`              | Expected deployment-level UX beta switch           |
| `OPENROUND_EXPECTED_RECOVERY_REHEARSAL`   | Expected Rehearsal kill switch                     |
| `OPENROUND_EXPECTED_PRACTICE_ASSIGNMENTS` | Expected practice-assignment kill switch           |
| `OPENROUND_LOAD_RUNNER_REGION`            | Provider region of the labeled load generator      |

Configure these encrypted environment secrets:

| Secret                              | Scope                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `OPENROUND_CREATOR_COOKIE`          | Dedicated synthetic creator; Pro is required for the 100-client option   |
| `OPENROUND_STRIPE_REHEARSAL_COOKIE` | A separate, dedicated free-plan creator used only for entitlement replay |
| `OPENROUND_STRIPE_WEBHOOK_SECRET`   | Staging endpoint signing secret; required only for the optional replay   |

Store only the cookie name/value pair, not copied browser headers. Create both accounts through the
normal magic-link path, never use a human or customer account, rotate/revoke the sessions after an
exercise, and restrict environment access. Select the approved, allowlisted pilot workspace before
capturing `OPENROUND_CREATOR_COOKIE`; it must have `ca-central-1` as its immutable home region. The
public probe uses that cookie only to assert the workspace-resolved UX beta, Recovery Rehearsal,
and practice-assignment switches and never writes its account or workspace IDs to artifacts. The
load workflow deletes its session and archives its quiz. The Stripe rehearsal intentionally moves
its dedicated workspace from Free to Pro and back to Free; it refuses to start if that workspace
is already Pro.

## Canada staging runner

Register an ephemeral or tightly controlled GitHub Actions runner in the same Canadian region as
the staging deployment and give it both the standard `self-hosted` label and the custom
`canada-staging` label. Restrict it to this repository, use an outbound-only network policy, keep
the runner image and Node tooling patched, and destroy or reimage it after the exercise. The
workflow deliberately leaves the latency and soak job queued when no matching runner is online;
do not relabel a runner outside Canada to make the job start.

The target-region runner receives the dedicated synthetic creator cookie through the protected
GitHub environment. Set `OPENROUND_LOAD_RUNNER_REGION` to its provider region; the workflow stores
that value, the required labels, and non-secret runner metadata in
`load-runner-provenance.json`. This is a declared provenance record, not independent proof of
physical location, so reconcile it against the provider inventory. Do not run unrelated jobs on
the runner during measurement. Record its provider, region, machine class, network path, runner
version, and UTC availability window in the private exercise record.

## Before running

1. Check out the exact commit from which the workflow will be dispatched and build both server and
   web images with `--build-arg OPENROUND_BUILD_ID=$(git rev-parse HEAD)`. Deploy those immutable
   image digests and run `node dist/config-check.js` in the server image with the production
   environment. Keep the JSON result; it contains the build marker, modes, and public URLs but no
   credentials or workspace IDs. Confirm `buildId` is the full candidate commit and
   `featureFlags.uxBeta`,
   `featureFlags.recoveryRehearsal`, and `featureFlags.practiceAssignments` match the intended
   rollout, and that `uxBetaWorkspaceAllowlistSize` matches the approved workspace count. The
   count is bounded by configuration validation and is the only allowlist detail retained.
2. Apply migrations with the owner-only one-shot job, then deploy the non-owner runtime.
3. Confirm `/health/ready` checks PostgreSQL and Redis and returns 200.
4. Configure the private metrics collector and every expected feature variable above. Omitted
   expectations fail the workflow; they are never treated as “do not check.”
5. Confirm the synthetic creator has room for a temporary published quiz, is on the intended
   allowlisted workspace, and that `/v1/workspaces` reports `ca-central-1` for that workspace.

Run the workflow first with 20 clients and no soak. Confirm both the
`canada-staging-remote-probe-*` artifact from the hosted runner and the
`canada-staging-load-*` artifact from the labeled Canadian runner. After that passes, run 100
clients with the 15-minute soak and inspect every per-game artifact. Use the 60-minute option for
the release candidate after confirming the provider quota and synthetic account are isolated; the
workflow paces games by five seconds, asserts every game's correctness and latency thresholds,
archives its temporary quiz, deletes its session, and writes a redacted soak summary. Retain the
workflow, runner inventory, and artifact URLs. The remote probe compares both the API's
`/health/live` marker and the web root's `X-OpenRound-Build-Id` header with the candidate; the load
probe independently checks the API marker. Artifacts record the verified build ID, and
`GITHUB_SHA` is not accepted merely as unverified metadata. A repeated-game soak does not replace
managed Redis failover, rolling deployment, or provider restore exercises.

Enable the Stripe replay only when no provider test is manipulating the rehearsal workspace. The
replay proves signature, duplicate, stale-event, and cancellation handling using locally signed
payloads and is stored separately as `canada-staging-stripe-replay-*`; complete a real Stripe
test-mode checkout, portal, delivery retry, and cancellation before marking the billing gate
complete.

If a run fails, preserve the workflow logs and any partial artifact, open an issue linked to the
candidate commit, and do not update `docs/release-readiness.json` to complete.

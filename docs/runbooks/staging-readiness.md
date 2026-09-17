# Canadian staging readiness workflow

The manual `Staging readiness` GitHub workflow probes the deployed Canadian environment, runs a
complete multi-client game from the runner, can repeat complete games for a bounded soak, and
optionally rehearses signed Stripe webhook ordering. It emits redacted JSON artifacts; it does not
provision infrastructure or prove an actual provider-originated Stripe delivery.

## GitHub environment

Create a protected `canada-staging` environment with required reviewers. Configure these
non-secret variables:

| Variable                              | Example/purpose                                    |
| ------------------------------------- | -------------------------------------------------- |
| `OPENROUND_API_URL`                   | Public HTTPS API/Socket.IO origin                  |
| `OPENROUND_WEB_URL`                   | Public HTTPS web origin and allowed browser origin |
| `OPENROUND_EXPECTED_BILLING`          | `stripe` for hosted staging                        |
| `OPENROUND_EXPECTED_COMMUNITY_MODE`   | `false`                                            |
| `OPENROUND_EXPECTED_SIGNUPS`          | Expected public signup switch                      |
| `OPENROUND_EXPECTED_SESSION_CREATION` | `true` when running the game                       |
| `OPENROUND_EXPECTED_MEDIA_UPLOADS`    | Expected scanner-backed media switch               |

Configure these encrypted environment secrets:

| Secret                              | Scope                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `OPENROUND_CREATOR_COOKIE`          | Dedicated synthetic creator; Pro is required for the 100-client option   |
| `OPENROUND_STRIPE_REHEARSAL_COOKIE` | A separate, dedicated free-plan creator used only for entitlement replay |
| `OPENROUND_STRIPE_WEBHOOK_SECRET`   | Staging endpoint signing secret; required only for the optional replay   |

Store only the cookie name/value pair, not copied browser headers. Create both accounts through the
normal magic-link path, never use a human or customer account, rotate/revoke the sessions after an
exercise, and restrict environment access. The load workflow deletes its session and archives its
quiz. The Stripe rehearsal intentionally moves its dedicated workspace from Free to Pro and back
to Free; it refuses to start if that workspace is already Pro.

## Before running

1. Deploy one immutable image digest and run `node dist/config-check.js` in the server image with
   the production environment. Keep the JSON result; it contains modes and public URLs but no
   credentials.
2. Apply migrations with the owner-only one-shot job, then deploy the non-owner runtime.
3. Confirm `/health/ready` checks PostgreSQL and Redis and returns 200.
4. Configure the private metrics collector and expected feature flags.
5. Confirm the synthetic creator has room for a temporary published quiz.

Run the workflow first with 20 clients and no soak. After that passes, run 100 clients with the
15-minute soak and inspect every per-game artifact. Use the 60-minute option for the release
candidate after confirming the provider quota and synthetic account are isolated; the workflow
paces games by five seconds, asserts every game's correctness and latency thresholds, archives its
temporary quiz, deletes its session, and writes a redacted soak summary. Retain the workflow and
artifact URLs. A repeated-game soak does not replace managed Redis failover, rolling deployment,
or provider restore exercises.

Enable the Stripe replay only when no provider test is manipulating the rehearsal workspace. The
replay proves signature, duplicate, stale-event, and cancellation handling using locally signed
payloads; complete a real Stripe test-mode checkout, portal, delivery retry, and cancellation
before marking the billing gate complete.

If a run fails, preserve the workflow logs and any partial artifact, open an issue linked to the
candidate commit, and do not update `docs/release-readiness.json` to complete.

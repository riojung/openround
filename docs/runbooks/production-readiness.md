# Production readiness checklist

## Product and legal

- Final name, domain, interface, scoring explanation, comparison claims, and asset register reviewed independently.
- Canadian terms, privacy notice, cookie notice, acceptable use, content policy, DPA, subprocessors, retention, deletion, access, incident, and law-enforcement procedures approved.
- Education onboarding uses anonymous guest mode, private results, friendly aliases, and accuracy scoring by default.
- US school self-service remains disabled until US counsel approves COPPA, FERPA, contracts, and notices.

## Platform

- Production secrets differ from development and are stored in a secret manager.
- Production startup passes the fail-fast configuration checks: public web, API, and media URLs
  use HTTPS; creator cookies cannot be explicitly insecure; and SMTP is configured before the
  sign-up ceiling is enabled. Keep `FEATURE_SIGNUPS=false` until email delivery is verified. The
  `ALLOW_INSECURE_LOCAL_HTTP` escape hatch is restricted to non-billing community deployments on
  loopback or private-network URLs and must never be enabled in hosted production. Keep
  `AUTH_DEBUG_MAGIC_LINKS=false`; exposing a sign-in token in an API response is only for explicit,
  loopback-bound local testing.
- Build the exact candidate image and execute `node dist/config-check.js` with the deployment's
  server environment before migration or promotion. Retain its non-secret JSON summary with the
  release evidence. A zero exit code proves schema and cross-field validation; it does not prove
  that external credentials authenticate.
- Production metrics require a bearer token at startup. Keep `METRICS_ENABLED=false` until a
  private authenticated collector is ready; do not expose the route through the public ingress.
- Application traffic uses a non-owner PostgreSQL role; only the migration job receives the
  owner-level `DATABASE_MIGRATION_URL`, and the production-like forced-RLS test passes.
- Database and storage are in `ca-central-1`; realtime and Redis are in Toronto.
- Database backups, point-in-time recovery, and a restore exercise are current.
- Production has Redis available for both the Streams transport adapter and owner-fenced
  per-session mutation leases; PostgreSQL version compare-and-swap remains the durable fence.
- Realtime starts with one always-on process. Before enabling a second, sticky routing is verified
  for every enabled transport and target-region rolling restart, process-kill, Redis-failover, and
  lease-expiry tests pass while lease/conflict metrics remain within rehearsed thresholds.
- TLS, origin allowlist, rate limits, CSP, private storage, ClamAV signature freshness and failure
  behaviour, email authentication, Stripe signatures, administrator controls, and log redaction
  are verified.
- `/metrics` is reachable only from the monitoring network, an OTLP collector is configured when
  tracing is enabled, alert thresholds have owners, and signup/session/media kill switches are
  rehearsed without interrupting an active game.
- Status page, security contact, privacy contact, support rota, incident commander, and escalation contacts are live.

## Release evidence

- `pnpm check`, `pnpm readiness:check`, alert routing, and collector configuration validation pass
  from a clean checkout.
- `pnpm audit --audit-level low` passes; `THIRD_PARTY_NOTICES.md` matches
  `pnpm licenses:report`; release SBOMs, provenance, signatures, and container scans are retained.
- Database migration succeeds on a production-like copy and has a forward-repair plan.
- Chromium, WebKit, Firefox, mobile Safari, and mobile Chrome critical flows pass.
- Keyboard, screen-reader, 200% zoom, contrast, reduced-motion, and extended-time tests pass.
- A 100-player session is supported; 250-player single-session and 1,000-player multi-session load suites pass without answer loss or duplicate scores.
- Join p95 is below 500 ms; answer acknowledgement p95 below 250 ms and p99 below 600 ms;
  acknowledged `question.open` client receipt p95 below 500 ms with a rehearsed timeout-rate
  alert; recovery below two seconds; report below 60 seconds.
- Backup restore, Redis loss, realtime restart, Stripe replay, and failed-email exercises pass.
- The shared-store two-writer integration suite and the two-container cross-process/process-loss
  smoke pass against the release image.
- External security review has no unresolved critical or high finding.

For a disposable local production-path sample, start the full media Compose profile and run
`CLIENTS=100 ASSERT_PERFORMANCE=true RESTART_SERVER=true pnpm load:compose`. Retain the JSON output
with host hardware, container resource limits, build identifier, and date. Repeat from a load
generator in the target region before using the result as release evidence.

To exercise the local multi-writer path against one release image:

```bash
docker compose -f compose.yaml -f compose.test.yaml build server
docker compose -f compose.yaml -f compose.test.yaml -f compose.multiwriter.yaml up -d --no-build --wait server server-secondary mailpit
pnpm smoke:multi-process
```

This proves application-level ownership, database fencing, adapter delivery, and takeover with
direct WebSockets. It does not prove the hosted load balancer's affinity behaviour or managed Redis
failover.

For the local Phase 6 stress profiles, add `compose.test.yaml`, run the single-session harness with
`CLIENTS=250 JOIN_BATCH_SIZE=25 ASSERT_PERFORMANCE=true RESTART_SERVER=true`, then run the
`load`-profile container for ten staggered 100-client lobbies and a synchronized 1,000-client game
burst. Do not translate either local result into a hosted SLO without a target-region rerun.

See [observability and operational controls](observability.md) for metric, trace, alert, and
kill-switch guidance. Use the [Canadian staging workflow](staging-readiness.md) for the remote
probe and target-region game, [evidence templates](../evidence/README.md) for non-code gates, and
`pnpm readiness:require:beta` before creating a beta tag.

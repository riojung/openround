# OpenRound Comprehension Recovery

OpenRound is an independent, server-authoritative comprehension recovery system for higher
education and workplace learning. Facilitators ask, diagnose, intervene, recheck, and review
carefully bounded evidence while participants join without accounts.

The product uses an original interaction and visual system. It does not include or copy Kahoot! code, content, branding, layouts, sounds, scoring, or private interfaces.

## Current implementation

The repository contains a runnable differentiated product slice:

- Email magic-link creator access with secure, revocable sessions
- Tenant-scoped checkpoint-set library, six response types, confidence, concepts, linked rechecks,
  folders/tags, portability, autosave, duplication, archive, and immutable publish versions
- Seven-digit multi-device guest join, copyable direct links, host/presenter QR, LAN/public address
  selection, friendly aliases, capacity enforcement, lobby, presenter view, and reconnect credentials
- Server-authoritative Recovery Loop with interventions, linked rechecks/revotes, deterministic
  explained insights, durable canonical responses/confidence, pause/resume, scoring, and reconnect
- Six accessible versioned Round Experience presets with creator preview, one-session host
  override, frozen semantic tokens, workspace-brand layering, and device-local contrast, motion,
  mute, and original sound-cue preferences
- Audience Pulse with private host/cohost participant signals, five-person public aggregation,
  live activity statistics, and a separately sequenced reconnect path; host-enabled room chat with
  one-level replies, reactions, pinning, immutable private aliases, distributed limits, reporting,
  mute/ban/kick controls, and a transactional outbox
- Versioned asynchronous evidence reports, moderated realtime Q&A, collaboration roles, scoped
  cohost/presenter credentials, secure presenter embed, aggregate interaction evidence, and an
  authorized interaction transcript
- Accountless self-paced follow-up with generic/personal links, time-flex mode, and private 1.5×/2×
  accommodation passes
- Disabled-by-default source-grounded authoring from pasted text or private PDF/DOCX/PPTX, with
  bounded isolated extraction, citations, draft-only human review, and BYO provider support
- Contract-gated institution foundation with explicit generic OIDC creator linking, LTI 1.3
  instructor launch and Deep Linking, operator-managed platform registrations, immutable workspace
  home-region visibility, and owner audit export; learner identity, NRPS/AGS, managed SAML/SCIM,
  K–12, and certification remain gated
- PostgreSQL durability and compare-and-swap fencing, Redis owner-fenced session-code reservations and per-session mutation leases, batched Streams snapshots/replay and Socket.IO coordination, plan-stamped 30/365-day reports, server-enforced CSV entitlements, full account export/deletion, audit records, and idempotent Stripe entitlement hooks
- Private signed image uploads, quarantine, MIME-signature and size checks, ClamAV scanning, clean-object promotion, alt text, and authorized signed delivery
- Internal Prometheus metrics including browser event-receipt latency/timeouts, a provisioned
  Grafana dashboard, 14 semantically tested alert rules, tested Alertmanager severity routing, a
  validated OpenTelemetry collector profile, request/trace correlation, optional OTLP tracing,
  and audited database-backed signup/session/media/experience/Pulse/chat kill switches
- Dependency-aware readiness checks, fail-fast non-secret deployment preflight, per-request nonce
  Content Security Policy, HSTS, CodeQL/dependency review workflows, and a protected manual
  Canadian-staging correctness/load/billing evidence workflow
- Responsive participant, host, presenter, creator, pricing, privacy, terms, and status surfaces
- Community Compose stack, free-pilot guidance, Canadian Fly.io profiles, CI/security workflows, tests, and operations runbooks

Legal text, trademark clearance, external penetration testing, school agreements, production provider accounts, support staffing, and real design-partner evidence remain release gates rather than claims made by the software.

## Documentation

| Guide                                                                        | Use it for                                                       |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [Quick start](docs/quick-start.md)                                           | Start the complete local stack and run a first quiz              |
| [User guide](docs/user-guide.md)                                             | Create, publish, host, join, report, export, and delete          |
| [Product and experience design](docs/design.md)                              | Product goals, role journeys, states, content, and accessibility |
| [Competitive strategy and roadmap](docs/competitive-strategy-and-roadmap.md) | Market comparison, differentiation, and post-P0 phases           |
| [Architecture and protocol](docs/architecture.md)                            | Components, data flows, correctness, security, and scale gates   |
| [Institution integrations](docs/institution-integrations.md)                 | Configure and validate creator OIDC, LTI, audit, and pilot gates |
| [Documentation index](docs/README.md)                                        | API, status, privacy, release, and operations references         |

## Quick start with Docker

Requirements: Docker with Compose. The core profile starts without untrusted image uploads:

```bash
docker compose up --build -d
docker compose ps
curl -fsS http://localhost:8080/health/ready
```

To enable the production-equivalent image quarantine and ClamAV path, use the media overlay and
allow at least 4 GB of memory. The first start can take longer while ClamAV initializes its
signature database.

```bash
docker compose -f compose.yaml -f compose.media.yaml up --build -d
```

Open:

- Product: <http://localhost:8080>
- Captured development email: <http://localhost:8025>

Sign in with any development email, open its message in Mailpit, create a checkpoint set, choose a
Round Experience, preview it in the participant layout, and publish it. Select **Host**, review the
per-session experience and interaction settings, then create the lobby. Any number of participant
devices up to the configured limit share the session's seven-digit code. Host and presenter views
also provide a prefilled direct link and QR code. Room chat starts disabled; enable it deliberately
from the host Audience Pulse panel when needed.

For phones or other computers, open the product through the host computer's LAN address instead
of `localhost`, or enter that address under **Change join address** in the host screen. See
[cross-device joining](docs/quick-start.md#join-from-phones-tablets-and-other-computers) for LAN,
firewall, media, and public HTTPS instructions.

The complete startup, first-round, shutdown, reset, and troubleshooting instructions are in the
[quick start](docs/quick-start.md). The [user guide](docs/user-guide.md) explains every creator,
host, presenter, participant, report, and account workflow.

Both Compose profiles use community mode: billing is disabled, application entitlements are not
paywalled, and the P0 support ceiling remains 100 participants per session. The base profile
reports media uploads as disabled because no malware scanner is attached. Replace every example
secret before exposing either stack to a network. Community reports default to 365-day retention;
set `COMMUNITY_REPORT_RETENTION_DAYS` to the operator-approved duration.

Compose applies migrations with the database owner and runs the application through the
non-owner `openround_app` role, so forced row-level-security policies are exercised on the
normal request path.

## Local development

Node.js 22 or newer and pnpm 10 are required. The fastest host-native loop uses the deliberately
non-durable in-memory repositories, so data disappears when the server stops and media upload is
disabled:

```bash
corepack enable
pnpm install
env \
  NODE_ENV=development \
  ALLOW_IN_MEMORY=true \
  COMMUNITY_MODE=true \
  WEB_ORIGIN=http://localhost:3000 \
  PUBLIC_API_URL=http://localhost:4000 \
  NEXT_PUBLIC_API_URL=http://localhost:4000 \
  FEATURE_MEDIA_UPLOADS=false \
  RUN_MIGRATIONS=false \
  pnpm exec turbo run dev --env-mode=loose
```

Open <http://localhost:3000>. The `.env.example` host names target the Compose network and should
not be copied unchanged into a host-native process. See the [quick start](docs/quick-start.md#optional-native-developer-mode)
for details; use the complete Compose profile above when testing durable PostgreSQL/Valkey behavior.

## Quality commands

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm audit --audit-level low
pnpm licenses:report
pnpm smoke:compose
pnpm test:multi-writer
pnpm smoke:multi-process
pnpm smoke:observability
pnpm smoke:restore
pnpm test:e2e:compose
pnpm smoke:tracing
pnpm readiness:check
pnpm test:alert-routing
pnpm test:collector-config
```

`pnpm check` runs the complete local gate. The API integration test exercises creator sign-in, authoring, immutable publishing, hosting, guest join, idempotent answering, finishing, and report reconciliation.

`pnpm smoke:compose` runs the same critical journey through Caddy, PostgreSQL, Valkey, and Mailpit,
including runtime kill-switch pause/resume. With the media overlay it also verifies browser CORS,
ClamAV, private delivery, export, blob deletion, and cache invalidation.
`pnpm test:e2e:compose` exercises that image workflow in real Chromium. `pnpm smoke:restore`
restores a logical PostgreSQL backup into an isolated database, compares full-table fingerprints,
and verifies a synthetic MinIO object round trip before cleaning up. `pnpm smoke:tracing` builds
the server and proves OTLP export against a temporary collector. The PostgreSQL RLS test is
available as `pnpm --filter @openround/db test:postgres` when `TEST_DATABASE_ADMIN_URL` and the
non-owner `TEST_DATABASE_URL` are set.

`pnpm test:multi-writer` uses those same PostgreSQL variables plus `TEST_REDIS_URL` to run two
independent service instances against shared durable and coordination stores. It covers shared
code reservation, concurrent joins and answers, owner-fenced lease expiry, host-command conflicts,
duplicate retries, replay, report reconciliation, and takeover after one writer shuts down.

`CLIENTS=100 ASSERT_PERFORMANCE=true pnpm load:compose` bootstraps a disposable creator, quiz,
session, and clients against the running Compose stack. It checks full-game answer durability,
concurrent idempotency, answer-key isolation, reconnect replay, report reconciliation, and the P0
latency thresholds, then deletes the account. Add `RESTART_SERVER=true` to restart the API/realtime
container after answer acknowledgement and verify durable recovery plus host-command and answer
retry idempotency. `SESSION_CODE=1234567 CLIENTS=100 pnpm load:socket` remains available as a
lightweight join-only sample against a prepared room. Local results are not production capacity
evidence.

For an already deployed environment, the manual `Staging readiness` GitHub workflow validates TLS,
dependency health, public feature flags, protected metrics, security headers, and a complete
20- or 100-client game. It can separately replay signed, duplicate, stale, invalid, and
cancellation billing events against a dedicated staging workspace. See the
[staging runbook](docs/runbooks/staging-readiness.md); locally signed events do not replace a real
Stripe test-mode checkout and delivery exercise.

The test-only `compose.test.yaml` overlay raises the session ceiling to 250 without changing the
normal community profile. Run the Phase 6 stress profiles with:

```bash
CLIENTS=250 JOIN_BATCH_SIZE=25 ASSERT_PERFORMANCE=true RESTART_SERVER=true pnpm load:compose
docker compose --profile load -f compose.yaml -f compose.media.yaml -f compose.test.yaml run --rm load
```

The second command runs ten staggered 100-client admissions inside the Compose network, holds all
1,000 sockets at a common barrier, then executes the games concurrently and reconciles all ten
reports. The in-network generator avoids measuring desktop VM port-forward limits as server
capacity.

To exercise two actual API/realtime containers locally, first build the server image, then start
the multi-writer overlay and run its process-loss smoke:

```bash
docker compose -f compose.yaml -f compose.test.yaml build server
docker compose -f compose.yaml -f compose.test.yaml -f compose.multiwriter.yaml up -d --no-build --wait server server-secondary mailpit
pnpm smoke:multi-process
```

The smoke splits clients across both writers, verifies cross-process broadcasts and database
fencing, stops the primary container, and completes the game through the secondary. Direct
WebSocket transport is used locally; a hosted load balancer must also prove sticky routing for any
enabled polling transport before multiple realtime processes are promoted.

To start the optional local Prometheus and Grafana profile with versioned alert rules and a
provisioned operations dashboard:

```bash
docker compose -f compose.yaml -f compose.media.yaml -f compose.observability.yaml \
  --profile observability up -d
pnpm smoke:observability
```

Prometheus is bound to <http://127.0.0.1:9090> and Grafana to
<http://127.0.0.1:3001>. Change the documented local Grafana password before sharing access. This
profile validates dashboards and rule evaluation; it does not configure a production paging
destination.

## Architecture

```text
Browser surfaces
  ├── creator, host, presenter, participant
  └── Next.js web container
            │ HTTPS and Socket.IO
            ▼
Fastify and Socket.IO server
  ├── runtime-validated REST and event contracts
  ├── pure game transition engine
  ├── distributed per-session ownership and database version fencing
  ├── authentication, billing, reports, retention
  └── role-filtered snapshots
            │
            ├── PostgreSQL: durable product and answer records
            ├── Valkey or Redis: active snapshots, bounded event streams, Socket.IO adapter
            ├── S3-compatible storage: private quarantine and clean question media
            ├── Prometheus/OTLP: internal metrics and optional distributed traces
            ├── SMTP: one-time sign-in links
            └── Stripe: hosted production entitlements only
```

See the [documentation index](docs/README.md), [architecture and protocol](docs/architecture.md), [API reference](docs/api.md), the
[phase delivery status](docs/implementation-status.md), and the
[production readiness checklist](docs/runbooks/production-readiness.md). The
[machine-validated readiness ledger](docs/release-readiness.json) is intentionally still blocked
on provider, human-review, legal, and beta evidence.

## Deployment profiles

- **Community/self-hosted:** `compose.yaml`, Apache-2.0, billing disabled, operator-managed infrastructure and support.
- **Free pilot:** [Cloud Run scale-to-zero guidance](infra/cloudrun/README.md) plus managed free
  tiers. No SLA; quota overruns can cost money; no school production data.
- **Canadian hosted production:** [Fly deployment profile](infra/fly/README.md) with separate web
  and always-on realtime containers in Toronto, PostgreSQL/object storage in `ca-central-1`, and
  region-local managed Redis.
- **US expansion:** an isolated US regional stack. Existing Canadian workspaces are never moved automatically.

## Security and privacy posture

- Correct answers are omitted from open-question payloads.
- The server clock alone decides deadlines and scores.
- Participant and host credentials are opaque, random, hashed at rest, session-bound, and excluded from logs.
- Participant identity is session-scoped. No child account or cross-session learner profile exists.
- Database uniqueness constraints enforce one answer per participant and round and one effect per idempotency key.
- Hosted Free retention defaults to 30 days; Pro defaults to 365 days. Early deletion is supported.
- Hosted Pro/Team and community workspaces can save one contrast-validated live-session theme;
  sessions freeze the theme at creation so later edits do not change an active room.
- Browser origins, event sizes, event schemas, request rates, and role authorization are enforced at the boundary.
- Question images remain private, are unavailable while quarantined, and require malware and
  file-signature validation before creator or session-scoped signed access.

Review [SECURITY.md](SECURITY.md) before deployment. The included privacy and terms pages are explicit drafts and must not be published unchanged.

## License

Source and original bundled assets are available under the [Apache License 2.0](LICENSE).
Third-party packages and container images retain their own licenses. Review the
[third-party notices](THIRD_PARTY_NOTICES.md), generated SBOM, and
[asset register](docs/asset-register.md) for every public release.

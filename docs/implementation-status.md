# Phased delivery status

This repository implements the technical P0 baseline from the phased plan. It does not turn
calendar-, legal-, research-, or production-observation gates into software claims. `OpenRound`
is a working identity pending independent name and trademark review.

| Phase                               | Delivered in this repository                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Remaining implementation or evidence before the exit gate can be claimed                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — risk and definition             | Clean-room rules, original product system, protocol invariants, deterministic scoring tests, and a configurable Socket.IO load harness                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Eight interviews, six recruited design partners, and documented findings                                                                       |
| 1 — foundation                      | TypeScript workspace, Compose, CI, magic-link authentication, PostgreSQL migrations plus a one-shot owner-only image command, forced RLS, non-owner runtime role, structured logs, health checks, validated configuration with fail-fast production transport/email/metrics safeguards, Prometheus metrics including browser event-receipt latency/timeouts, optional OTLP tracing, request correlation, audited database-backed runtime kill switches bounded by startup ceilings, and a provisioned local Prometheus/Grafana profile with 14 versioned, semantically tested alert rules | Production identity/provider configuration, deployed staging, production collectors, alert ownership, paging, and rehearsal evidence           |
| 2 — authoring                       | Searchable library, create/edit/rename, autosave, validation, reorder, duplicate, archive/restore, immutable versions, two question types, participant-style whole-quiz preview, and media thumbnail preview; signed quarantine uploads, required alt text, size and magic-byte checks, ClamAV scanning, clean promotion, private delivery, cleanup, and authoring UI                                                                                                                                                                                                                     | Timed new-user usability observation and production object-store/scanner monitoring evidence                                                   |
| 3 — lobby                           | Explicit per-session setup for audience, scoring, result visibility, late joining, and nickname policy; owner-fenced Redis code reservation with a PostgreSQL active-code backstop, copyable prefilled direct links, host/presenter QR, LAN/public join-address selection, same-origin multi-device routing, guest credentials, friendly aliases, capacity, roster, lock/unlock, kick, presenter view, and segment defaults                                                                                                                                                               | Thirty-device physical QR/LAN and hosted-domain test and moderated design-partner observation                                                  |
| 4 — engine                          | Pure guarded transitions, server receipt time, atomic join/answer micro-batches, durability and idempotency, scoring, reveal, standings, optimized role filtering, snapshots, reconnect, batched bounded Redis sequence replay, the Socket.IO Redis Streams adapter, owner-fenced distributed mutation leases, PostgreSQL compare-and-swap fencing, and passing two-writer tests                                                                                                                                                                                                          | Target-region 250-client rolling/process-loss and managed Redis failover evidence                                                              |
| 5 — reports and commercial controls | Summary/question/participant reports, plan-stamped 30/365-day retention, independently expiring live access, Pro-gated UTF-8 CSV, centralized participant/published-quiz/theme entitlements surfaced in the UI, one contrast-validated workspace brand theme copied immutably into new sessions, Stripe Checkout/portal/signature verification, atomic idempotent and order-safe webhook reconciliation, full account export, blob/cache/account/session deletion, support lookup, consent records, and audited actions                                                                   | Live Stripe replay, approved policies, and support rehearsal                                                                                   |
| 6 — hardening and community release | Apache-2.0 distribution, generated notices, SBOM/signing/container-scan workflows, non-root images, core/ClamAV/two-writer Compose profiles, unit/property/API/PostgreSQL/browser/Compose-browser automation, two-container process-loss and OTLP smokes, dependency audit, isolated local database/object restore, local 250-player restart and 1,000-player aggregate gates, and operations runbooks                                                                                                                                                                                    | Independent security/accessibility review, provider-level restore/failover, soak, target-region capacity evidence, and signed `v0.9.0` release |
| 7 — Canadian beta                   | Toronto/Canada deployment profiles, SLO/RPO/RTO checklist, incident, backup, upgrade, support, observability, and production-readiness runbooks; local OpenRound Operations dashboard and rule-evaluation smoke                                                                                                                                                                                                                                                                                                                                                                           | Provider accounts, legal approval, six partner onboardings, payment, support rota, owned paging, alert rehearsal, and ten observed sessions    |
| 8 — Canadian GA                     | Release/rollback automation, operational metric instrumentation, and Free/Pro product surfaces                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Stable 30-day beta measurements, support and reliability targets, pricing validation, and signed `v1.0.0` release                              |
| 9 — US expansion                    | Regional-isolation design and a US deployment boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Separate US stack, global code directory, US notices/contracts, counsel approval, residency tests, and named pilots                            |

## Latest verified baseline

The full baseline below passed locally on 2026-09-14. The cross-device joining, retention/
entitlement, explicit session setup, participant preview, workspace theme, client-receipt
telemetry, and runtime kill-switch deltas were verified on 2026-09-15 with formatting, lint,
strict type checks, 59 unit/integration tests, production builds, and a Chromium
creator-to-participant game. The QR flow was also checked through this machine's non-loopback LAN
address. These checks establish repository and local-network correctness only; they are not
substitutes for the external phase evidence above.

- `pnpm check`: formatting, lint, strict type checks, 59 unit/integration tests, and
  production builds for all five workspace packages.
- PostgreSQL integration: one production-like test covering forced RLS, unscoped and
  cross-workspace denial, media isolation/deletion, enriched account export, atomic billing event
  ordering, consent, immutable versions, audited operational-feature persistence, PostgreSQL
  session-version fencing with transactional rollback, and migrations.
- The release server image's owner-only `node dist/migrate.js` command completed against the local
  PostgreSQL profile independently of the long-lived non-owner application process.
- Shared-store multi-writer integration: two independent repositories, caches, and session
  services enforced shared code reservation and completed concurrent joins and answers with exact
  scores; owner-fenced lease expiry, duplicate host/answer retries, a stale command race,
  first-writer shutdown, contiguous replay, and report reconciliation all passed against
  PostgreSQL and Valkey.
- Two-container Compose smoke: twelve clients split across independent API/realtime processes,
  received and acknowledged cross-process events with Prometheus receipt samples, preserved
  idempotency, produced one applied and one fenced stale command, then completed and reconciled the
  game through the secondary after the primary stopped.
- Playwright: 24 critical-flow and automated accessibility checks across desktop Chromium,
  desktop Firefox, mobile Chromium, and mobile WebKit. Eighteen passed natively; all six Firefox
  cases passed in the official Playwright Linux runtime because the macOS 27 host is affected by
  the upstream Firefox launch defect tracked in
  [microsoft/playwright#42082](https://github.com/microsoft/playwright/issues/42082).
- `pnpm smoke:compose`: authentication and consent through account deletion across Caddy,
  PostgreSQL, Valkey, MinIO, Mailpit, ClamAV, server, and web. The run verifies audited runtime
  pause/resume, upload CORS, quarantine, clean scanning and promotion, invalid-signature rejection,
  session-scoped media, durable answer idempotency, report reconciliation, complete export, blob
  deletion, and cache invalidation.
- Compose Chromium: one real-browser LAN journey through workspace theming, direct upload, scan,
  preview/publish, session setup, QR/direct-link verification, guest join, private image delivery,
  durable answer/reveal, browser receipt acknowledgements, and object deletion.
- Compose 100-client scripted restart game: 100 accepted durable answers, zero duplicate score
  effects, no open-question answer-key leak, complete reconnect replay, idempotent host/answer
  retries after API/realtime restart, and exact report reconciliation. The latest local run measured
  join p95 80 ms, answer acknowledgement p95/p99 27/27 ms, question broadcast p95 15 ms, service
  restart recovery 683 ms, reconnect snapshot 8 ms, and report availability 14 ms. These figures
  pass the configured P0 thresholds on this machine only; they are not a hosted-environment SLO
  claim.
- Compose 250-client scripted restart game: all 250 answers were durable and reconciled after
  restart, with complete replay and no duplicate score or answer-key leak. The passing local run
  measured join p95 155 ms, answer acknowledgement p95/p99 61/61 ms, question broadcast p95
  64 ms, restart recovery 835 ms, reconnect 16 ms, and report availability 20 ms.
- Compose 1,000-client aggregate game: ten 100-client lobbies were admitted with a 750 ms
  inter-session stagger, all sockets waited at one start barrier, and all ten games then ran
  concurrently. All 1,000 answers and ten reports reconciled with complete replay and no duplicate
  effect or answer-key leak. Worst-session measurements were join p95 72 ms, answer p95/p99
  236/240 ms, broadcast p95 219 ms, reconnect 127 ms, and report availability 255 ms. The generator
  ran inside the Compose network to exclude the host VM's port forwarding from server measurements.
- `pnpm smoke:tracing`: the production server build exported OTLP protobuf to a temporary
  collector and shut down cleanly.
- `pnpm smoke:observability`: Prometheus scraped the private server endpoint, loaded all 14 alert
  rules, and successfully parsed every query from the provisioned OpenRound Operations dashboard;
  Grafana provisioned its read-only datasource and dashboard without manual setup.
- `promtool test rules`: synthetic failure series caused every alert to fire with its intended
  severity, summary, runbook annotation, and hold period.
- `pnpm smoke:restore`: a nonempty logical backup restored into an isolated PostgreSQL database
  with matching full-row fingerprints across all 19 durable tables; a synthetic private-storage
  object also survived delete/restore with an exact byte match. This is a local mechanics check,
  not a provider disaster-recovery exercise.
- `pnpm audit --audit-level low`: no known vulnerabilities in the current lockfile.
- Fresh production images: healthy as non-root users; `/metrics` is available inside the server
  container but not through the public Caddy route. Apache-2.0 and generated third-party notices
  are included in each image.

## Known technical differences and incomplete items

- Creator authentication is a local, hashed-token magic-link implementation with PostgreSQL
  persistence, not the Auth.js adapter named in the plan. A switch to Auth.js remains necessary
  if that library choice is a hard requirement.
- The editor now saves and opens a participant-style whole-quiz preview before publication.
  Hosting opens an explicit setup form seeded from the creator segment; the facilitator can change
  audience, scoring, result visibility, late-join, and nickname policy before any room code exists.
- Hosted Free/Pro participant, publishing, CSV, retention, and brand-theme rules now come from one
  server policy and are reflected by the dashboard, editor, report, and account UI. Pro and
  community workspaces can save one name/two-colour theme; both colours require 4.5:1 white-text
  contrast, and each new session freezes the then-active theme. Stored report deadlines
  intentionally do not shrink after a later plan downgrade.
- Reconnect synchronization returns a role-filtered authoritative snapshot and a bounded,
  contiguous Redis sequence journal. Journal entries currently carry event identity/version data;
  clients use the snapshot as the state recovery mechanism rather than rebuilding historical UI
  state event by event.
- Session mutation queues and hot metadata remain process-local, while every mutation refreshes
  shared state under an owner-fenced Redis lease and every durable write uses PostgreSQL
  compare-and-swap. Two direct-WebSocket writers and process loss now pass locally. Hosted
  multi-writer promotion still requires real load-balancer affinity, target-region rolling-kill,
  and managed Redis failover evidence.
- Prometheus metrics, browser event-receipt round-trip/timeout telemetry, OTLP export, persisted
  runtime kill switches, correlation headers, a local provisioned dashboard, and 14 versioned
  alert rules are wired. Production metrics/log/trace collectors, an owned paging integration,
  and alert rehearsals are not included as deployment evidence.
- Cloud and regional files are deployment profiles and runbooks, not proof of a live Canadian or
  US deployment. The Stripe path likewise requires a real-account replay exercise.
- No local run establishes soak, provider-level disaster recovery, or real-network latency gates.
  The supplied local capacity and restore results are instrumentation evidence, not
  hosted-production evidence.
- QR and direct-link joining now support a configured public URL or a facilitator-selected LAN
  origin, and all participant devices may share one room code while receiving independent resume
  credentials. Browser-generated question, command, and answer identifiers use a LAN-HTTP-safe Web
  Crypto path rather than secure-context-only APIs. Physical phone/tablet coverage across
  representative Wi-Fi, managed networks, firewalls, camera scanners, and the final public HTTPS
  domain remains a Phase 3 evidence gate.

## Remaining implementation sequence

1. Wire production metrics/log/trace collectors and owned paging routes, then rehearse the
   versioned alerts end to end in the target environment.
2. Exercise and finish provider-specific deployment automation, managed Redis failover, database
   restore, rolling multi-writer routing, Stripe replay, and signed release publication.
3. Decide whether Auth.js is a release requirement; if it is, migrate without changing the
   existing creator-session and tenant-isolation guarantees.
4. Build the separate US stack and minimal global code-to-region directory only after the Canadian
   launch and legal gates pass.

## Release boundary

Community/self-hosted operation has no application license fee and no billing gate. Infrastructure,
email, domain, monitoring, backup, and support costs remain with the operator. The free-cloud
profile is a quota-limited pilot with no availability commitment. Paid hosted production is not
ready merely because the containers run: every unchecked human, legal, provider, load, restore,
and operational gate above must be evidenced first.

# Phased delivery status

This repository implements the technical P0 baseline and the differentiated Recovery Loop through
the source-grounded authoring, self-paced follow-up, and institution-integration foundation. It
does not turn calendar, demand, legal, research, provider, certification, or production-observation
gates into software claims. `OpenRound` is a working identity pending independent name and
trademark review.

## 2026 P0 UX beta implementation

The merged baseline contains the gated creator workspace, authoring, setup, live host, participant,
report, history, and Recovery Rehearsal experience plus its additive contracts and storage. Both
beta flags default off; repository presence is not a launch claim. The global `FEATURE_UX_BETA`
ceiling and explicit `UX_BETA_WORKSPACE_ALLOWLIST` membership resolve per workspace; an empty
allowlist fails closed. Session snapshots carry that result to unauthenticated participant
surfaces. Recovery Rehearsal additionally has its own `FEATURE_RECOVERY_REHEARSAL` kill switch.

| Area                    | Repository status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Still required before beta exit                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Workspace and creation  | Creator-only Rounds, Sessions, Results, Templates, and Workspace destinations preserve `/dashboard`; `/create` supports starter, source, import, and blank starts; six immutable first-party starters instantiate ordinary drafts with fresh Round/question/choice IDs and valid linked rechecks                                                                                                                                                                                                                                                                                                                                                                                                              | Timed unassisted creation trials, starter-content review, and source/import journey evidence                          |
| Authoring and setup     | Stable-ID editor navigation, response-type insertion, progressive diagnostic disclosures, paired rechecks, participant preview, serialized autosave/publish fencing, one-step structural undo, and entitlement-capped Recovery, Friendly competition, and Open discussion recipes are implemented                                                                                                                                                                                                                                                                                                                                                                                                             | Facilitator usability observation, representative source-corpus review, and browser/device accessibility verification |
| Live facilitation       | A transport-neutral command controller and shared phase model gate legal actions across live Socket.IO and in-memory rehearsal adapters; the center stage, evidence-explaining Recovery Compass, phase-aware command bar, room-readiness strip, and separate Participants/Pulse/Q&A/Chat drawer share the resulting view; command acknowledgement timeouts reconcile against authoritative state before retry                                                                                                                                                                                                                                                                                                 | Observed facilitator action-finding trials, hosted reconnect/process-loss evidence, and manual assistive-tech review  |
| Participant response    | All six response types use explicit Submit, required confidence receives focus, authoritative acknowledgement/snapshot state restores a durable receipt, and answering remains independent from the closed interaction tray; join preflight suppresses unnecessary nickname entry without mutating the room; a keyboard-accessible fixed avatar picker persists through reconnect, while omitted legacy/API values receive a deterministic allowlisted fallback                                                                                                                                                                                                                                               | First-response usability trials, physical-device/network coverage, and hosted acknowledgement-latency evidence        |
| History and library     | Tenant-scoped cursor pages for Sessions, Results, and Practice Follow-ups support status/Round/date filters and summary-only DTOs; Round cards expose tenant-scoped last-hosted dates plus an accessible persisted list/grid preference                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Production-copy index/latency evidence, responsive/accessibility verification, and result-discovery trials            |
| Recovery Story          | The report first viewport explains recovered and unresolved evidence, intervention history, confidence contradictions, sample strength, and next action; accessible text-backed distributions are persisted only at the five-response staff threshold, while exports, retention, and deletion stay in Manage data                                                                                                                                                                                                                                                                                                                                                                                             | Observed report-comprehension trials, independent privacy/accessibility review, and report-latency evidence           |
| Recovery Rehearsal      | The read-only in-memory route shares the transport-neutral host command controller, phase model, and components and deterministically supports low participation, split room, and confident misconception scenarios, authored recheck/revote recovery, synthetic labelling, and bounded start/completion telemetry without creating durable session/report/participant/follow-up records                                                                                                                                                                                                                                                                                                                      | Pilot completion/comprehension evidence and independent verification of the no-persistence boundary                   |
| Secure recovery         | Four-hour-or-session-expiry creator control passes; one active pass per creator/session; atomic replacement, audit, revocation, rate limit, tenant/session scope, and no-store response                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Multi-browser/browser-close rehearsal, penetration review, and production revocation monitoring                       |
| Entitlements            | `cohosting` is false on Hosted Free and true on Pro, Team, and Community; only shareable cohost creation is gated, while presenter and creator-resume credentials remain core                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Billing-plan acceptance tests against production configuration and packaging validation                               |
| Evidence privacy        | Additive post-lock staff distributions have a five-response minimum; participant payloads suppress them; multi-select percentages use respondents and numeric distributions contain correct/incorrect totals only; staff/presenter/report participant detail can carry the fixed session avatar, while private-result participant snapshots suppress other participants' avatars                                                                                                                                                                                                                                                                                                                              | Independent privacy/accessibility review and observed small-sample comprehension                                      |
| Telemetry               | Bounded creation→publish→room→join→answer/save→lock/insight→intervention/recheck→report/share and rehearsal events; no actor/object/content fields; fail-closed beta ingestion; 30-day raw retention with observable purge counts; bounded Prometheus labels and Grafana funnel panels                                                                                                                                                                                                                                                                                                                                                                                                                        | Approved notice/legal basis, hosted metrics retention configuration, and allowlisted pilot monitoring                 |
| Compatibility and build | Migrations 014–016 are additive; persisted `quiz`/checkpoint contracts, routes, storage keys, authentication, realtime event names, and versioned records remain compatible; optional `JoinRequest.avatarId` and additive participant/report DTO fields preserve older clients, and existing state v4 snapshots receive a deterministic valid fallback without a schema or database migration; ready Report V2 and V3 can create follow-ups; a CI/local Docker-context guard checks that image builds include every transitive workspace manifest and source tree before install/build, and clean-host source, database, security, browser, and production-smoke workflows are linked from the release ledger | Provider backup/migration/forward-repair rehearsal and continued green candidate CI                                   |

The beta Playwright configuration schedules non-mobile scenarios in desktop Chromium and Firefox,
and `@mobile` scenarios at 390×844 in mobile Chromium and WebKit. Axe automation scans the
authenticated dashboard, Create, and Templates surfaces on desktop and Create on both mobile
engines. The merged PR passed this clean-host browser matrix; automated coverage still does not
replace manual VoiceOver/NVDA evidence.

The capacity and production-smoke workflows now run evidence collection and artifact upload on
both successful and failed jobs, retaining available load JSON, server metrics, and applicable
Playwright/test results for 30 days. Failure logs remain failure-only. This makes successful-run
evidence retrievable but does not itself satisfy the hosted capacity or production-readiness
gates.

The release ledger links the green source, security, and production-smoke runs for the current
merged baseline. It intentionally keeps Canadian staging, privacy/legal approval, design-partner
observation, manual VoiceOver/NVDA and physical-device coverage, target-region load/soak/failover,
real-provider source-corpus evaluation, and provider-originated Stripe rehearsal pending. Local
automation does not satisfy those gates.

## Themed Experiences and Audience Interaction

The repository contains the complete single-process product slice and durable schema for Round
Experiences, Audience Pulse, room chat, interaction reporting, privacy lifecycle, and moderation.
Repository presence is not evidence that partner, mixed-load, process-loss, accessibility, or
production-promotion gates have passed.

| Phase                           | Repository status                                                                                                                                                                                                                                                                                                                 | Still required for exit                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 0 — validate interaction design | Six presets, role previews, Pulse controls, dashboard, chat, and moderation workflow are available for testing                                                                                                                                                                                                                    | Three higher-education and three workplace facilitator sessions; five-of-six uncoached success evidence  |
| 1 — safe contracts/storage      | Category/preset contracts, JSON v2/v1 compatibility, game state v4/v3 upgrader, report v3 backward rendering, migrations 011–013 with forced RLS and an atomic finish cutoff, monotonic audience sequence, distributed limits, transactional outbox, and audited rollout switches are implemented                                 | Production-copy migration/rollback rehearsal                                                             |
| 2 — Round Experiences           | Focus, Campus, Studio, Blueprint, Signal, and Spark registry; author/setup previews; frozen session tokens; workspace-brand layering; role surfaces; local contrast/motion/mute; opt-in original Web Audio cues                                                                                                                   | Manual VoiceOver/NVDA, projector/phone, 200% zoom, and visual-regression evidence for every preset       |
| 3 — Audience Pulse              | Four contextual signals, host-only participant projection, five-person public threshold, rolling activity, participant filters, independent audience sync, and at-most-4-Hz public summary notifications                                                                                                                          | Target-region 250-participant mixed load, Redis disruption, process-loss, and answer-SLO evidence        |
| 4 — Live Conversation           | Disabled-by-default chat, plain text, one-level replies, reactions, immutable private aliases, slow/hard limits, presenter feed, pin/remove/report, 5/15/60-minute mute, ban, Q&A integration, sequenced Q&A compatibility events, durable at-least-once fan-out, and passing two-process committed-message/process-loss coverage | Observed moderation rehearsal and hosted mixed-load evidence                                             |
| 5 — Evidence/hardening          | Aggregate report v3, authorized transcript/CSV, formula escaping, account export, session/account cascading deletion, bounded metrics, privacy/data-map updates, and moderation/incident runbooks                                                                                                                                 | Full mixed-load, security, accessibility, retention, backup/restore, and report-under-60-second evidence |
| 6 — partner beta                | Workspace roles, scoped staff credentials, and a validated workspace-UUID rollout allowlist support selected partners                                                                                                                                                                                                             | Six live partners, repeat-use evidence, support observation, and no severe incident                      |
| 7 — production promotion        | Presets, Pulse, and chat have independent startup ceilings and audited runtime kill switches                                                                                                                                                                                                                                      | Controlled production promotion and 30 uninterrupted stable days                                         |

## Differentiated product roadmap

No version tag in this table should be inferred merely from code presence. A phase is releasable
only after its stated product, operational, accessibility, privacy, security, demand, and legal
gates pass.

| Phase                     | Repository status                                                                                                                                                                                                                                                                                                                                                                                                                     | Still required for the phase exit                                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — demand validation     | Interview/evidence templates and measurable demand gates are documented                                                                                                                                                                                                                                                                                                                                                               | Six higher-education and six L&D interviews, six accepted pilots, observed prototype completion, and willingness-to-pay evidence                                                                                                        |
| 1 — safe evolution        | Ordered transactional migration ledger, advisory lock, checksums, P0 bootstrap/upgrade, repeated-run/failure tests, state/report schema versions, compact live history, and report-job skeleton                                                                                                                                                                                                                                       | Clean-host CI and production backup/forward-repair rehearsal                                                                                                                                                                            |
| 2 — Signal (`v0.10`)      | Six checkpoint types, canonical versioned responses, legacy `choiceId`, confidence, purposes, concepts, exact-set multi-select, decimal numeric scoring, and editor/player/report compatibility                                                                                                                                                                                                                                       | Design-partner usability and real-device accessibility evidence                                                                                                                                                                         |
| 3 — Recover (`v0.11`)     | Main/linked-recheck/revote rounds, intervention transitions, deterministic explained insight cards, misconception signals, reconnect, process restoration, and private payload projections                                                                                                                                                                                                                                            | Observed facilitator use and target-region process-loss evidence                                                                                                                                                                        |
| 4 — Evidence (`v0.12`)    | Database-backed report worker, report v2, confidence matrix, misconceptions, intervention timeline, linked recovery, separate revote evidence, unresolved concepts, JSON/CSV, Q&A summary, and private feedback                                                                                                                                                                                                                       | Six-partner paid beta, report-under-60-second production evidence, and reconciliation monitoring                                                                                                                                        |
| 5 — Collaborate (`v0.13`) | Owner/editor/viewer roles, invitations, workspace switching, revocable cohost/presenter credentials, audited actors, persistent moderated Q&A, replies, votes, realtime updates, limits, and retention                                                                                                                                                                                                                                | Moderation rehearsal, abuse testing, and multi-facilitator partner evidence                                                                                                                                                             |
| 6 — Portable (`v0.14`)    | Folders/tags, bulk/CSV/native JSON/QTI import/export with validation, formula escaping, archive/XML hardening, presenter popout, QR assets, deep links, and allowlisted secure embed                                                                                                                                                                                                                                                  | External QTI corpus interoperability and paying-partner companion-mode validation                                                                                                                                                       |
| 7 — Canadian GA (`v1.0`)  | Product code and Canadian deployment/runbook profiles exist                                                                                                                                                                                                                                                                                                                                                                           | Successful paid beta plus uninterrupted 30-day reliability, support, accessibility, privacy, billing, backup, legal, and demand gates                                                                                                   |
| 8 — Create (`v1.1`)       | Provider-neutral async assistant, disabled-by-default/BYO configuration, isolated bounded PDF/DOCX/PPTX extraction, grounded citations, rationales/misconceptions, retries, monthly limits, draft-only review, source cleanup, and idempotent apply                                                                                                                                                                                   | Approved hosted provider/model, privacy/DPA/residency review, real corpus quality/cost evaluation, and human-review usability evidence                                                                                                  |
| 9 — Follow Up (`v1.2`)    | Immutable unresolved-concept follow-ups, generic/personal hashed links, one-attempt semantics, resume, timed/flex modes, revocation/close, 1.5×/2× passes, private feedback, and cascading retention/deletion                                                                                                                                                                                                                         | Browser/accessibility matrix, partner use, and production expiry/revocation monitoring                                                                                                                                                  |
| 10 — Institution (`v2.0`) | Operator-only contract/capability policy, permanent workspace-region visibility, generic creator OIDC with explicit issuer/subject linking, LTI 1.3 instructor launch and Deep Linking with one-time state/nonce and public JWKS, LMS registration controls, external-identity retention/deletion, versioned owner audit export, and configurable scheduled audit retention are implemented; K–12 and learner launches remain blocked | Managed hosted SAML/SCIM broker, identified learner model, NRPS/AGS and idempotent grade delivery, real LMS interoperability/certification, institutional pilots, vendor selection, contracts, and independent identity/security review |
| 11 — expansion hardening  | Existing P0 security, accessibility, observability, load, restore, deployment, and runbook foundations apply                                                                                                                                                                                                                                                                                                                          | Independent reviews, institutional pilots, provider restore/failover, US posture, counsel, and final operator evidence                                                                                                                  |

## Original P0 delivery record

| Phase                               | Delivered in this repository                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Remaining implementation or evidence before the exit gate can be claimed                                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — risk and definition             | Clean-room rules, original product system, protocol invariants, deterministic scoring tests, and a configurable Socket.IO load harness                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Eight interviews, six recruited design partners, and documented findings                                                                                            |
| 1 — foundation                      | TypeScript workspace, Compose, CI, magic-link authentication, PostgreSQL migrations plus a one-shot owner-only image command, forced RLS, non-owner runtime role, structured logs, dependency-aware liveness/readiness, a non-secret deployment configuration preflight, fail-fast production transport/email/metrics safeguards, Prometheus metrics including browser event-receipt latency/timeouts, optional OTLP tracing, request correlation, audited database-backed runtime kill switches bounded by startup ceilings, and a provisioned local Prometheus/Grafana profile with 14 versioned, semantically tested alert rules | Production identity/provider configuration, deployed staging, production collectors, alert ownership, paging, and rehearsal evidence                                |
| 2 — authoring                       | Searchable library, create/edit/rename, autosave, validation, reorder, duplicate, archive/restore, immutable versions, two question types, participant-style whole-quiz preview, and media thumbnail preview; signed quarantine uploads, required alt text, size and magic-byte checks, ClamAV scanning, clean promotion, private delivery, cleanup, and authoring UI                                                                                                                                                                                                                                                               | Timed new-user usability observation and production object-store/scanner monitoring evidence                                                                        |
| 3 — lobby                           | Explicit per-session setup for audience, scoring, result visibility, late joining, and nickname policy; owner-fenced Redis code reservation with a PostgreSQL active-code backstop, copyable prefilled direct links, host/presenter QR, LAN/public join-address selection, same-origin multi-device routing, guest credentials, friendly aliases, capacity, roster, lock/unlock, kick, presenter view, and segment defaults                                                                                                                                                                                                         | Thirty-device physical QR/LAN and hosted-domain test and moderated design-partner observation                                                                       |
| 4 — engine                          | Pure guarded transitions, server receipt time, atomic join/answer micro-batches, durability and idempotency, scoring, reveal, standings, optimized role filtering, snapshots, reconnect, batched bounded Redis sequence replay, the Socket.IO Redis Streams adapter, owner-fenced distributed mutation leases, PostgreSQL compare-and-swap fencing, and passing two-writer tests                                                                                                                                                                                                                                                    | Target-region 250-client rolling/process-loss and managed Redis failover evidence                                                                                   |
| 5 — reports and commercial controls | Summary/question/participant reports, plan-stamped 30/365-day retention, independently expiring live access, Pro-gated UTF-8 CSV, centralized participant/published-quiz/theme entitlements surfaced in the UI, one contrast-validated workspace brand theme copied immutably into new sessions, Stripe Checkout/portal/signature verification, atomic idempotent and order-safe webhook reconciliation, full account export, blob/cache/account/session deletion, support lookup, consent records, and audited actions                                                                                                             | Live Stripe replay, approved policies, and support rehearsal                                                                                                        |
| 6 — hardening and community release | Apache-2.0 distribution, generated notices, SBOM/signing/container-scan workflows, CodeQL and pull-request dependency review, non-root images, enforced nonce-based script CSP and HSTS, core/ClamAV/two-writer Compose profiles, unit/property/API/PostgreSQL/browser/Compose-browser automation, expanded axe coverage for authenticated and live states, two-container process-loss and OTLP smokes, dependency audit, isolated local database/object restore, local 250-player restart and 1,000-player aggregate gates, and operations runbooks                                                                                | Independent security/accessibility review, provider-level restore/failover, soak, target-region capacity evidence, and signed `v0.9.0` release                      |
| 7 — Canadian beta                   | Toronto/Canada deployment profiles, SLO/RPO/RTO checklist, incident, backup, upgrade, support, observability, staging-readiness, governance, and production-readiness runbooks; tested Alertmanager route and collector templates; a manual remote probe/load/Stripe-replay workflow; a machine-validated release ledger; and redaction-safe evidence templates                                                                                                                                                                                                                                                                     | Provider accounts, legal approval, six partner onboardings, payment, support rota, owned paging, alert rehearsal, physical-device checks, and ten observed sessions |
| 8 — Canadian GA                     | Release/rollback automation, operational metric instrumentation, and Free/Pro product surfaces                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Stable 30-day beta measurements, support and reliability targets, pricing validation, and signed `v1.0.0` release                                                   |
| 9 — US expansion                    | Regional-isolation design and a US deployment boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Separate US stack, global code directory, US notices/contracts, counsel approval, residency tests, and named pilots                                                 |

## Latest verified baseline

On 2026-09-19, the merged P0 beta baseline passed the clean-host CI, PostgreSQL/multi-writer,
Security, CodeQL, SBOM, feature-off browser, UX-beta Chromium/Firefox/WebKit, and production-path
smoke workflows linked from the release ledger. The first merged-head browser attempt encountered
an intermittent Next development-output 404; the complete rerun passed, and the follow-up isolates
each sequential Playwright suite’s Next output directory to remove that shared-cache failure mode.
Repository and local-network correctness are not substitutes for the external phase evidence above.

The corresponding package baseline passed 21 contract tests, 18 game-engine tests, 11 Recovery
Rehearsal tests, 128 web tests, 131 server tests, 14 database memory/migration tests, four insight
tests, three experience tests, and three smoke-support tests. The environment-gated multi-writer and
PostgreSQL suites passed independently in clean-host CI through migrations 014–016, including
forced RLS, tenant isolation, exact keyset cursors, last-hosted aggregation, durable history counts,
and session-scoped credential revocation. Local macOS Firefox remains unable to start because its
installed Playwright profile is invalid; the passing Linux clean-host Firefox job is authoritative.

- `pnpm check`: formatting, a transitive workspace-dependency Docker-context guard, lint, strict
  type checks, package tests, and production builds for all eight workspace packages. The recorded
  package run has 333 passing tests; PostgreSQL and multi-writer coverage also run in their
  dependency-backed clean-host job.
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
- Playwright covers feature-off and allowlisted beta journeys in desktop Chromium and Firefox plus
  mobile Chromium and WebKit. The merged clean-host matrix passed; manual assistive-technology and
  physical-device coverage remain separate release gates.
- `pnpm smoke:compose`: authentication and consent through account deletion across Caddy,
  PostgreSQL, Valkey, MinIO, Mailpit, ClamAV, server, and web. The run verifies audited runtime
  pause/resume, upload CORS, quarantine, clean scanning and promotion, invalid-signature rejection,
  session-scoped media, durable answer idempotency, report reconciliation, complete export, blob
  deletion, and cache invalidation.
- Compose Chromium: one real-browser LAN journey through workspace theming, direct upload, scan,
  preview/publish, session setup, QR/direct-link verification, guest join, private image delivery,
  durable answer/reveal, browser receipt acknowledgements, and object deletion.
- The remote-readiness probe passed against the local production Compose route, validating active
  PostgreSQL and Valkey readiness, expected public feature flags, disabled public metrics, and the
  nonce-based browser security policy. This validates the probe, not a Canadian deployment.
- Compose 100-client scripted restart game: 100 accepted durable answers, zero duplicate score
  effects, no open-question answer-key leak, complete reconnect replay, idempotent host/answer
  retries after API/realtime restart, and exact report reconciliation. The latest local run measured
  join p95 79 ms, answer acknowledgement p95/p99 26/26 ms, question broadcast p95 18 ms, service
  restart recovery 887 ms, reconnect snapshot 8 ms, and report availability 15 ms. These figures
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
  persistence, not the Auth.js adapter named in the initial plan. ADR 001 accepts the current
  behavior for P0 and defines federated identity, account linking, institutional SSO, or a separate
  identity service as migration triggers; a library-only rewrite is not an open P0 gate.
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
  runtime kill switches, correlation headers, a local provisioned dashboard, 14 versioned alert
  rules, severity-route tests, and a validated collector template are wired. Production
  metrics/log/trace backends, secret receiver configuration, a named paging rota, and human alert
  rehearsals are not included as deployment evidence.
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

1. Complete beta usability and demand evidence: 12 interviews, three higher-education plus three
   workplace partners, at least ten observed sessions, the defined unassisted task-time targets,
   repeat-use measurement, and willingness-to-pay evidence. Revise the ICP or packaging if those
   gates fail.
2. Add a second human reviewer, activate the prepared `main` ruleset, and pass a normal reviewed
   canary PR without using the pull-request-only break-glass bypass.
3. Provision Canadian staging and private telemetry/paging; complete managed Redis failover,
   database/object restore, rolling multi-writer routing, soak, physical-device QR, Stripe,
   independent security/accessibility, privacy, and legal reviews.
4. Evaluate source-grounded authoring against an approved real provider and representative private
   corpus. Record citation accuracy, answer quality, human correction rate, latency, cost, data
   handling, and failure behavior before enabling it in hosted production.
5. Complete the remaining contract-gated institution work. The repository now includes generic
   creator OIDC, instructor LTI launch/Deep Linking, operator policy/registration controls,
   region visibility, and audit export. Still required are managed hosted SAML/SCIM, an approved
   identified-learner model, NRPS/AGS with idempotent grade delivery, LMS certification/interop,
   and institutional pilot verification. K–12 remains disabled pending implementation and counsel.
6. Build a separate US stack and minimal code-to-region directory only after Canadian launch,
   residency, contract, and counsel gates pass.

## Release boundary

Community/self-hosted operation has no application license fee and no billing gate. Infrastructure,
email, domain, monitoring, backup, and support costs remain with the operator. The free-cloud
profile is a quota-limited pilot with no availability commitment. Paid hosted production is not
ready merely because the containers run: every unchecked human, legal, provider, load, restore,
and operational gate above must be evidenced first.

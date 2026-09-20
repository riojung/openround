# API and realtime reference

REST endpoints are versioned under `/v1`. Shared Zod schemas validate HTTP, realtime,
environment, persisted-version, and webhook boundaries. Errors use:

```json
{ "error": { "code": "STABLE_CODE", "message": "Actionable explanation", "requestId": "..." } }
```

Creator routes use the secure HttpOnly creator cookie. Session, staff, presenter, participant,
embed, and follow-up routes use their own scoped credentials as documented by the returned flow.

## Service and feature APIs

- `GET /health/live` — process liveness and the build-time `buildId` used to bind readiness
  evidence to the deployed candidate.
- `GET /health/ready` — active PostgreSQL and Redis-compatible checks; returns 503 without secret
  connection detail when either is unavailable.
- `GET /v1/features` — public URL, edition mode, effective
  signup/session/media/experience/Pulse/chat switches, and deployment-level `uxBeta` and
  `recoveryRehearsal` availability.
- `POST /v1/product-events` — creator-authenticated batch of 1–20 schema-allowlisted beta events;
  accepted names are `creation_started`, `creation_completed`, `round_published`,
  `setup_recipe_selected`, `host_setup_completed`, `participant_joined`,
  `first_answer_submitted`, `response_saved_acknowledged`, `question_locked`, `insight_shown`,
  `intervention_started`, `recheck_opened`, `report_viewed`, `followup_shared`,
  `practice_assignment_created`, `practice_assignment_shared`, `rehearsal_started`, and
  `rehearsal_completed`. Feature-on plus explicit workspace allowlist
  membership is required; excluded workspaces receive `{ "accepted": 0 }`. `accepted` means the
  events entered the bounded best-effort persistence queue; the request does not wait for storage.
- `GET /metrics` — private Prometheus output when enabled and authorized.

`FEATURE_UX_BETA`, `FEATURE_RECOVERY_REHEARSAL`, and `FEATURE_PRACTICE_ASSIGNMENTS` default off. The authenticated
`productFeatures` view requires explicit membership in `UX_BETA_WORKSPACE_ALLOWLIST`; an empty
allowlist fails closed and enables no workspace. Rehearsal requires both flags and allowlist
membership. Standalone practice creation similarly requires the UX beta, its independent practice
flag, and allowlist membership; already-issued participant links and creator close/revoke controls
remain available when creation is disabled.
Because guests do not call `/v1/auth/me`, every role-filtered session snapshot carries the
workspace-resolved `uxBeta` value. The public feature view is deployment availability, not evidence
that a particular workspace is allowlisted.

Product events accept only `creationPath`, `recipe`, `scenario`, `segment`, `betaVersion`, and
`durationBucket` categorical dimensions. The server replaces `segment` and `betaVersion` with
trusted workspace/release values. Actor/object IDs, content, answers, aliases, source text, and
free-form metadata are rejected. Creation events require `creationPath`, setup selection requires
`recipe`, both rehearsal events require `scenario`, and rehearsal completion also requires
`durationBucket`. Raw rows expire after 30 days and the same bounded labels feed the Prometheus
counter.
Authoritative server transitions emit publish, room-created, join, first-answer, durable-save,
lock/insight, intervention, recheck, ready-report-view, and committed practice-assignment creation
milestones. `followup_shared` and `practice_assignment_shared` are emitted only from an explicit
Copy or link-download action, never merely because a practice link was created.
All product-event writes run through a bounded serial dispatcher, are drained before repository
shutdown, and log failures without delaying or failing the originating product flow.
The retention result/log and `openround_retention_records_total` expose deleted product-event
counts under the bounded `product_event` resource label.

## Authentication, workspaces, and account

- `POST /v1/auth/magic-link`
- `GET /v1/auth/verify?token=...`
- `GET /v1/auth/me` — creator/workspace context, entitlements (including `cohosting`), branding,
  and workspace-resolved `productFeatures` after the partner allowlist and global switches are
  applied.
- `POST /v1/auth/logout`
- `GET /v1/workspaces`
- `POST /v1/workspaces/{id}/select`
- `GET /v1/workspace/members`
- `POST /v1/workspace/invitations`
- `POST /v1/invitations/accept`
- `DELETE /v1/workspace/invitations/{invitationId}`
- `PATCH|DELETE /v1/workspace/members/{userId}`
- `GET|PUT|DELETE /v1/account/theme`
- `GET|PUT /v1/account/embed-origins`
- `GET /v1/account/export`
- `GET /v1/workspace/audit-export?since=...` — contract-gated owner export, at most 10,000
  ordered events with explicit truncation metadata.
- `DELETE /v1/account` with `{ "confirmation": "DELETE" }`

Owners manage members, billing, and workspace deletion. Editors create and host. Viewers have
read-only content/report access. Account export excludes bearer-token hashes and includes
collaboration, Pulse, chat, moderation, Q&A, recovery, follow-up, and authoring records owned by
the workspace.

## Institution identity and LTI APIs

These routes are disabled by default and require an operator-granted workspace policy. Enabling a
creator integration does not change anonymous guest participation.

- `GET /v1/workspace/institution-policy` — authenticated read-only capability policy; owners
  cannot self-enable it. `GET /v1/workspaces` carries the home-region assignment.
- `GET /v1/auth/oidc/status?workspaceId=...`
- `POST /v1/auth/oidc/start` with `mode=login|link`
- `GET /v1/auth/oidc/callback` — authorization-code callback with one-time state, PKCE, and nonce.
- `GET /v1/auth/federated-identities`
- `DELETE /v1/auth/federated-identities/{identityId}`
- `GET /v1/lti/jwks` — public half of the active tool signing key only.
- `POST /v1/lti/login` — third-party-initiated login (`application/x-www-form-urlencoded`).
- `POST /v1/lti/launch` — platform-signed form-post launch.
- `POST /v1/lti/link` — explicit link of a verified LMS subject to the current creator.
- `GET /v1/lti/launches/{launchId}`
- `POST /v1/lti/launches/{launchId}/deep-link`
- `GET /v1/workspace/lti-registrations` — owner-visible, read-only registration inventory.

OIDC login accepts only a previously linked workspace/issuer/subject identity; email hints never
create a link. LTI validates issuer, audience/authorized party, nonce, deployment, version, message
type, signed target, role, and registration. Deep Linking supports a single published
`ltiResourceLink` and returns the same signed result on retry. Instructor launches are supported;
learner launches, NRPS, and AGS are deliberately rejected in this release.

## Checkpoint-set and portability APIs

Legacy `/v1/quizzes` naming is intentionally stable through v1 even though the UI says
**checkpoint set**.

- `GET /v1/starters` — six immutable, versioned first-party starter summaries.
- `POST /v1/starters/{id}/use` — owner/editor creation of a normal draft with fresh Round,
  question, and choice IDs while preserving linked-recheck relationships.
- `GET|POST /v1/quizzes`; `GET` accepts `archived=true|false` and `summary=true|false`. Normal
  library rows include the tenant-scoped `lastHostedAt` across retained versions; `summary=true`
  returns only each Round's `id` and `title` for filter controls.
- `GET|PATCH /v1/quizzes/{id}`
- `POST /v1/quizzes/{id}/publish`
- `POST /v1/quizzes/{id}/duplicate`
- `POST /v1/quizzes/{id}/archive`
- `GET|POST /v1/folders`
- `PATCH|DELETE /v1/folders/{id}`
- `PATCH /v1/quizzes/{id}/organization`
- `POST /v1/quizzes/import` for `bulk`, `csv`, `openround_json`, or base64 `qti3`
- `GET /v1/quizzes/{id}/export.json`
- `GET /v1/quizzes/{id}/export.csv`
- `GET /v1/quizzes/{id}/export.qti.zip`

Authenticated `GET /v1/quizzes` library reads, including `summary=true`, and
`GET /v1/quizzes/{id}` detail reads are tenant-scoped and return `Cache-Control: private,
no-store` with `Pragma: no-cache`. The UX-beta private question picker uses those existing reads and
the normal draft `PATCH`; it appends fresh-ID independent copies in the browser, remaps a valid
main-to-recheck link to the copied recheck, and does not mutate or synchronize with the source
Round. There is no separate question-bank API or shared question identity.

Imports always return a validation report. OpenRound JSON is lossless and versioned. The QTI 3
profile supports single select, true/false, multiple select, and numeric response; unsupported
types and omitted media are explicit warnings/errors. CSV output escapes spreadsheet formula
prefixes.

## Source-grounded authoring APIs

- `GET /v1/authoring/status` — configured state and current monthly usage.
- `GET /v1/authoring/jobs`
- `POST /v1/authoring/jobs` — pasted text or base64 PDF/DOCX/PPTX; returns 202.
- `GET /v1/authoring/jobs/{id}`
- `POST /v1/authoring/jobs/{id}/apply` — idempotently creates one unpublished review draft.

Uploaded files are limited to 6 MB. Arbitrary URLs are rejected. A disabled deployment returns
`AUTHORING_DISABLED` before storing the source. Hosted monthly limits return `AUTHORING_LIMIT`.
Jobs expose no raw source through ordinary API views. Output is schema- and citation-validated,
retains private creator citations, and never publishes automatically.

## Media APIs

- `POST /v1/media` — constrained signed quarantine upload.
- `POST /v1/media/{id}/complete` — verify metadata/bytes/signature, scan, and promote clean data.
- `GET /v1/media/{id}` — creator-scoped signed clean-object URL.
- `GET /v1/sessions/{sessionId}/media/{mediaId}` — authorized frozen-session media.
- `GET /v1/followups/{id}/media/{mediaId}` — current follow-up checkpoint media.

Pending or rejected media is never returned by a read endpoint and is eligible for scheduled
cleanup.

## Live session, staff, presenter, and embed APIs

- `GET /v1/sessions` — tenant-scoped summary history with status, Round, and date filters.
- `POST /v1/sessions`
- `GET /v1/sessions/join/preflight?code=...` — rate-limited, non-mutating nickname-policy lookup
  for the join form.
- `POST /v1/sessions/join`
- `GET /v1/sessions/{id}/snapshot?role=...`
- `POST /v1/sessions/{id}/commands`
- `POST /v1/sessions/{id}/answers`
- `POST /v1/sessions/{id}/control-pass` — owner/editor secure resume for an active room.
- `DELETE /v1/sessions/{id}`
- Session staff credential creation/list/revocation routes under `/v1/sessions/{id}/staff`
- Presenter/embed policy issuance under the session routes
- `GET /v1/embed/policies/{sessionId}/{policyKey}`

`POST /v1/sessions/join` accepts an optional `JoinRequest.avatarId` from the fixed, content-free
allowlist `comet`, `fox`, `owl`, `otter`, `panda`, `robot`, `rocket`, and `star`. Omitting it keeps
older clients compatible: after allocating the participant UUID, the server deterministically
selects one of the same valid IDs. An unrecognized value fails request validation. The selected or
fallback ID is stored in canonical game state and survives refresh/reconnect; a reconnect cannot
replace it. Participant, staff-audience, and report DTOs expose `avatarId` additively so legacy
payloads remain readable. Host and presenter snapshots, moderator audience views, and authorized
reports may show session avatars. In private-result participant snapshots, only the requesting
participant's avatar remains visible; every other participant's avatar is suppressed.

Host commands carry `commandId` and `expectedVersion`. Recovery actions include
`intervention.start`, `intervention.finish`, and `recheck.open`; the engine validates when peer
discussion, explain/example/break, linked recheck, or revote is legal. A dedicated presenter or
embed credential is read-only and never reuses the host token.

Shareable cohost credential creation requires the `cohosting` entitlement (Pro, Team, or Community);
presenter credentials remain core. Staff credential views include
`purpose: collaboration | creator_resume`. A creator control pass is a host-equivalent cohost
credential with purpose `creator_resume`, expires after four hours or at session expiry (whichever
comes first), and does not depend on the cohosting entitlement. Issuing another pass for the same
creator/session atomically revokes the prior one. The response is `Cache-Control: private,
no-store`; clients keep its bearer only in session storage and never place it in a URL.

Join preflight accepts only a seven-digit code, is limited to 20 requests per minute, returns
`Cache-Control: no-store`, and exposes only `nicknamePolicy` for a joinable room. Invalid, expired,
locked, full, finished, and institution-restricted rooms all return the same `INVALID_CODE`
response. It creates no participant, changes no session version, and reveals no title, workspace,
phase, capacity, or participant count.

After lock/reveal, staff snapshots may include an additive `responseDistribution` only when at
least five people answered. Choice and rating payloads contain aggregate buckets; multi-select uses
`percentBasis: respondents`; numeric payloads expose only correct/incorrect totals. Participant
snapshots never contain this field.

Normal routes deny framing. `/embed/present/{sessionId}` is constrained by a server-issued policy
and the workspace's allowlist of at most ten HTTPS origins.

## Round Experience and audience interaction APIs

- `GET /v1/experience-presets` — immutable public registry summaries and validated semantic
  tokens.
- `GET|PATCH /v1/sessions/{id}/interactions/settings`
- `GET /v1/sessions/{id}/interactions/summary`
- `GET /v1/sessions/{id}/interactions/sync?limit=...`
- `PUT /v1/sessions/{id}/signals/current`
- `GET|POST /v1/sessions/{id}/chat/messages`
- `PATCH /v1/sessions/{id}/chat/messages/{messageId}`
- `PUT|DELETE /v1/sessions/{id}/chat/messages/{messageId}/reaction`
- `POST /v1/sessions/{id}/chat/messages/{messageId}/report`
- `PATCH /v1/sessions/{id}/interactions/participants/{participantId}`

Interaction synchronization includes `capabilities.audiencePulse` and `capabilities.roomChat` so
clients can disable unavailable controls instead of treating a rollout gate as a session setting.

Checkpoint drafts and OpenRound JSON v2 carry `category` and `{ id, version }` experience preset
metadata. JSON v1 remains importable and defaults to General/Focus with a visible validation
warning. `POST /v1/sessions` may carry a one-session preset override and presenter-sound choice;
its returned snapshot contains the frozen validated theme.

Interaction list endpoints use opaque cursor pagination and accept at most 50 rows. Mutations use
idempotency keys—inside the validated Pulse/chat body where specified, otherwise in
`x-idempotency-key`. A durable acknowledgement includes the newly allocated audience sequence.
Presenter credentials are read-only. Chat begins disabled, supports only plain text, and limits
replies to one level. Private-at-creation aliases remain anonymous on every non-moderator read even
after the current identity setting changes.

Participant summaries return only that participant’s own current signal. Public/presenter signal
counts are null until five unique participants have signalled in the current context. Host/cohost
summaries additionally include participant activity and moderation projection but never individual
answer content or correctness while a checkpoint is open.

## Q&A APIs

- `GET|POST /v1/sessions/{id}/qna/questions`
- Reply creation under `/v1/sessions/{id}/qna/questions/{questionId}/replies`
- Vote add/remove under a question
- Question moderation under `/v1/sessions/{id}/qna/questions/{questionId}`
- Reply moderation under `/v1/sessions/{id}/qna/replies/{replyId}`
- Creator/staff Q&A settings routes under the session

Lists use cursor pagination. Questions use `pending | published | answered | dismissed | removed`;
replies use `pending | published | removed`. Stable errors include `QNA_DISABLED`,
`MODERATION_REQUIRED`, and `QNA_RATE_LIMITED`. Unique participant votes, sanitization, limits,
moderation, kick/ban, retention, export, and deletion are enforced server-side.

## Reports and self-paced practice APIs

- `GET /v1/sessions/{id}/report`
- `GET /v1/reports` — tenant-scoped recovery-oriented result summaries; filters are
  `status=pending|ready|failed`, `quizId`, `from`, and `to`.
- `GET /v1/reports/{id}`
- `GET /v1/reports/{id}.csv`
- `GET /v1/reports/{id}.json`
- `GET /v1/reports/{id}/interactions`
- `GET /v1/reports/{id}/interactions.csv`
- `POST /v1/reports/{id}/followups`
- `POST /v1/quizzes/{id}/practice-assignments` — create an immutable standalone assignment from
  the reviewed published version identified by the required `sourceQuizVersionId`; returns `409`
  if that version is no longer current, and returns the generic link and any requested labelled
  one-attempt links exactly once.
- `GET /v1/followups` — tenant-scoped recovery-follow-up and standalone-assignment summaries and
  attempt counts; filters are
  `status=scheduled|open|closed|expired`, `quizId`, `from`, and `to`.
- `GET /v1/followups/{id}` — creator view, immutable Round/version context, aggregate progress, and
  access management; bearer tokens and answer bodies are never returned.
- `POST /v1/followups/{id}/personal-passes` — create a labelled, revocable, single-attempt link for
  a standalone assignment; the bearer URL is returned exactly once.
- `POST /v1/followups/{id}/accommodation-passes`
- `DELETE /v1/followups/{id}/access/{accessId}`
- `POST /v1/followups/{id}/close`
- `POST /v1/followups/{id}/start`
- `GET /v1/followups/{id}/snapshot`
- `POST /v1/followups/{id}/answers`
- `POST /v1/followups/{id}/advance`

Finished rounds create pending versioned reports. Until the worker completes, export returns a
conflict with an actionable “still being generated” message. Report v3 derives from durable rows,
not cached historical state, and adds the frozen experience plus aggregate Pulse, chat, reaction,
report, and moderation evidence. Report v1/v2 remain renderable. The standard report omits raw
chat and participant-level signals; the transcript requires report access, CSV follows the export
entitlement, and revealing removed bodies additionally requires owner/editor audit access.

Practice start accepts a generic, personal, or accommodation bearer and returns the credential to
use for that attempt. Generic access receives a separate client- or server-generated resume
credential. A personal or accommodation bearer is also its attempt credential so repeated starts
deterministically resume its one allowed attempt. Attempt answer and advance calls require the
returned credential. Generic links create unpaired anonymous attempts. Standalone assignments
clone only the published version's main questions: linked conditional rechecks stay in the live
Recovery Loop and are not made unconditional practice. All timing, resume, completion,
idempotency, revocation, and expiry are server-owned.

The session, report, and follow-up history endpoints return `{ items, nextCursor }`, default to 25
rows, cap at 50, and order by `(createdAt DESC, id DESC)`. Cursors are opaque base64url values;
malformed cursors return a validation error. These endpoints expose summaries only—never answer
bodies, aliases, chat content, or state snapshots. Report detail keeps the versioned `report` and
adds Round/session context (`quizId`, `quizTitle`, `sessionCreatedAt`, `sessionUpdatedAt`) when
available. Recovery-follow-up creation accepts ready Report V2 and Report V3 evidence. Standalone
assignment creation and personal-link issuance require the independent practice-assignment beta
feature plus the workspace beta allowlist; existing practice remains manageable and answerable if
that creation switch is later disabled.

## Billing APIs

- `GET /v1/billing/status`
- `POST /v1/billing/checkout`
- `POST /v1/billing/portal`
- `POST /v1/webhooks/stripe`

Stripe webhooks require a verified signature and apply provider event identity plus event ordering
idempotently before changing entitlements. Billing remains disabled in community mode.

## Realtime interface

Every server message carries `eventId`, `sessionId`, `sessionVersion`, `seq`, `type`,
`schemaVersion`, `serverTime`, and a validated role-filtered `payload`.

Required client messages are:

- `session.join`
- `answer.submit`
- `host.command`
- `sync.request`

Principal server messages are:

- `lobby.updated`
- `question.open`
- `question.locked`
- `question.reveal`
- `leaderboard.updated`
- `session.snapshot`
- `game.finished`
- `qna.question.*`, `qna.reply.*`, and `qna.vote.updated`

Client acknowledgements return `{ data }` or `{ error: { code, message } }`. An answer uses the
canonical versioned response payload plus confidence; legacy `choiceId` remains accepted for
single-select/true-false clients and is canonicalized. Keep idempotency keys until acknowledged.

After reconnect, send `sync.request` with the last observed sequence. The response includes a
role-filtered authoritative snapshot, bounded replay metadata, and `replayComplete`. Treat the
snapshot as authoritative whenever the journal cannot cover the full gap.

Audience interaction uses an independent `audienceSeq` and envelope with `eventId`, `sessionId`,
`schemaVersion`, `serverTime`, `type`, and role-filtered payload. Server events are:

- `audience.settings.updated`
- `audience.signal.updated` for host/cohost projection only
- `audience.summary.updated`, coalesced for public aggregate projection
- `chat.message.created|updated|removed|pinned`
- `chat.reaction.updated`
- `audience.moderation.updated`
- `audience.event`, carrying sequenced `qna.*` envelopes during the compatibility release

Send `audience.sync.request` with the last audience cursor after reconnect or a gap. The response
contains current settings, visible recent messages, aggregate signal state, the participant’s own
signal where applicable, and moderation state. Clients deduplicate at-least-once delivery by
`eventId`. Existing direct `qna.*` notifications remain available for compatibility while the same
committed Q&A changes also advance the audience cursor through `audience.event`.

## Stable errors

Core stable errors include `INVALID_CODE`, `SESSION_FULL`, `SESSION_LOCKED`,
`NICKNAME_REJECTED`, `STALE_VERSION`, `ANSWER_LATE`, `ANSWER_INVALID`, `ENTITLEMENT_LIMIT`,
`UNAUTHORIZED`, and `RATE_LIMITED`, plus the Q&A, follow-up, portability, and authoring errors
described above.

Experience/audience errors add `THEME_NOT_FOUND`, `THEME_VERSION_UNSUPPORTED`,
`INTERACTIONS_DISABLED`, `CHAT_DISABLED`, `CHAT_MUTED`, `CHAT_RATE_LIMITED`,
`CHAT_CAPACITY_REACHED`, `AUDIENCE_BANNED`, `SIGNAL_RATE_LIMITED`, `MESSAGE_REMOVED`,
`INVALID_REACTION`, and `AUDIENCE_SYNC_REQUIRED`.

## Administrative APIs

- `GET|PATCH /v1/admin/features`
- `PUT /v1/admin/workspaces/{id}/institution-policy`
- `POST /v1/admin/workspaces/{id}/lti-registrations`
- `PUT /v1/admin/workspaces/{id}/lti-registrations/{registrationId}`
- `POST /v1/admin/retention/run`
- `GET /v1/admin/sessions/by-code/{code}`

They require the configured `ADMIN_TOKEN`, are audited, and must never be called from public
browser code.

Institution errors add `INSTITUTION_NOT_ENABLED`, `INSTITUTION_AUTH_REQUIRED`,
`FEDERATED_AUTH_DISABLED`, `FEDERATED_IDENTITY_NOT_LINKED`, `FEDERATED_AUTH_REPLAYED`,
`LTI_DISABLED`, `LTI_REGISTRATION_NOT_FOUND`, and `LTI_LAUNCH_INVALID`. See the
[institution integration guide](institution-integrations.md) for callback URLs, registration
fields, and pilot gates.

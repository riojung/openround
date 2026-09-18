# API and realtime reference

REST endpoints are versioned under `/v1`. Shared Zod schemas validate HTTP, realtime,
environment, persisted-version, and webhook boundaries. Errors use:

```json
{ "error": { "code": "STABLE_CODE", "message": "Actionable explanation", "requestId": "..." } }
```

Creator routes use the secure HttpOnly creator cookie. Session, staff, presenter, participant,
embed, and follow-up routes use their own scoped credentials as documented by the returned flow.

## Service and feature APIs

- `GET /health/live` — process liveness.
- `GET /health/ready` — active PostgreSQL and Redis-compatible checks; returns 503 without secret
  connection detail when either is unavailable.
- `GET /v1/features` — public URL, edition mode, and effective
  signup/session/media/experience/Pulse/chat switches.
- `GET /metrics` — private Prometheus output when enabled and authorized.

## Authentication, workspaces, and account

- `POST /v1/auth/magic-link`
- `GET /v1/auth/verify?token=...`
- `GET /v1/auth/me` — creator/workspace context, entitlements, branding, and workspace-resolved
  `productFeatures` after the partner allowlist and global switches are applied.
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

- `GET|POST /v1/quizzes`; `GET` accepts `archived=true`.
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

- `POST /v1/sessions`
- `POST /v1/sessions/join`
- `GET /v1/sessions/{id}/snapshot?role=...`
- `POST /v1/sessions/{id}/commands`
- `POST /v1/sessions/{id}/answers`
- `DELETE /v1/sessions/{id}`
- Session staff credential creation/list/revocation routes under `/v1/sessions/{id}/staff`
- Presenter/embed policy issuance under the session routes
- `GET /v1/embed/policies/{sessionId}/{policyKey}`

Host commands carry `commandId` and `expectedVersion`. Recovery actions include
`intervention.start`, `intervention.finish`, and `recheck.open`; the engine validates when peer
discussion, explain/example/break, linked recheck, or revote is legal. A dedicated presenter or
embed credential is read-only and never reuses the host token.

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

## Reports and self-paced follow-up APIs

- `GET /v1/sessions/{id}/report`
- `GET /v1/reports/{id}`
- `GET /v1/reports/{id}.csv`
- `GET /v1/reports/{id}.json`
- `GET /v1/reports/{id}/interactions`
- `GET /v1/reports/{id}/interactions.csv`
- `POST /v1/reports/{id}/followups`
- `GET /v1/followups/{id}` — creator view and access management.
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

Follow-up start accepts a generic/personal bearer and returns a separate attempt credential.
Attempt answer and advance calls require that attempt bearer. Personal links allow one attempt by
default; generic links create unpaired anonymous attempts. All timing, resume, completion,
idempotency, revocation, and expiry are server-owned.

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

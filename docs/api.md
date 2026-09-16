# API and realtime reference

All REST bodies and realtime payloads are validated by the schemas in `packages/contracts`. REST errors use `{ error: { code, message, requestId } }`.

## Service and feature APIs

- `GET /health/live` reports process liveness; `GET /health/ready` reports the configured storage
  and media-scanning posture.
- `GET /v1/features` returns `publicWebUrl`, the public community/billing mode, and signup,
  session-creation, and media-upload switches used by the UI. The values combine deployment
  capability ceilings with the current database-backed runtime switches. Host and presenter
  surfaces use the public URL to build prefilled direct links and QR codes.
- `GET /metrics` emits Prometheus text when enabled. It is intentionally not proxied by the
  included Caddy configuration. If it is exposed on another private route, set `METRICS_TOKEN`
  and use a bearer token.

## Creator authentication

- `POST /v1/auth/magic-link` accepts `email`, `segment`, and `acceptPolicies: true`. The server
  records Terms and Privacy consent using its configured `POLICY_VERSION` when the link is used.
- `GET /v1/auth/verify?token=...` consumes the link, sets an HttpOnly creator cookie, and redirects to the dashboard.
- `GET /v1/auth/me` returns the creator, active workspace, and authoritative entitlements:
  participant ceiling, published-quiz ceiling, report-retention days, and CSV availability.
- `POST /v1/auth/logout` revokes the creator session.

## Quiz APIs

- `GET|POST /v1/quizzes`; `GET` accepts `archived=true` to include archived records.
- `GET|PATCH /v1/quizzes/{id}`
- `POST /v1/quizzes/{id}/publish`; first publication enforces the hosted plan's published-quiz
  ceiling. Republishing an existing slot remains allowed.
- `POST /v1/quizzes/{id}/duplicate`
- `POST /v1/quizzes/{id}/archive` accepts `{ "archived": true|false }` for archive and restore.

## Media APIs

- `POST /v1/media` validates JPEG, PNG, or WebP metadata, a maximum size of 10 MB, and required
  alt text, then creates a pending record and ten-minute signed quarantine upload.
- `POST /v1/media/{id}/complete` verifies stored metadata, actual byte length, file signature, and
  malware scan. A clean object is promoted out of quarantine; rejected objects are deleted.
- `GET /v1/media/{id}` gives its owning creator a five-minute signed clean-object URL.
- `GET /v1/sessions/{sessionId}/media/{mediaId}` gives an authorized host, presenter, or
  participant a signed URL only when the frozen session version references that clean asset.

Pending and rejected objects are eligible for scheduled cleanup after
`MEDIA_QUARANTINE_RETENTION_HOURS`. New image uploads return 503 when storage/scanning is not
configured or the runtime switch is paused; pending completion remains available so already
quarantined data can be resolved. Pending and rejected objects are never returned by a read
endpoint.

## Session and report APIs

- `POST /v1/sessions` creates a session from the current immutable quiz version.
- `POST /v1/sessions/join` accepts a code and nickname or a resume token.
- `GET /v1/sessions/{id}/snapshot?role=...` uses a participant or host bearer credential.
- `POST /v1/sessions/{id}/commands` is the HTTP host-command fallback.
- `POST /v1/sessions/{id}/answers` is the HTTP answer fallback.
- `DELETE /v1/sessions/{id}` deletes an owned session and dependent participant data.
- `GET /v1/sessions/{id}/report` recovers a finished session's report and current entitlements after
  host refresh.
- `GET /v1/reports/{id}` returns the report, its stored expiry, and current entitlements.
- `GET /v1/reports/{id}.csv` streams UTF-8 CSV for Pro/Team and ungated community deployments;
  hosted Free receives `ENTITLEMENT_LIMIT`.

Live host/participant access expires after 24 hours without deleting durable results. The session,
participants, answers, and report share one stored purge deadline: 30 days from finish for hosted
Free, 365 days for hosted Pro/Team, or `COMMUNITY_REPORT_RETENTION_DAYS` for self-hosting. The
scheduled/admin retention run first closes expired live access, then purges data whose retention
deadline has passed.

## Billing and account APIs

- `GET /v1/billing/status`
- `POST /v1/billing/checkout`
- `POST /v1/billing/portal`
- `POST /v1/webhooks/stripe`
- `GET /v1/account/theme` returns the stored workspace theme and whether the current deployment/
  plan may apply it.
- `PUT /v1/account/theme` validates and saves one organization name, background colour, and action
  colour for Pro/Team or community workspaces. Both colours require 4.5:1 contrast with white.
- `DELETE /v1/account/theme` removes a stored theme, including after a plan downgrade.
- `GET /v1/account/export`
- `DELETE /v1/account` with `{ "confirmation": "DELETE" }`

Account export includes profile, workspace, quiz drafts and versions, media metadata, sessions,
participants, answers, reports, billing state, consent records, and audit records. Host and
participant token hashes are excluded. Account deletion removes private media objects before the
workspace rows and invalidates in-memory and Redis session state; it fails closed if those
dependencies cannot be cleared.

## Realtime interface

Required client events are `session.join`, `answer.submit`, `host.command`, and `sync.request`. Server events are `lobby.updated`, `question.open`, `question.locked`, `question.reveal`, `leaderboard.updated`, `game.finished`, and `session.snapshot`.

Every server event includes `eventId`, `sessionId`, `sessionVersion`, `seq`, `type`, `schemaVersion`,
`serverTime`, and role-filtered `payload`. The browser immediately invokes the optional Socket.IO
acknowledgement callback on each server event so receipt latency and timeouts can be measured; the
callback carries no application data and does not replace sequence-based recovery. Client-event
acknowledgements return either `{ data }` or `{ error: { code, message } }`.

Clients must retain answer idempotency keys until acknowledged and issue `sync.request` after every
reconnect with their last observed sequence. The acknowledgement contains the current
role-filtered `snapshot`, bounded `replay` entries after that sequence, and `replayComplete`.
Clients must treat the snapshot as authoritative whenever the bounded journal cannot cover the
whole gap. They must not infer acceptance from a button state or local countdown.

Host commands include `commandId`, `expectedVersion`, and `action`. A `kick` command also
requires `participantId`. Snapshots expose `lobbyLocked`; participant snapshots never expose
another participant's private result. `brandTheme` is either `null` or the contrast-validated theme
frozen when that session was created; later workspace edits cannot alter an active room.

## Administrative APIs

- `GET /v1/admin/features` returns configured ceilings, persisted runtime values, effective values,
  and the last update time.
- `PATCH /v1/admin/features` accepts a nonempty partial object containing `signups`,
  `sessionCreation`, and/or `mediaUploads`. The update and its audit event commit atomically.
- `POST /v1/admin/retention/run` runs expiry and quarantine cleanup.
- `GET /v1/admin/sessions/by-code/{code}` returns a support-safe session lookup.

All require the configured `ADMIN_TOKEN` as a bearer token. Administrative actions are audited;
the token must never be shared with browser clients.

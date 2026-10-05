# Independent security review record

- Date/time (UTC):
- Build commit and image digest:
- Environment and scope:
- Reviewer/vendor, qualifications, and independence from implementation:
- Methodology:
- Threat-model version and checksum (`docs/threat-model.md` plus candidate-specific amendments):
- Architecture/data-flow version and checksum:
- Explicit exclusions and rationale:
- Automated security workflow URLs (supporting evidence only):

## Assets and trust boundaries

Before testing, freeze the in-scope asset and trust-boundary inventory. At minimum it must cover
creator sessions, participant/host/companion credentials, workspace and report data, live event
ordering, PostgreSQL, Valkey, private media/quarantine, SMTP, Stripe, telemetry, backups, the
public Caddy boundary, operator/admin access, and the deployment/release path. Record every
provider boundary, privileged identity, public origin, and disabled feature that is excluded from
the candidate. A repository scan alone is not an independent security review.

## Required scope

- Creator authentication, cookie attributes, token expiry/revocation, and logout
- Workspace and database row isolation
- Host, presenter, participant, and administrator authorization
- WebSocket origin, authentication, replay, payload limit, and reconnect behavior
- Deadline, answer idempotency, stale-command, and score-integrity attacks
- XSS, injection, CSRF/origin, code enumeration, and rate limiting
- Signed upload, file signature, quarantine, malware scanning, and private media delivery
- Stripe signature, ordering, retry, and entitlement reconciliation
- Secret handling, logs, metrics, traces, container identity, and provider network boundaries
- Account export, deletion, retention, audit, backup, and restore behavior
- Archived Library deletion: current owner/tenant checks, archived-state and dependency races,
  retained practice preservation, all-user favorite/Group/media-reference cleanup, and runtime
  privilege boundaries after migration 048
- Finished/expired Presentation session deletion: active-room refusal, socket/credential invalidation,
  concurrent join/response/report-worker fencing, room-code release, and stale reconnects
- Question Health: dismissal content/rule binding, revision-fenced apply/undo, exact-version and
  cohort/sample isolation, bounded field-diff export/deletion, and no participant data in AI prompts
- Decision Replay: frozen capture gate, strict aggregate-only event payload, atomic/idempotent
  capture, event-limit marker, legacy availability, and session/report retention/deletion
- Presentation v2: malformed IDs/regions/frames and element bounds, published-version immutability,
  read-upcast compatibility, and projection-safe media/notes/citations

## Findings and decision

Use the reviewer's documented severity rubric. **Critical** includes practical cross-tenant or
administrator compromise, secret/signing-key loss, or broad sensitive-data disclosure. **High**
includes practical unauthorized durable mutation, participant/creator impersonation, stored XSS,
private-media disclosure, signature bypass, or a release/deployment boundary bypass with material
impact. Map other findings to the reviewer's medium/low/informational definitions and retain the
mapping with the evidence.

| Finding ID | Asset/trust boundary | Severity | Reproduction/evidence | Status  | Fix/retest evidence |
| ---------- | -------------------- | -------- | --------------------- | ------- | ------------------- |
| None yet   | —                    | —        | —                     | Pending |                     |

- Open critical/high findings:
- Medium/low risk acceptances, accountable approver, and expiry:
- Scope exclusions reviewed and accepted (yes/no):
- Reviewer decision (accepted/rejected/pending): Pending
- Retest date/evidence:

The gate passes only when the frozen scope is complete, the reviewer is independent, every finding
has a final disposition, **zero critical or high findings remain open or risk-accepted**, and the
reviewer records `Accepted`. A compensating control must be retested; merely assigning an owner or
future date does not close a critical/high finding.

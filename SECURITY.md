# Security policy

## Supported versions

OpenRound has not published its first release, so no version is currently supported for production
use. Pre-release security fixes land on `main`. After releases begin, only the latest tagged minor
release will receive fixes during the pre-1.0 period. Operators should pin immutable image digests
and subscribe to repository security advisories.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Report it through
[GitHub private vulnerability reporting](https://github.com/riojung/openround/security/advisories/new)
so maintainers can investigate and coordinate a fix before disclosure. Include the affected
version or commit, reproduction steps, impact, and any suggested remediation. OpenRound is a
pre-release project and does not currently promise a response or remediation SLA.

## Production requirements

- Replace all example credentials, keep PostgreSQL and Valkey on the internal Compose network, and
  store the active single-VM secret files outside source control with mode `0600`. Back them up only
  through the encrypted off-host operations process; never place them in image layers, manifests,
  logs, or deployment receipts.
- Use TLS for every public and service connection.
- Run the application with a non-owner PostgreSQL role and test row-level-security policies with `app.workspace_id` set inside each tenant transaction.
- Keep object storage private. A signed upload is not publishable until MIME, size, malware, and ownership checks mark the asset clean.
- Keep the enforced per-request nonce Content Security Policy enabled. Inline script attributes,
  objects, frames, and foreign form actions are denied; inline styles remain allowed because the
  P0 interface uses React style properties. Narrow the intentionally broad HTTPS image/connect
  allowances when storage and telemetry origins become immutable, and verify the final policy in
  the independent review.
- Rotate host, SMTP, storage, Stripe, database, Redis, and administrator secrets through the documented procedure.
- Run dependency, container, secret, SAST, origin, replay, authorization, XSS, upload, and denial-of-service checks before each paid release.
- Arrange an external penetration test before broad institutional sales.

## Known pre-release limitations

- The base Compose profile intentionally disables image uploads. The `compose.media.yaml` overlay
  attaches ClamAV and enables the implemented quarantine, file-signature, size, malware scan,
  clean-object promotion, and private signed-delivery path. Production operators must monitor
  signature updates and scanner availability and must test the chosen object store's CORS policy.
- The Socket.IO Redis Streams adapter, owner-fenced Redis mutation leases, and PostgreSQL
  compare-and-swap writes protect shared-state correctness, and local two-writer/process-loss tests
  pass. The launch topology still intentionally uses one active realtime process until the hosted
  load balancer, rolling deploy, managed Redis failover, and target-region tests are evidenced.
- Prometheus output, OTLP export, validated collector and Alertmanager templates, and routing tests
  are available. This repository does not operate the hosted collector or paging accounts and
  cannot establish that a production alert reached a named human responder.
- Legal notices are placeholders pending qualified counsel review for the selected launch markets.

# Security policy

## Supported versions

Only the latest tagged minor release receives security fixes during the pre-1.0 period. Production operators should pin immutable image digests and subscribe to repository security advisories.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Before public release, replace this paragraph with a monitored security email or private advisory workflow, acknowledgement target, remediation target, and safe-harbour statement.

## Production requirements

- Replace all example credentials, restrict database and Redis networking, and store secrets in the deployment platform's secret manager.
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
- Legal notices are placeholders pending Canadian and US counsel review.

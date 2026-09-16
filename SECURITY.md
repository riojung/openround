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
- Configure a strict production Content Security Policy after enumerating Stripe and storage origins.
- Rotate host, SMTP, storage, Stripe, database, Redis, and administrator secrets through the documented procedure.
- Run dependency, container, secret, SAST, origin, replay, authorization, XSS, upload, and denial-of-service checks before each paid release.
- Arrange an external penetration test before broad institutional sales.

## Known pre-release limitations

- The base Compose profile intentionally disables image uploads. The `compose.media.yaml` overlay
  attaches ClamAV and enables the implemented quarantine, file-signature, size, malware scan,
  clean-object promotion, and private signed-delivery path. Production operators must monitor
  signature updates and scanner availability and must test the chosen object store's CORS policy.
- The Socket.IO Redis Streams adapter is wired when `REDIS_URL` is set, but game mutation
  ownership remains process-local. The launch topology therefore intentionally uses one active
  realtime process. Do not add a second writer until distributed mutation serialization, sticky
  sessions, rolling-deploy, and process-loss tests pass.
- Prometheus output and OTLP export are available, but this repository does not provide a hosted
  collector, paging integration, or evidence that production alerts have been rehearsed.
- Legal notices are placeholders pending Canadian and US counsel review.

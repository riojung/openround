# Canadian Fly deployment profile

The checked-in TOML files are a safe starting profile, not proof of a production deployment. The
API starts with sign-ups and metrics disabled, and it never receives the owner-level database
credential used for migrations.

1. Choose the final app names and HTTPS domains. Update `app`, `WEB_ORIGIN`, `PUBLIC_API_URL`, and
   the web image's `NEXT_PUBLIC_API_URL` build argument together.
2. Provision PostgreSQL and private object storage in `ca-central-1`, plus managed Redis in Toronto.
   Create a non-owner PostgreSQL runtime role using `infra/postgres/001-runtime-role.sql`.
3. Load runtime secrets into the server app: `DATABASE_URL`, `REDIS_URL`, SMTP, S3, Stripe, and a
   random `ADMIN_TOKEN`. Do not give the server app `DATABASE_MIGRATION_URL`.
4. Validate the exact candidate image and environment before migration. The command prints public
   URLs, feature flags, limits, and configured modes, but never secret values:

   ```bash
   docker run --rm --env-file ./server.env \
     ghcr.io/OWNER/REPOSITORY/openround-server:VERSION node dist/config-check.js
   ```

5. Before deploying an application image, run its one-shot migration command from a restricted
   CI or maintenance environment with only `DATABASE_MIGRATION_URL` available:

   ```bash
   docker run --rm --env-file ./migration.env \
     ghcr.io/OWNER/REPOSITORY/openround-server:VERSION node dist/migrate.js
   ```

   `migration.env` must be mode `0600`, excluded from version control, and deleted after the run.
   Pin the image by digest for production. The migration is forward-only and safe to rerun.

6. Deploy one always-on server machine and the web app. `/health/live` proves only that the process
   responds; `/health/ready` performs PostgreSQL and Redis checks and must pass before routing
   traffic. Then run the protected `Staging readiness` workflow.
7. Configure a private collector from `infra/observability/otel-collector.example.yml`, install
   owned alert routes from `alertmanager.example.yml`, and set a random `METRICS_TOKEN` before changing
   `METRICS_ENABLED=true`. Configure and test SMTP before changing `FEATURE_SIGNUPS=true`.
8. Keep one realtime process until sticky routing, two-writer process loss, target-region load,
   managed Redis failover, and database restore exercises pass.
9. Before enabling Audience Pulse or chat, confirm migration `011_audience_interactions.sql` is in
   the ledger, the audience outbox relay is running, outbox backlog/lag and audience sync fallback
   metrics are scraped, and the [moderation rehearsal](../../docs/runbooks/audience-moderation.md)
   passes. Promote presets, Pulse, and chat with independent workspace/global feature flags; a
   successful answer-load test alone is not interaction-capacity evidence.
   `THEMED_INTERACTIONS_WORKSPACE_ALLOWLIST` accepts comma-separated workspace UUIDs for partner
   rollout. Keep the relevant `FEATURE_ROUND_EXPERIENCES`, `FEATURE_AUDIENCE_PULSE`, or
   `FEATURE_ROOM_CHAT` startup ceiling disabled until that capability's gate passes; the audited
   `/v1/admin/features` controls can pause each capability without a restart but cannot override a
   disabled startup ceiling.

The example `fly.dev` domains match the checked-in app names. Replace them if those names are not
available or custom domains are used. Never enable `ALLOW_INSECURE_LOCAL_HTTP` in this profile.
See `docs/runbooks/staging-readiness.md` for GitHub environment variables, synthetic-account
isolation, redacted artifacts, and the Stripe rehearsal boundary.

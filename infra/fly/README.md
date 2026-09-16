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
4. Before deploying an application image, run its one-shot migration command from a restricted
   CI or maintenance environment with only `DATABASE_MIGRATION_URL` available:

   ```bash
   docker run --rm --env-file ./migration.env \
     ghcr.io/OWNER/REPOSITORY/openround-server:VERSION node dist/migrate.js
   ```

   `migration.env` must be mode `0600`, excluded from version control, and deleted after the run.
   Pin the image by digest for production. The migration is forward-only and safe to rerun.

5. Deploy one always-on server machine and the web app. Verify `/health/ready`, then run the
   synthetic creator-to-report flow before routing pilot traffic.
6. Configure a private collector and set a random `METRICS_TOKEN` before changing
   `METRICS_ENABLED=true`. Configure and test SMTP before changing `FEATURE_SIGNUPS=true`.
7. Keep one realtime process until sticky routing, two-writer process loss, target-region load,
   managed Redis failover, and database restore exercises pass.

The example `fly.dev` domains match the checked-in app names. Replace them if those names are not
available or custom domains are used. Never enable `ALLOW_INSECURE_LOCAL_HTTP` in this profile.

# Upgrade and rollback runbook

1. Read release notes and verify the image digest, signature, SBOM, and vulnerability report.
2. Back up PostgreSQL and confirm a recent restore exercise.
3. Apply expand-only schema changes with the owner-only `DATABASE_MIGRATION_URL`. Keep the
   application `DATABASE_URL` on a non-owner role granted `openround_runtime`, and verify forced
   row-level security with the production-like integration test. New code must tolerate both old
   and new columns during the deployment window. The published server image exposes the one-shot
   `node dist/migrate.js` command; run it from a restricted maintenance job and never place
   `DATABASE_MIGRATION_URL` in the long-lived server environment.
4. Deploy to staging and run the synthetic creator, host, three-player, reconnect, finish, report, and deletion flow.
5. Promote one canary, check error rate, event-loop lag, acknowledgement latency, reconnects, database pool, Redis latency, and reconciliation.
6. Promote production only when thresholds remain normal.
7. Roll back by deploying the prior immutable image. Do not reverse a destructive database migration; use the documented forward repair.
8. Contract or remove old schema only in a later release after every running version has stopped using it.

# Backup and restore runbook

## Objectives

Creator content has an initial RPO of 24 hours and RTO of four hours. Accepted answers are committed immediately to PostgreSQL. Redis and Valkey are rebuildable accelerators rather than the durable record.

## Backup

1. Enable provider-managed daily backups and point-in-time recovery before paid beta.
2. Export encrypted logical backups to a separate account or project on a tested schedule.
3. Version object storage and test media restoration.
4. Record backup completion, size, checksum, region, encryption key, and expiry without recording customer content in operational tickets.

For community PostgreSQL, run `pg_dump --format=custom --no-owner --file=openround.dump "$DATABASE_URL"` from a restricted maintenance environment. Never place credentials in shell history or backup filenames.

With the full local media Compose profile running, `pnpm smoke:restore` creates a custom-format
logical dump inside the PostgreSQL container, restores it into a randomly named isolated database,
and compares row counts plus full-row hashes across all durable tables. It also creates, copies,
deletes, restores, and byte-compares a synthetic object under a unique MinIO key. The temporary
database, dump, alias, and objects are removed even when an assertion fails. This verifies the
mechanics only; it does not prove provider backup availability, cross-account isolation,
encryption, jurisdiction, or the four-hour RTO.

## Restore exercise

1. Declare an exercise or incident and freeze destructive maintenance.
2. Create isolated replacement database and storage resources in the same jurisdiction.
3. Restore the selected backup and apply only forward-compatible migrations newer than the backup.
4. Validate row counts, quiz content hashes, accepted-answer uniqueness, report reconciliation, and sample media checksums.
5. Point a staging server at the restored resources and complete a synthetic game.
6. During an incident, change production routing only after the incident commander approves it.
7. Rotate affected credentials, document actual RPO/RTO, and delete exercise data under the retention policy.

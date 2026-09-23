# Backup and restore runbook

## Objectives

Creator content has an initial RPO objective of 24 hours and an RTO objective of four hours.
Accepted answers are committed immediately to PostgreSQL. Valkey is a rebuildable accelerator,
while PostgreSQL and MinIO contain durable data that must be recoverable together.

The active staging and production topology places PostgreSQL, Valkey, MinIO, and the application on
one VM. Local Docker volumes are therefore one failure domain, not backups. The RPO/RTO objectives
remain unproven until encrypted copies have left the VM and a timed restore has succeeded on a
clean replacement VM. The topology has no automatic failover, high availability, or SLA.

## Backup

1. Run a PostgreSQL custom-format logical dump at least often enough to meet the approved RPO.
   Never copy the live PostgreSQL volume as the database backup.
2. Export the private MinIO bucket with object metadata and verify its inventory against the
   database media references.
3. Encrypt the database dump, object backup, and the minimum non-secret deployment inventory before
   transfer. Store them off-host in a separately administered account or system; a second path or
   volume on the same VM does not qualify.
4. Retain multiple generations under an approved retention policy and restrict decrypt access to
   named operators. Keep the encryption key outside both the application VM and backup payload.
5. Record completion time, source build, size, checksum, object count, storage location,
   encryption-key identifier, and expiry without copying customer content into operational tickets.
6. Alert on a missed or unverifiable backup and stop promotion when the newest recoverable set is
   older than the approved RPO.

Run `pg_dump --format=custom --no-owner --file=openround.dump "$DATABASE_URL"` from a restricted
maintenance environment using the least-privileged credential that can read every required table.
Never place credentials in shell history, process arguments, backup filenames, or logs. Verify the
dump with `pg_restore --list` before encrypting and transferring it.

With the full local media Compose profile running, `pnpm smoke:restore` creates a custom-format
logical dump inside the PostgreSQL container, restores it into a randomly named isolated database,
and compares row counts plus full-row hashes across all durable tables. It also creates, copies,
deletes, restores, and byte-compares a synthetic object under a unique MinIO key. The temporary
database, dump, alias, and objects are removed even when an assertion fails. This verifies local
mechanics only; it does not prove off-host isolation, encryption, replacement-host recovery, the
24-hour RPO, or the four-hour RTO.

## Restore exercise

1. Declare an exercise or incident and freeze destructive maintenance.
2. Provision a clean replacement VM from the approved baseline. Patch it, configure its firewall,
   install the supported Docker/Compose versions, create the restricted deployment account, and pin
   its SSH host key through an independently verified channel. Do not reuse the failed VM's host
   key or trust-on-first-use.
3. Retrieve and decrypt the selected off-host backup set without copying decryption keys into the
   repository or persistent release directory. Verify every recorded checksum before restoration.
4. Start fresh PostgreSQL and MinIO volumes, restore the database and objects, and apply only
   forward-compatible migrations newer than the backup. Valkey must start empty and rebuild from
   durable state.
5. Deploy the exact reviewed application-image digests and restore only reviewed non-secret
   configuration. Rotate application, database, object-storage, SMTP, administrative, and deploy
   credentials rather than cloning secrets from a suspected host.
6. Validate row counts, Round and Presentation hashes, accepted-answer uniqueness, report
   reconciliation, audit continuity, and sampled media checksums. Complete a synthetic live game,
   reconnect, report generation, and authorized media retrieval through the replacement VM's TLS
   endpoints.
7. Measure backup age, data loss, provisioning time, restore time, and end-to-end recovery time.
   The exercise passes only when the approved RPO and RTO are met without using the original VM.
8. During an incident, change public DNS or routing only after the incident commander approves it.
   Confirm certificate issuance, external health monitoring, and strict SSH host-key inventory for
   the replacement before opening traffic.
9. Rotate affected credentials, retain redacted evidence, and securely delete temporary plaintext
   backups and exercise resources under the approved retention policy.

At least one current clean replacement-VM drill is mandatory before public production. A local
database restore, volume snapshot, provider console screenshot, or restart of the original VM does
not satisfy this gate.

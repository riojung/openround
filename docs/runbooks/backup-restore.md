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
2. Export the private MinIO bucket with object metadata **and object tags**. Build a canonical
   inventory that binds each version/key to its byte checksum, size, metadata, and tags, retain a
   separate tag-inventory digest, and verify the inventory against the database media references.
   The `openround-finalization-state` tag is durable retention state, not optional metadata.
3. Encrypt the database dump, object backup, and the minimum non-secret deployment inventory before
   transfer. Store them off-host in a separately administered account or system; a second path or
   volume on the same VM does not qualify.
4. Retain multiple generations under an approved retention policy and restrict decrypt access to
   named operators. Keep the encryption key outside both the application VM and backup payload.
5. Record completion time, source build, size, checksum, object count, storage location,
   encryption-key identifier, and expiry without copying customer content into operational tickets.
6. Alert on a missed or unverifiable backup and stop promotion when the newest recoverable set is
   older than the approved RPO.

## Fail-closed backup identities

The checked-in single-VM initialization does **not** provision backup credentials. PostgreSQL's
`docker-entrypoint-initdb.d` scripts run only for a new volume, so changing
`infra/single-vm/postgres-init.sh` would not update existing deployments. The reconciled MinIO
initialization creates a bucket-scoped application identity with write/delete access, which is not a
least-privilege backup identity. Neither the database owner, MinIO root identity, application
database role, nor writable application object-store identity qualifies as the scheduled backup
principal.

Before enabling a backup job, provision both identities through a separately reviewed, audited
one-shot operation and store their credentials outside the repository, Compose environment, source
VM, and backup payload:

- PostgreSQL: a dedicated non-owner, non-superuser role with only `CONNECT`, schema `USAGE`, and
  `SELECT` on every durable table and sequence (including future relations). Because Polling Pops
  forces row-level security, a complete logical dump also needs narrowly controlled `BYPASSRLS`
  during the backup operation. It must not have create-role, create-database, replication, or write
  privileges. Verify the dump's durable table/row inventory against an owner-generated inventory;
  an RLS-filtered partial dump fails closed.
- Object storage: a dedicated identity limited to listing the private media bucket and reading
  current objects, metadata, **object tags**, and available versions. It must not write, delete,
  administer the service, or access another bucket. The separately administered destination needs
  a different write identity.

Record the redacted privilege-query/policy checksums in the backup manifest. If either identity is
missing, has broader privileges, cannot read the complete source set, or lacks independent review,
fail closed: do not run the job, do not substitute an owner/root/application credential, and do not
claim a recoverable backup.

Run `pg_dump --format=custom --no-owner --no-privileges --file=openround.dump "$DATABASE_URL"`
from the restricted maintenance environment, using `--role` when a separate `NOLOGIN BYPASSRLS`
group carries the reviewed read grants. Never place credentials in shell history, process
arguments, backup filenames, or logs. Verify the dump with `pg_restore --list` before encrypting and
transferring it.

With the full local media Compose profile running, `pnpm smoke:restore` creates a custom-format
logical dump inside the PostgreSQL container, restores it into a randomly named isolated database,
and compares row counts plus full-row hashes across all durable tables. It also creates, copies,
deletes, restores, and byte-compares a synthetic object under a unique MinIO key. The temporary
database, dump, alias, and objects are removed even when an assertion fails. This verifies local
mechanics only; it does not prove off-host isolation, encryption, replacement-host recovery, the
24-hour RPO, or the four-hour RTO.

## Machine-validated evidence

Use the provider-neutral
[backup/restore evidence schema](../evidence/backup-restore-evidence.schema.json) for two separate
redacted JSON documents held in the approved evidence system:

1. `openround-off-host-backup-manifest` binds one frozen source environment, host/failure domain,
   full Git commit, server/web image digests, snapshot cutoff, database dump, object inventory,
   object-tag inventory, and reviewed non-secret configuration artifact. It records plaintext and
   ciphertext SHA-256 values, authenticated-encryption/key-custody metadata, inventory
   checksums/counts, the separately administered off-host generation, least-privilege source
   identities, and owner/reviewer acceptance.
2. `openround-replacement-host-restore-receipt` repeats the canonical manifest/source-set binding,
   proves a clean replacement host and fresh data stores, matches the restored database/object
   inventories, records validation and cleanup checks, and carries separate owner/reviewer
   acceptance.

The JSON records may contain only redaction-safe identifiers, counts, checksums, and opaque `ref:`
handles. Keep object keys, customer content, credentials, private URLs, encryption material, and
direct identifiers out of them. Run:

```sh
node scripts/check-backup-restore-evidence.mjs \
  path/to/off-host-backup-manifest.json \
  path/to/replacement-host-restore-receipt.json
```

The validator recomputes the canonical source-set and manifest checksums, enforces exact
environment/build/artifact binding, validates source/destination failure-domain separation and the
same logical environment on the replacement host, rejects reuse of one content blob across
incompatible artifact roles, requires off-host retention through service validation, cleanup, and
both independent acceptances, checks least-privilege attestations, compares restored database,
object, metadata, and tag inventories, and calculates actual RPO as
`failureDeclaredAtUtc - snapshotCutoffAtUtc` and actual RTO as
`serviceValidatedAtUtc - failureDeclaredAtUtc`. Declared durations do not override timestamp
arithmetic. Passing validation does not authenticate evidence or complete the readiness gate; retain
the two document checksums, validator output, and human acceptance in the evidence record, then use
normal review to change the ledger.

## Restore exercise

### Deletion and restored data

Permanent Library/session deletion removes current application records and access; it does not
rewrite prior encrypted database/media backups or downloaded exports. Retain backup generations
only for the approved lifetime and limit access to named operators. The application has no
automatic journal that reapplies deletions to an older restored generation.

Before reopening a restored environment, reconcile approved deletion requests accepted after the
backup cutoff using the operator's protected records. Remove the affected session trees before
their archived sources, preserve assignment dependencies, and verify that deleted items, reports,
room codes, and credentials are inaccessible. Reconcile media references and orphan cleanup as
well; do not remove objects still referenced by retained content. Record counts and opaque request
references rather than deleted content. If the deletion set cannot be established, resolve that
privacy gap with the incident owner before traffic resumes.

### Execute the drill

1. Declare an exercise or incident and freeze destructive maintenance.
2. Provision a clean replacement VM from the approved baseline. Patch it, configure its firewall,
   install the supported Docker/Compose versions, create the restricted deployment account, and pin
   its SSH host key through an independently verified channel. Do not reuse the failed VM's host
   key or trust-on-first-use.
3. Retrieve and decrypt the selected off-host backup set without copying decryption keys into the
   repository or persistent release directory. Verify every recorded checksum before restoration.
4. Start fresh PostgreSQL and MinIO volumes, restore the database and objects with their exact
   metadata and tags, and restore the reviewed lifecycle configuration before opening traffic.
   Apply only forward-compatible migrations newer than the backup. Valkey must start empty and
   rebuild from durable state.
5. Deploy the exact reviewed application-image digests and restore only reviewed non-secret
   configuration. Rotate application, database, object-storage, SMTP, administrative, and deploy
   credentials rather than cloning secrets from a suspected host.
6. Validate row counts, Round and Presentation hashes, accepted-answer uniqueness, report
   reconciliation, audit continuity, sampled media checksums, and exact object tags. Confirm
   temporary finalization candidates remain lifecycle-expirable and committed winners do not carry
   the temporary tag. Complete a synthetic live game, reconnect, report generation, and authorized
   media retrieval through the replacement VM's TLS endpoints.
7. Measure backup age, data loss, provisioning time, restore time, and end-to-end recovery time.
   Declare the simulated failure time before retrieval. The exercise passes only when the computed
   RPO is at most 86,400 seconds and the end-to-end RTO is at most 14,400 seconds without using the
   original VM.
8. During an incident, change public DNS or routing only after the incident commander approves it.
   Confirm certificate issuance, external health monitoring, and strict SSH host-key inventory for
   the replacement before opening traffic.
9. Rotate affected credentials, retain redacted evidence, and securely delete temporary plaintext
   backups and exercise resources under the approved retention policy.

At least one current clean replacement-VM drill is mandatory before public production. A local
database restore, volume snapshot, provider console screenshot, or restart of the original VM does
not satisfy this gate.

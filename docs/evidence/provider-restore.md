# Off-host backup and replacement-host restore record

This is a redaction-safe review template, not evidence that the pending gate passed. Keep customer
content, object keys, credentials, private URLs, encryption material, and provider-console exports
in the approved private evidence system. Record only checksums and opaque `ref:` handles here.

Create an accepted `openround-off-host-backup-manifest` and
`openround-replacement-host-restore-receipt` using the
[machine-readable schema](backup-restore-evidence.schema.json), then run the validator documented in
the [backup/restore runbook](../runbooks/backup-restore.md).

## Evidence binding

- Exercise date/time (UTC):
- Operations owner role and acceptance reference: Pending
- Independent reviewer role, independence attestation, and acceptance reference: Pending
- Source environment and redacted host/failure-domain IDs:
- Full source Git commit and exact server/web image digests:
- Backup set ID and canonical source-set SHA-256:
- Backup manifest canonical SHA-256 and opaque evidence reference:
- Replacement-host restore ID and receipt canonical SHA-256/reference:
- Validator output SHA-256/reference:
- Recovery targets: RPO 86,400 seconds; RTO 14,400 seconds

## Backup manifest review

| Requirement                                                                                                           | Evidence reference | Result  |
| --------------------------------------------------------------------------------------------------------------------- | ------------------ | ------- |
| Dedicated PostgreSQL role is non-owner/non-superuser, read-only, and complete across forced RLS                       |                    | Pending |
| Dedicated source object identity is bucket-scoped read/list/version only                                              |                    | Pending |
| Database, object, and non-secret configuration artifacts use authenticated encryption                                 |                    | Pending |
| Encryption key is held outside the source host and backup payload                                                     |                    | Pending |
| Plaintext/ciphertext sizes and SHA-256 checksums are recorded                                                         |                    | Pending |
| Database restore-list, durable-row inventory, migration ledger, object inventory, and object-tag inventory are hashed |                    | Pending |
| Backup generation is immutable/versioned in a separately administered failure domain                                  |                    | Pending |
| Backup owner and independent reviewer accepted the exact manifest                                                     |                    | Pending |

## Exercise log

| UTC time | Action                                                                       | Result/evidence |
| -------- | ---------------------------------------------------------------------------- | --------------- |
|          | Declare simulated failure and select the manifest-bound restore set          | Pending         |
|          | Provision a clean replacement host and fresh PostgreSQL/object data          | Pending         |
|          | Verify ciphertext checksums, decrypt, and verify plaintext checksums         | Pending         |
|          | Restore PostgreSQL and compare durable-table/row inventory                   | Pending         |
|          | Restore private objects with exact metadata/tags and compare all inventories | Pending         |
|          | Apply compatible forward migrations and verify migration ledger              | Pending         |
|          | Verify answer uniqueness, report reconciliation, and audit continuity        | Pending         |
|          | Verify sampled media checksums and authorization                             | Pending         |
|          | Run a synthetic creator-to-report flow through replacement-host TLS          | Pending         |
|          | Start Valkey empty and verify rebuild from durable truth                     | Pending         |
|          | Delete plaintext, revoke temporary credentials, and remove resources         | Pending         |

- Snapshot cutoff (UTC):
- Failure declared (UTC):
- Service validated (UTC):
- Validator-computed actual RPO seconds: Pending
- Validator-computed actual RTO seconds: Pending
- Database/object/metadata/object-tag inventory mismatch: Pending
- Lifecycle configuration or finalization-tag preservation mismatch: Pending
- Data loss or other mismatch:
- Open blockers and issue URLs:
- Operations-owner decision: Pending
- Independent-reviewer decision: Pending

Do not attach these records to `docs/release-readiness.json` or mark `off-host-restore` complete
until both JSON documents validate, the owner and independent reviewer accept the exact checksums,
and the external replacement-host exercise actually meets both objectives.

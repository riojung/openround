import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCHEMA_REFERENCE = "./backup-restore-evidence.schema.json";
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._/-]{1,119}$/;
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const EVIDENCE_REFERENCE_PATTERN = /^(?:sha256:[a-f0-9]{64}|ref:[a-z0-9][a-z0-9._/-]{2,127})$/;
const ENCRYPTION_ALGORITHMS = ["age-x25519", "aes-256-gcm", "xchacha20-poly1305"];
const RPO_TARGET_SECONDS = 24 * 60 * 60;
const RTO_TARGET_SECONDS = 4 * 60 * 60;
const MAXIMUM_CLOCK_SKEW_MILLISECONDS = 5 * 60_000;

export class BackupRestoreEvidenceError extends Error {
  constructor(message) {
    super(message);
    this.name = "BackupRestoreEvidenceError";
  }
}

function invalid(path, message) {
  throw new BackupRestoreEvidenceError(`${path}: ${message}`);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function object(value, path) {
  if (!isObject(value)) invalid(path, "must be an object");
  return value;
}

function exactKeys(value, keys, path) {
  const actual = Object.keys(value);
  for (const key of actual) {
    if (!keys.includes(key)) {
      invalid(path, `unsupported field ${JSON.stringify(key)}; raw/private fields are forbidden`);
    }
  }
  for (const key of keys) {
    if (!(key in value)) invalid(path, `missing required field ${JSON.stringify(key)}`);
  }
}

function enumValue(value, allowed, path) {
  if (!allowed.includes(value)) invalid(path, `must be one of ${allowed.join(", ")}`);
}

function booleanValue(value, path, expected) {
  if (typeof value !== "boolean") invalid(path, "must be a boolean");
  if (expected !== undefined && value !== expected) invalid(path, `must be ${expected}`);
}

function integer(value, path, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    invalid(path, `must be a safe integer greater than or equal to ${minimum}`);
  }
}

function pattern(value, expression, path, description) {
  if (typeof value !== "string" || !expression.test(value)) invalid(path, description);
}

function safeId(value, path) {
  pattern(value, SAFE_ID_PATTERN, path, "must be a redaction-safe identifier");
}

function sha256(value, path) {
  pattern(value, SHA256_PATTERN, path, "must be sha256:<64 lowercase hex>");
}

function evidenceReference(value, path) {
  pattern(
    value,
    EVIDENCE_REFERENCE_PATTERN,
    path,
    "must be a SHA-256 checksum or opaque ref: handle, not a URL or raw evidence",
  );
}

function timestamp(value, path) {
  pattern(value, UTC_PATTERN, path, "must be an ISO-8601 UTC timestamp with whole seconds");
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value.replace("Z", ".000Z")
  ) {
    invalid(path, "must be a real UTC calendar timestamp");
  }
  return milliseconds;
}

function validationNow(now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    invalid("validator.now", "must be a valid Date");
  }
  return now.getTime();
}

function assertNotFuture(milliseconds, path, nowMilliseconds) {
  if (milliseconds > nowMilliseconds + MAXIMUM_CLOCK_SKEW_MILLISECONDS) {
    invalid(path, "cannot be in the future");
  }
}

function assertOrder(earlier, later, path) {
  if (earlier > later) invalid(path, "timestamps are out of order");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function computeEvidenceDocumentSha256(value) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex")}`;
}

export function computeBackupSourceSetSha256(manifest) {
  const sourceSet = {
    backupSetId: manifest.backupSetId,
    source: {
      environment: manifest.source.environment,
      hostId: manifest.source.hostId,
      gitCommit: manifest.source.gitCommit,
      serverImageDigest: manifest.source.serverImageDigest,
      webImageDigest: manifest.source.webImageDigest,
      snapshotCutoffAtUtc: manifest.source.snapshotCutoffAtUtc,
      consistencyMethod: manifest.source.consistencyMethod,
    },
    database: {
      plaintextSha256: manifest.database.artifact.plaintextSha256,
      durableTableCount: manifest.database.durableTableCount,
      rowInventorySha256: manifest.database.rowInventorySha256,
      migrationLedgerSha256: manifest.database.migrationLedgerSha256,
    },
    objects: {
      plaintextSha256: manifest.objects.artifact.plaintextSha256,
      inventorySha256: manifest.objects.inventorySha256,
      tagInventorySha256: manifest.objects.tagInventorySha256,
      objectCount: manifest.objects.objectCount,
      totalBytes: manifest.objects.totalBytes,
      inventoryScope: manifest.objects.inventoryScope,
      includesMetadata: manifest.objects.includesMetadata,
      includesTags: manifest.objects.includesTags,
    },
    configuration: {
      plaintextSha256: manifest.configuration.artifact.plaintextSha256,
    },
  };
  return computeEvidenceDocumentSha256(sourceSet);
}

function validateEncryption(value, path) {
  const encryption = object(value, path);
  exactKeys(
    encryption,
    ["algorithm", "keyId", "authenticatedEncryption", "keyStoredSeparately"],
    path,
  );
  enumValue(encryption.algorithm, ENCRYPTION_ALGORITHMS, `${path}.algorithm`);
  safeId(encryption.keyId, `${path}.keyId`);
  booleanValue(encryption.authenticatedEncryption, `${path}.authenticatedEncryption`, true);
  booleanValue(encryption.keyStoredSeparately, `${path}.keyStoredSeparately`, true);
}

function validateArtifact(value, expectedMediaType, path) {
  const artifact = object(value, path);
  exactKeys(
    artifact,
    [
      "artifactId",
      "mediaType",
      "plaintextBytes",
      "plaintextSha256",
      "encryptedBytes",
      "encryptedSha256",
      "encryption",
    ],
    path,
  );
  safeId(artifact.artifactId, `${path}.artifactId`);
  if (artifact.mediaType !== expectedMediaType) {
    invalid(`${path}.mediaType`, `must be ${expectedMediaType}`);
  }
  integer(artifact.plaintextBytes, `${path}.plaintextBytes`, 1);
  sha256(artifact.plaintextSha256, `${path}.plaintextSha256`);
  integer(artifact.encryptedBytes, `${path}.encryptedBytes`, 1);
  sha256(artifact.encryptedSha256, `${path}.encryptedSha256`);
  if (artifact.encryptedSha256 === artifact.plaintextSha256) {
    invalid(path, "encrypted and plaintext checksums must differ");
  }
  validateEncryption(artifact.encryption, `${path}.encryption`);
}

function validatePostgresAccess(value, path) {
  const access = object(value, path);
  exactKeys(
    access,
    [
      "identityId",
      "dedicated",
      "superuser",
      "databaseOwner",
      "canCreateRoles",
      "canCreateDatabases",
      "canReplicate",
      "bypassRlsForBackup",
      "readAllDurableRowsVerified",
      "writePrivileges",
      "credentialInPayload",
      "privilegeReviewReference",
    ],
    path,
  );
  safeId(access.identityId, `${path}.identityId`);
  booleanValue(access.dedicated, `${path}.dedicated`, true);
  booleanValue(access.superuser, `${path}.superuser`, false);
  booleanValue(access.databaseOwner, `${path}.databaseOwner`, false);
  booleanValue(access.canCreateRoles, `${path}.canCreateRoles`, false);
  booleanValue(access.canCreateDatabases, `${path}.canCreateDatabases`, false);
  booleanValue(access.canReplicate, `${path}.canReplicate`, false);
  booleanValue(access.bypassRlsForBackup, `${path}.bypassRlsForBackup`, true);
  booleanValue(access.readAllDurableRowsVerified, `${path}.readAllDurableRowsVerified`, true);
  booleanValue(access.writePrivileges, `${path}.writePrivileges`, false);
  booleanValue(access.credentialInPayload, `${path}.credentialInPayload`, false);
  evidenceReference(access.privilegeReviewReference, `${path}.privilegeReviewReference`);
}

function validateObjectStoreAccess(value, path) {
  const access = object(value, path);
  exactKeys(
    access,
    [
      "identityId",
      "dedicated",
      "bucketScoped",
      "canList",
      "canReadObjects",
      "canReadObjectTags",
      "canReadVersions",
      "canWriteObjects",
      "canDeleteObjects",
      "administrative",
      "credentialInPayload",
      "privilegeReviewReference",
    ],
    path,
  );
  safeId(access.identityId, `${path}.identityId`);
  booleanValue(access.dedicated, `${path}.dedicated`, true);
  booleanValue(access.bucketScoped, `${path}.bucketScoped`, true);
  booleanValue(access.canList, `${path}.canList`, true);
  booleanValue(access.canReadObjects, `${path}.canReadObjects`, true);
  booleanValue(access.canReadObjectTags, `${path}.canReadObjectTags`, true);
  booleanValue(access.canReadVersions, `${path}.canReadVersions`, true);
  booleanValue(access.canWriteObjects, `${path}.canWriteObjects`, false);
  booleanValue(access.canDeleteObjects, `${path}.canDeleteObjects`, false);
  booleanValue(access.administrative, `${path}.administrative`, false);
  booleanValue(access.credentialInPayload, `${path}.credentialInPayload`, false);
  evidenceReference(access.privilegeReviewReference, `${path}.privilegeReviewReference`);
}

function validateRedaction(value, path) {
  const redaction = object(value, path);
  exactKeys(
    redaction,
    [
      "containsCustomerContent",
      "containsCredentials",
      "containsPrivateUrls",
      "containsEncryptionKeyMaterial",
      "containsDirectIdentifiers",
    ],
    path,
  );
  for (const key of Object.keys(redaction)) booleanValue(redaction[key], `${path}.${key}`, false);
}

function validateOwnerAcceptance(value, path, notBefore, nowMilliseconds) {
  const acceptance = object(value, path);
  exactKeys(acceptance, ["role", "decision", "acceptedAtUtc", "evidenceReference"], path);
  if (acceptance.role !== "operations") invalid(`${path}.role`, "must be operations");
  if (acceptance.decision !== "accepted") invalid(`${path}.decision`, "must be accepted");
  const acceptedAt = timestamp(acceptance.acceptedAtUtc, `${path}.acceptedAtUtc`);
  assertNotFuture(acceptedAt, `${path}.acceptedAtUtc`, nowMilliseconds);
  if (acceptedAt < notBefore) invalid(`${path}.acceptedAtUtc`, "cannot predate the completed work");
  evidenceReference(acceptance.evidenceReference, `${path}.evidenceReference`);
  return { role: acceptance.role, acceptedAt };
}

function validateIndependentReviewer(value, path, owner, notBefore, nowMilliseconds) {
  const reviewer = object(value, path);
  exactKeys(
    reviewer,
    ["role", "independent", "decision", "acceptedAtUtc", "evidenceReference"],
    path,
  );
  safeId(reviewer.role, `${path}.role`);
  if (reviewer.role === owner.role) invalid(`${path}.role`, "must differ from the owner role");
  booleanValue(reviewer.independent, `${path}.independent`, true);
  if (reviewer.decision !== "accepted") invalid(`${path}.decision`, "must be accepted");
  const acceptedAt = timestamp(reviewer.acceptedAtUtc, `${path}.acceptedAtUtc`);
  assertNotFuture(acceptedAt, `${path}.acceptedAtUtc`, nowMilliseconds);
  if (acceptedAt < notBefore) invalid(`${path}.acceptedAtUtc`, "cannot predate the completed work");
  evidenceReference(reviewer.evidenceReference, `${path}.evidenceReference`);
  return acceptedAt;
}

function validateEvidenceReferences(value, path) {
  if (!Array.isArray(value) || value.length === 0) invalid(path, "must be a non-empty array");
  const seen = new Set();
  value.forEach((reference, index) => {
    evidenceReference(reference, `${path}[${index}]`);
    if (seen.has(reference)) invalid(`${path}[${index}]`, "duplicate evidence reference");
    seen.add(reference);
  });
}

export function validateBackupManifest(value, { now = new Date() } = {}) {
  const nowMilliseconds = validationNow(now);
  const manifest = object(value, "manifest");
  exactKeys(
    manifest,
    [
      "$schema",
      "schemaVersion",
      "kind",
      "backupSetId",
      "sourceSetSha256",
      "source",
      "access",
      "database",
      "objects",
      "configuration",
      "offHostStorage",
      "redaction",
      "ownerAcceptance",
      "independentReviewer",
      "evidenceReferences",
    ],
    "manifest",
  );
  if (manifest.$schema !== SCHEMA_REFERENCE)
    invalid("manifest.$schema", `must be ${SCHEMA_REFERENCE}`);
  if (manifest.schemaVersion !== 1) invalid("manifest.schemaVersion", "must be 1");
  if (manifest.kind !== "openround-off-host-backup-manifest") {
    invalid("manifest.kind", "must be openround-off-host-backup-manifest");
  }
  safeId(manifest.backupSetId, "manifest.backupSetId");
  sha256(manifest.sourceSetSha256, "manifest.sourceSetSha256");

  const source = object(manifest.source, "manifest.source");
  exactKeys(
    source,
    [
      "environment",
      "hostId",
      "failureDomainId",
      "gitCommit",
      "serverImageDigest",
      "webImageDigest",
      "captureStartedAtUtc",
      "snapshotCutoffAtUtc",
      "captureCompletedAtUtc",
      "consistencyMethod",
    ],
    "manifest.source",
  );
  safeId(source.environment, "manifest.source.environment");
  safeId(source.hostId, "manifest.source.hostId");
  safeId(source.failureDomainId, "manifest.source.failureDomainId");
  pattern(
    source.gitCommit,
    COMMIT_PATTERN,
    "manifest.source.gitCommit",
    "must be a full Git commit",
  );
  sha256(source.serverImageDigest, "manifest.source.serverImageDigest");
  sha256(source.webImageDigest, "manifest.source.webImageDigest");
  const captureStartedAt = timestamp(
    source.captureStartedAtUtc,
    "manifest.source.captureStartedAtUtc",
  );
  const snapshotCutoffAt = timestamp(
    source.snapshotCutoffAtUtc,
    "manifest.source.snapshotCutoffAtUtc",
  );
  const captureCompletedAt = timestamp(
    source.captureCompletedAtUtc,
    "manifest.source.captureCompletedAtUtc",
  );
  assertNotFuture(captureStartedAt, "manifest.source.captureStartedAtUtc", nowMilliseconds);
  assertNotFuture(snapshotCutoffAt, "manifest.source.snapshotCutoffAtUtc", nowMilliseconds);
  assertNotFuture(captureCompletedAt, "manifest.source.captureCompletedAtUtc", nowMilliseconds);
  assertOrder(captureStartedAt, snapshotCutoffAt, "manifest.source.snapshotCutoffAtUtc");
  assertOrder(snapshotCutoffAt, captureCompletedAt, "manifest.source.captureCompletedAtUtc");
  enumValue(
    source.consistencyMethod,
    ["maintenance-freeze", "application-coordinated-cutoff"],
    "manifest.source.consistencyMethod",
  );

  const access = object(manifest.access, "manifest.access");
  exactKeys(access, ["postgres", "objectStore"], "manifest.access");
  validatePostgresAccess(access.postgres, "manifest.access.postgres");
  validateObjectStoreAccess(access.objectStore, "manifest.access.objectStore");

  const database = object(manifest.database, "manifest.database");
  exactKeys(
    database,
    [
      "format",
      "artifact",
      "pgRestoreListSha256",
      "durableTableCount",
      "rowInventorySha256",
      "migrationLedgerSha256",
    ],
    "manifest.database",
  );
  if (database.format !== "postgres-custom")
    invalid("manifest.database.format", "must be postgres-custom");
  validateArtifact(
    database.artifact,
    "application/vnd.postgresql.custom-dump",
    "manifest.database.artifact",
  );
  sha256(database.pgRestoreListSha256, "manifest.database.pgRestoreListSha256");
  integer(database.durableTableCount, "manifest.database.durableTableCount", 1);
  sha256(database.rowInventorySha256, "manifest.database.rowInventorySha256");
  sha256(database.migrationLedgerSha256, "manifest.database.migrationLedgerSha256");

  const objects = object(manifest.objects, "manifest.objects");
  exactKeys(
    objects,
    [
      "artifact",
      "inventoryGeneratedAtUtc",
      "inventoryScope",
      "objectCount",
      "totalBytes",
      "inventorySha256",
      "tagInventorySha256",
      "includesMetadata",
      "includesTags",
    ],
    "manifest.objects",
  );
  validateArtifact(
    objects.artifact,
    "application/vnd.openround.object-backup",
    "manifest.objects.artifact",
  );
  const inventoryGeneratedAt = timestamp(
    objects.inventoryGeneratedAtUtc,
    "manifest.objects.inventoryGeneratedAtUtc",
  );
  assertNotFuture(
    inventoryGeneratedAt,
    "manifest.objects.inventoryGeneratedAtUtc",
    nowMilliseconds,
  );
  if (inventoryGeneratedAt < captureStartedAt || inventoryGeneratedAt > captureCompletedAt) {
    invalid(
      "manifest.objects.inventoryGeneratedAtUtc",
      "must fall inside the source capture window",
    );
  }
  if (objects.inventoryScope !== "all-current-objects-and-available-versions") {
    invalid(
      "manifest.objects.inventoryScope",
      "must be all-current-objects-and-available-versions",
    );
  }
  integer(objects.objectCount, "manifest.objects.objectCount", 0);
  integer(objects.totalBytes, "manifest.objects.totalBytes", 0);
  if ((objects.objectCount === 0) !== (objects.totalBytes === 0)) {
    invalid("manifest.objects", "objectCount and totalBytes must both be zero or both be positive");
  }
  sha256(objects.inventorySha256, "manifest.objects.inventorySha256");
  sha256(objects.tagInventorySha256, "manifest.objects.tagInventorySha256");
  booleanValue(objects.includesMetadata, "manifest.objects.includesMetadata", true);
  booleanValue(objects.includesTags, "manifest.objects.includesTags", true);

  const configuration = object(manifest.configuration, "manifest.configuration");
  exactKeys(configuration, ["scope", "artifact"], "manifest.configuration");
  if (configuration.scope !== "reviewed-non-secret-deployment-inventory") {
    invalid("manifest.configuration.scope", "must be reviewed-non-secret-deployment-inventory");
  }
  validateArtifact(
    configuration.artifact,
    "application/vnd.openround.non-secret-configuration",
    "manifest.configuration.artifact",
  );
  const artifactIds = [
    database.artifact.artifactId,
    objects.artifact.artifactId,
    configuration.artifact.artifactId,
  ];
  if (new Set(artifactIds).size !== artifactIds.length) {
    invalid("manifest", "database, object, and configuration artifact IDs must be unique");
  }
  const roleDigests = [
    source.serverImageDigest,
    source.webImageDigest,
    database.artifact.plaintextSha256,
    database.artifact.encryptedSha256,
    database.pgRestoreListSha256,
    database.rowInventorySha256,
    database.migrationLedgerSha256,
    objects.artifact.plaintextSha256,
    objects.artifact.encryptedSha256,
    objects.inventorySha256,
    objects.tagInventorySha256,
    configuration.artifact.plaintextSha256,
    configuration.artifact.encryptedSha256,
  ];
  if (new Set(roleDigests).size !== roleDigests.length) {
    invalid(
      "manifest",
      "all image, artifact, restore-list, row, migration, object, and tag-inventory role digests must be pairwise distinct",
    );
  }

  const offHost = object(manifest.offHostStorage, "manifest.offHostStorage");
  exactKeys(
    offHost,
    [
      "providerClass",
      "failureDomainId",
      "accountBoundary",
      "storedAtUtc",
      "retentionUntilUtc",
      "immutableOrVersioned",
      "locationReference",
    ],
    "manifest.offHostStorage",
  );
  enumValue(
    offHost.providerClass,
    ["object-storage", "backup-vault", "managed-backup"],
    "manifest.offHostStorage.providerClass",
  );
  safeId(offHost.failureDomainId, "manifest.offHostStorage.failureDomainId");
  if (offHost.failureDomainId === source.failureDomainId) {
    invalid(
      "manifest.offHostStorage.failureDomainId",
      "must differ from the source host failure domain",
    );
  }
  if (offHost.accountBoundary !== "separately-administered") {
    invalid("manifest.offHostStorage.accountBoundary", "must be separately-administered");
  }
  const storedAt = timestamp(offHost.storedAtUtc, "manifest.offHostStorage.storedAtUtc");
  assertNotFuture(storedAt, "manifest.offHostStorage.storedAtUtc", nowMilliseconds);
  const retentionUntil = timestamp(
    offHost.retentionUntilUtc,
    "manifest.offHostStorage.retentionUntilUtc",
  );
  assertOrder(captureCompletedAt, storedAt, "manifest.offHostStorage.storedAtUtc");
  if (retentionUntil <= storedAt)
    invalid("manifest.offHostStorage.retentionUntilUtc", "must follow storage time");
  booleanValue(offHost.immutableOrVersioned, "manifest.offHostStorage.immutableOrVersioned", true);
  evidenceReference(offHost.locationReference, "manifest.offHostStorage.locationReference");

  validateRedaction(manifest.redaction, "manifest.redaction");
  const owner = validateOwnerAcceptance(
    manifest.ownerAcceptance,
    "manifest.ownerAcceptance",
    storedAt,
    nowMilliseconds,
  );
  const reviewerAcceptedAt = validateIndependentReviewer(
    manifest.independentReviewer,
    "manifest.independentReviewer",
    owner,
    storedAt,
    nowMilliseconds,
  );
  if (reviewerAcceptedAt < owner.acceptedAt) {
    invalid("manifest.independentReviewer.acceptedAtUtc", "cannot predate owner acceptance");
  }
  if (retentionUntil < reviewerAcceptedAt) {
    invalid(
      "manifest.offHostStorage.retentionUntilUtc",
      "must cover manifest owner and independent-review acceptance",
    );
  }
  validateEvidenceReferences(manifest.evidenceReferences, "manifest.evidenceReferences");

  const computedSourceSetSha256 = computeBackupSourceSetSha256(manifest);
  if (manifest.sourceSetSha256 !== computedSourceSetSha256) {
    invalid(
      "manifest.sourceSetSha256",
      `does not match the canonical source set (${computedSourceSetSha256})`,
    );
  }
  return {
    captureStartedAt,
    snapshotCutoffAt,
    captureCompletedAt,
    storedAt,
    retentionUntil,
    sourceSetSha256: computedSourceSetSha256,
    manifestSha256: computeEvidenceDocumentSha256(manifest),
  };
}

function validateRestoreReceiptWithManifestResult(
  value,
  manifest,
  manifestResult,
  nowMilliseconds,
) {
  const receipt = object(value, "receipt");
  exactKeys(
    receipt,
    [
      "$schema",
      "schemaVersion",
      "kind",
      "restoreId",
      "backupBinding",
      "replacementHost",
      "timing",
      "verification",
      "cleanup",
      "redaction",
      "ownerAcceptance",
      "independentReviewer",
      "evidenceReferences",
    ],
    "receipt",
  );
  if (receipt.$schema !== SCHEMA_REFERENCE)
    invalid("receipt.$schema", `must be ${SCHEMA_REFERENCE}`);
  if (receipt.schemaVersion !== 1) invalid("receipt.schemaVersion", "must be 1");
  if (receipt.kind !== "openround-replacement-host-restore-receipt") {
    invalid("receipt.kind", "must be openround-replacement-host-restore-receipt");
  }
  safeId(receipt.restoreId, "receipt.restoreId");

  const binding = object(receipt.backupBinding, "receipt.backupBinding");
  exactKeys(
    binding,
    [
      "backupSetId",
      "backupManifestSha256",
      "sourceSetSha256",
      "sourceEnvironment",
      "gitCommit",
      "serverImageDigest",
      "webImageDigest",
      "databaseEncryptedSha256",
      "objectsEncryptedSha256",
      "configurationEncryptedSha256",
    ],
    "receipt.backupBinding",
  );
  const bindings = [
    ["backupSetId", manifest.backupSetId],
    ["backupManifestSha256", manifestResult.manifestSha256],
    ["sourceSetSha256", manifest.sourceSetSha256],
    ["sourceEnvironment", manifest.source.environment],
    ["gitCommit", manifest.source.gitCommit],
    ["serverImageDigest", manifest.source.serverImageDigest],
    ["webImageDigest", manifest.source.webImageDigest],
    ["databaseEncryptedSha256", manifest.database.artifact.encryptedSha256],
    ["objectsEncryptedSha256", manifest.objects.artifact.encryptedSha256],
    ["configurationEncryptedSha256", manifest.configuration.artifact.encryptedSha256],
  ];
  for (const [field, expected] of bindings) {
    if (binding[field] !== expected) {
      invalid(`receipt.backupBinding.${field}`, "does not match the accepted backup manifest");
    }
  }

  const host = object(receipt.replacementHost, "receipt.replacementHost");
  exactKeys(
    host,
    [
      "environment",
      "hostId",
      "failureDomainId",
      "cleanBaseline",
      "originalHostUsed",
      "freshPostgresStorage",
      "freshObjectStorage",
      "valkeyStartedEmpty",
      "deployedServerImageDigest",
      "deployedWebImageDigest",
    ],
    "receipt.replacementHost",
  );
  safeId(host.environment, "receipt.replacementHost.environment");
  if (host.environment !== manifest.source.environment) {
    invalid("receipt.replacementHost.environment", "must match the logical source environment");
  }
  safeId(host.hostId, "receipt.replacementHost.hostId");
  safeId(host.failureDomainId, "receipt.replacementHost.failureDomainId");
  if (host.hostId === manifest.source.hostId) {
    invalid("receipt.replacementHost.hostId", "must differ from the source host");
  }
  if (host.failureDomainId === manifest.source.failureDomainId) {
    invalid(
      "receipt.replacementHost.failureDomainId",
      "must differ from the source failure domain",
    );
  }
  booleanValue(host.cleanBaseline, "receipt.replacementHost.cleanBaseline", true);
  booleanValue(host.originalHostUsed, "receipt.replacementHost.originalHostUsed", false);
  booleanValue(host.freshPostgresStorage, "receipt.replacementHost.freshPostgresStorage", true);
  booleanValue(host.freshObjectStorage, "receipt.replacementHost.freshObjectStorage", true);
  booleanValue(host.valkeyStartedEmpty, "receipt.replacementHost.valkeyStartedEmpty", true);
  if (host.deployedServerImageDigest !== manifest.source.serverImageDigest) {
    invalid(
      "receipt.replacementHost.deployedServerImageDigest",
      "must match the source-bound server image",
    );
  }
  if (host.deployedWebImageDigest !== manifest.source.webImageDigest) {
    invalid(
      "receipt.replacementHost.deployedWebImageDigest",
      "must match the source-bound web image",
    );
  }

  const timing = object(receipt.timing, "receipt.timing");
  exactKeys(
    timing,
    [
      "failureDeclaredAtUtc",
      "restoreStartedAtUtc",
      "serviceValidatedAtUtc",
      "targetRpoSeconds",
      "targetRtoSeconds",
      "actualRpoSeconds",
      "actualRtoSeconds",
    ],
    "receipt.timing",
  );
  const failureDeclaredAt = timestamp(
    timing.failureDeclaredAtUtc,
    "receipt.timing.failureDeclaredAtUtc",
  );
  const restoreStartedAt = timestamp(
    timing.restoreStartedAtUtc,
    "receipt.timing.restoreStartedAtUtc",
  );
  const serviceValidatedAt = timestamp(
    timing.serviceValidatedAtUtc,
    "receipt.timing.serviceValidatedAtUtc",
  );
  assertNotFuture(failureDeclaredAt, "receipt.timing.failureDeclaredAtUtc", nowMilliseconds);
  assertNotFuture(restoreStartedAt, "receipt.timing.restoreStartedAtUtc", nowMilliseconds);
  assertNotFuture(serviceValidatedAt, "receipt.timing.serviceValidatedAtUtc", nowMilliseconds);
  assertOrder(manifestResult.storedAt, failureDeclaredAt, "receipt.timing.failureDeclaredAtUtc");
  assertOrder(failureDeclaredAt, restoreStartedAt, "receipt.timing.restoreStartedAtUtc");
  assertOrder(restoreStartedAt, serviceValidatedAt, "receipt.timing.serviceValidatedAtUtc");
  if (timing.targetRpoSeconds !== RPO_TARGET_SECONDS) {
    invalid("receipt.timing.targetRpoSeconds", `must be ${RPO_TARGET_SECONDS}`);
  }
  if (timing.targetRtoSeconds !== RTO_TARGET_SECONDS) {
    invalid("receipt.timing.targetRtoSeconds", `must be ${RTO_TARGET_SECONDS}`);
  }
  const computedRpoSeconds = (failureDeclaredAt - manifestResult.snapshotCutoffAt) / 1_000;
  const computedRtoSeconds = (serviceValidatedAt - failureDeclaredAt) / 1_000;
  if (timing.actualRpoSeconds !== computedRpoSeconds) {
    invalid("receipt.timing.actualRpoSeconds", `must recompute to ${computedRpoSeconds}`);
  }
  if (timing.actualRtoSeconds !== computedRtoSeconds) {
    invalid("receipt.timing.actualRtoSeconds", `must recompute to ${computedRtoSeconds}`);
  }
  if (computedRpoSeconds > RPO_TARGET_SECONDS) {
    invalid("receipt.timing.actualRpoSeconds", "exceeds the 24-hour RPO");
  }
  if (computedRtoSeconds > RTO_TARGET_SECONDS) {
    invalid("receipt.timing.actualRtoSeconds", "exceeds the four-hour RTO");
  }

  const verification = object(receipt.verification, "receipt.verification");
  exactKeys(
    verification,
    [
      "allCiphertextChecksumsVerified",
      "databasePlaintextSha256",
      "objectsPlaintextSha256",
      "configurationPlaintextSha256",
      "durableTableCount",
      "rowInventorySha256",
      "migrationLedgerSha256",
      "objectCount",
      "objectTotalBytes",
      "objectInventorySha256",
      "objectTagInventorySha256",
      "databaseInventoryMatch",
      "objectInventoryMatch",
      "objectTagInventoryMatch",
      "acceptedAnswerUniqueness",
      "reportReconciliation",
      "auditContinuity",
      "sampleMediaChecksums",
      "syntheticTlsFlow",
      "mediaAuthorization",
      "valkeyRebuild",
    ],
    "receipt.verification",
  );
  booleanValue(
    verification.allCiphertextChecksumsVerified,
    "receipt.verification.allCiphertextChecksumsVerified",
    true,
  );
  const verificationBindings = [
    ["databasePlaintextSha256", manifest.database.artifact.plaintextSha256],
    ["objectsPlaintextSha256", manifest.objects.artifact.plaintextSha256],
    ["configurationPlaintextSha256", manifest.configuration.artifact.plaintextSha256],
    ["durableTableCount", manifest.database.durableTableCount],
    ["rowInventorySha256", manifest.database.rowInventorySha256],
    ["migrationLedgerSha256", manifest.database.migrationLedgerSha256],
    ["objectCount", manifest.objects.objectCount],
    ["objectTotalBytes", manifest.objects.totalBytes],
    ["objectInventorySha256", manifest.objects.inventorySha256],
    ["objectTagInventorySha256", manifest.objects.tagInventorySha256],
  ];
  for (const [field, expected] of verificationBindings) {
    if (verification[field] !== expected) {
      invalid(`receipt.verification.${field}`, "does not match the source inventory");
    }
  }
  for (const field of [
    "databaseInventoryMatch",
    "objectInventoryMatch",
    "objectTagInventoryMatch",
    "acceptedAnswerUniqueness",
    "reportReconciliation",
    "auditContinuity",
    "sampleMediaChecksums",
    "syntheticTlsFlow",
    "mediaAuthorization",
    "valkeyRebuild",
  ]) {
    booleanValue(verification[field], `receipt.verification.${field}`, true);
  }

  const cleanup = object(receipt.cleanup, "receipt.cleanup");
  exactKeys(
    cleanup,
    [
      "plaintextArtifactsDeletedAtUtc",
      "decryptionKeyPersisted",
      "temporaryCredentialsRevoked",
      "temporaryResourcesRemoved",
    ],
    "receipt.cleanup",
  );
  const plaintextDeletedAt = timestamp(
    cleanup.plaintextArtifactsDeletedAtUtc,
    "receipt.cleanup.plaintextArtifactsDeletedAtUtc",
  );
  assertNotFuture(
    plaintextDeletedAt,
    "receipt.cleanup.plaintextArtifactsDeletedAtUtc",
    nowMilliseconds,
  );
  if (plaintextDeletedAt < serviceValidatedAt) {
    invalid("receipt.cleanup.plaintextArtifactsDeletedAtUtc", "cannot predate service validation");
  }
  booleanValue(cleanup.decryptionKeyPersisted, "receipt.cleanup.decryptionKeyPersisted", false);
  booleanValue(
    cleanup.temporaryCredentialsRevoked,
    "receipt.cleanup.temporaryCredentialsRevoked",
    true,
  );
  booleanValue(
    cleanup.temporaryResourcesRemoved,
    "receipt.cleanup.temporaryResourcesRemoved",
    true,
  );

  validateRedaction(receipt.redaction, "receipt.redaction");
  const owner = validateOwnerAcceptance(
    receipt.ownerAcceptance,
    "receipt.ownerAcceptance",
    plaintextDeletedAt,
    nowMilliseconds,
  );
  const reviewerAcceptedAt = validateIndependentReviewer(
    receipt.independentReviewer,
    "receipt.independentReviewer",
    owner,
    plaintextDeletedAt,
    nowMilliseconds,
  );
  if (reviewerAcceptedAt < owner.acceptedAt) {
    invalid("receipt.independentReviewer.acceptedAtUtc", "cannot predate owner acceptance");
  }
  if (reviewerAcceptedAt > manifestResult.retentionUntil) {
    invalid(
      "manifest.offHostStorage.retentionUntilUtc",
      "must cover service validation, cleanup, owner acceptance, and independent restore review",
    );
  }
  validateEvidenceReferences(receipt.evidenceReferences, "receipt.evidenceReferences");
  return {
    backupSetId: manifest.backupSetId,
    restoreId: receipt.restoreId,
    sourceSetSha256: manifest.sourceSetSha256,
    manifestSha256: manifestResult.manifestSha256,
    receiptSha256: computeEvidenceDocumentSha256(receipt),
    actualRpoSeconds: computedRpoSeconds,
    actualRtoSeconds: computedRtoSeconds,
    accepted: true,
  };
}

export function validateRestoreReceipt(value, manifest, { now = new Date() } = {}) {
  const nowMilliseconds = validationNow(now);
  return validateRestoreReceiptWithManifestResult(
    value,
    manifest,
    validateBackupManifest(manifest, { now }),
    nowMilliseconds,
  );
}

export function validateBackupRestoreEvidence(manifest, receipt, { now = new Date() } = {}) {
  const nowMilliseconds = validationNow(now);
  const manifestResult = validateBackupManifest(manifest, { now });
  return validateRestoreReceiptWithManifestResult(
    receipt,
    manifest,
    manifestResult,
    nowMilliseconds,
  );
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  const argumentsWithoutSeparator = process.argv.slice(2).filter((argument) => argument !== "--");
  if (argumentsWithoutSeparator.length !== 2) {
    process.stderr.write(
      "Usage: node scripts/check-backup-restore-evidence.mjs <backup-manifest.json> <restore-receipt.json>\n",
    );
    process.exitCode = 1;
  } else {
    try {
      const [manifestPath, receiptPath] = argumentsWithoutSeparator.map((path) =>
        resolve(process.cwd(), path),
      );
      const [manifestSource, receiptSource] = await Promise.all([
        readFile(manifestPath, "utf8"),
        readFile(receiptPath, "utf8"),
      ]);
      const result = validateBackupRestoreEvidence(
        JSON.parse(manifestSource),
        JSON.parse(receiptSource),
      );
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Backup/restore evidence is invalid: ${message}\n`);
      process.exitCode = 1;
    }
  }
}

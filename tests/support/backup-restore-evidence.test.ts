import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  computeBackupSourceSetSha256,
  computeEvidenceDocumentSha256,
  validateBackupManifest,
  validateBackupRestoreEvidence,
  validateRestoreReceipt,
} from "../../scripts/check-backup-restore-evidence.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const reference = (name: string) => `ref:backup/${name}`;

function encryptedArtifact(id: string, mediaType: string, character: string) {
  return {
    artifactId: id,
    mediaType,
    plaintextBytes: 1_024,
    plaintextSha256: digest(character),
    encryptedBytes: 1_128,
    encryptedSha256: digest(
      character === "f" ? "0" : String.fromCharCode(character.charCodeAt(0) + 1),
    ),
    encryption: {
      algorithm: "age-x25519",
      keyId: "key-backup-2026-09",
      authenticatedEncryption: true,
      keyStoredSeparately: true,
    },
  };
}

function validEvidence() {
  const manifest = {
    $schema: "./backup-restore-evidence.schema.json",
    schemaVersion: 1,
    kind: "openround-off-host-backup-manifest",
    backupSetId: "backup-2026-09-27-001",
    sourceSetSha256: digest("0"),
    source: {
      environment: "single-vm-production",
      hostId: "host-production-01",
      failureDomainId: "provider-a/region-a/host-01",
      gitCommit: "a".repeat(40),
      serverImageDigest: digest("b"),
      webImageDigest: digest("c"),
      captureStartedAtUtc: "2026-09-27T00:00:00Z",
      snapshotCutoffAtUtc: "2026-09-27T00:05:00Z",
      captureCompletedAtUtc: "2026-09-27T00:10:00Z",
      consistencyMethod: "maintenance-freeze",
    },
    access: {
      postgres: {
        identityId: "identity-postgres-backup",
        dedicated: true,
        superuser: false,
        databaseOwner: false,
        canCreateRoles: false,
        canCreateDatabases: false,
        canReplicate: false,
        bypassRlsForBackup: true,
        readAllDurableRowsVerified: true,
        writePrivileges: false,
        credentialInPayload: false,
        privilegeReviewReference: reference("postgres-privilege-review"),
      },
      objectStore: {
        identityId: "identity-object-backup",
        dedicated: true,
        bucketScoped: true,
        canList: true,
        canReadObjects: true,
        canReadObjectTags: true,
        canReadVersions: true,
        canWriteObjects: false,
        canDeleteObjects: false,
        administrative: false,
        credentialInPayload: false,
        privilegeReviewReference: reference("object-privilege-review"),
      },
    },
    database: {
      format: "postgres-custom",
      artifact: encryptedArtifact(
        "artifact-postgres",
        "application/vnd.postgresql.custom-dump",
        "d",
      ),
      pgRestoreListSha256: digest("f"),
      durableTableCount: 42,
      rowInventorySha256: digest("1"),
      migrationLedgerSha256: digest("2"),
    },
    objects: {
      artifact: encryptedArtifact(
        "artifact-objects",
        "application/vnd.openround.object-backup",
        "3",
      ),
      inventoryGeneratedAtUtc: "2026-09-27T00:06:00Z",
      inventoryScope: "all-current-objects-and-available-versions",
      objectCount: 12,
      totalBytes: 12_000,
      inventorySha256: digest("5"),
      tagInventorySha256: digest("a"),
      includesMetadata: true,
      includesTags: true,
    },
    configuration: {
      scope: "reviewed-non-secret-deployment-inventory",
      artifact: encryptedArtifact(
        "artifact-configuration",
        "application/vnd.openround.non-secret-configuration",
        "6",
      ),
    },
    offHostStorage: {
      providerClass: "object-storage",
      failureDomainId: "provider-b/account-backup/region-b",
      accountBoundary: "separately-administered",
      storedAtUtc: "2026-09-27T00:15:00Z",
      retentionUntilUtc: "2026-10-27T00:15:00Z",
      immutableOrVersioned: true,
      locationReference: reference("off-host-generation"),
    },
    redaction: {
      containsCustomerContent: false,
      containsCredentials: false,
      containsPrivateUrls: false,
      containsEncryptionKeyMaterial: false,
      containsDirectIdentifiers: false,
    },
    ownerAcceptance: {
      role: "operations",
      decision: "accepted",
      acceptedAtUtc: "2026-09-27T00:20:00Z",
      evidenceReference: reference("backup-owner-acceptance"),
    },
    independentReviewer: {
      role: "independent-recovery-reviewer",
      independent: true,
      decision: "accepted",
      acceptedAtUtc: "2026-09-27T00:25:00Z",
      evidenceReference: reference("backup-reviewer-acceptance"),
    },
    evidenceReferences: [reference("backup-job"), digest("8")],
  };
  manifest.sourceSetSha256 = computeBackupSourceSetSha256(manifest);

  const receipt = {
    $schema: "./backup-restore-evidence.schema.json",
    schemaVersion: 1,
    kind: "openround-replacement-host-restore-receipt",
    restoreId: "restore-2026-09-27-001",
    backupBinding: {
      backupSetId: manifest.backupSetId,
      backupManifestSha256: computeEvidenceDocumentSha256(manifest),
      sourceSetSha256: manifest.sourceSetSha256,
      sourceEnvironment: manifest.source.environment,
      gitCommit: manifest.source.gitCommit,
      serverImageDigest: manifest.source.serverImageDigest,
      webImageDigest: manifest.source.webImageDigest,
      databaseEncryptedSha256: manifest.database.artifact.encryptedSha256,
      objectsEncryptedSha256: manifest.objects.artifact.encryptedSha256,
      configurationEncryptedSha256: manifest.configuration.artifact.encryptedSha256,
    },
    replacementHost: {
      environment: "single-vm-production",
      hostId: "host-replacement-01",
      failureDomainId: "provider-a/region-a/host-02",
      cleanBaseline: true,
      originalHostUsed: false,
      freshPostgresStorage: true,
      freshObjectStorage: true,
      valkeyStartedEmpty: true,
      deployedServerImageDigest: manifest.source.serverImageDigest,
      deployedWebImageDigest: manifest.source.webImageDigest,
    },
    timing: {
      failureDeclaredAtUtc: "2026-09-27T12:05:00Z",
      restoreStartedAtUtc: "2026-09-27T12:15:00Z",
      serviceValidatedAtUtc: "2026-09-27T15:05:00Z",
      targetRpoSeconds: 86_400,
      targetRtoSeconds: 14_400,
      actualRpoSeconds: 43_200,
      actualRtoSeconds: 10_800,
    },
    verification: {
      allCiphertextChecksumsVerified: true,
      databasePlaintextSha256: manifest.database.artifact.plaintextSha256,
      objectsPlaintextSha256: manifest.objects.artifact.plaintextSha256,
      configurationPlaintextSha256: manifest.configuration.artifact.plaintextSha256,
      durableTableCount: manifest.database.durableTableCount,
      rowInventorySha256: manifest.database.rowInventorySha256,
      migrationLedgerSha256: manifest.database.migrationLedgerSha256,
      objectCount: manifest.objects.objectCount,
      objectTotalBytes: manifest.objects.totalBytes,
      objectInventorySha256: manifest.objects.inventorySha256,
      objectTagInventorySha256: manifest.objects.tagInventorySha256,
      databaseInventoryMatch: true,
      objectInventoryMatch: true,
      objectTagInventoryMatch: true,
      acceptedAnswerUniqueness: true,
      reportReconciliation: true,
      auditContinuity: true,
      sampleMediaChecksums: true,
      syntheticTlsFlow: true,
      mediaAuthorization: true,
      valkeyRebuild: true,
    },
    cleanup: {
      plaintextArtifactsDeletedAtUtc: "2026-09-27T15:10:00Z",
      decryptionKeyPersisted: false,
      temporaryCredentialsRevoked: true,
      temporaryResourcesRemoved: true,
    },
    redaction: {
      containsCustomerContent: false,
      containsCredentials: false,
      containsPrivateUrls: false,
      containsEncryptionKeyMaterial: false,
      containsDirectIdentifiers: false,
    },
    ownerAcceptance: {
      role: "operations",
      decision: "accepted",
      acceptedAtUtc: "2026-09-27T15:15:00Z",
      evidenceReference: reference("restore-owner-acceptance"),
    },
    independentReviewer: {
      role: "independent-recovery-reviewer",
      independent: true,
      decision: "accepted",
      acceptedAtUtc: "2026-09-27T15:20:00Z",
      evidenceReference: reference("restore-reviewer-acceptance"),
    },
    evidenceReferences: [reference("replacement-host-drill"), digest("9")],
  };
  return { manifest, receipt };
}

describe("off-host backup and replacement-host restore evidence", () => {
  it("accepts a source-bound encrypted manifest and independently reviewed restore receipt", () => {
    const { manifest, receipt } = validEvidence();

    expect(validateBackupRestoreEvidence(manifest, receipt)).toEqual({
      backupSetId: "backup-2026-09-27-001",
      restoreId: "restore-2026-09-27-001",
      sourceSetSha256: manifest.sourceSetSha256,
      manifestSha256: computeEvidenceDocumentSha256(manifest),
      receiptSha256: computeEvidenceDocumentSha256(receipt),
      actualRpoSeconds: 43_200,
      actualRtoSeconds: 10_800,
      accepted: true,
    });
  });

  it("rejects source-set and restore bindings that do not match exact build inputs", () => {
    const sourceMismatch = validEvidence();
    sourceMismatch.manifest.source.gitCommit = "0".repeat(40);
    expect(() =>
      validateBackupRestoreEvidence(sourceMismatch.manifest, sourceMismatch.receipt),
    ).toThrow(/sourceSetSha256/);

    const receiptMismatch = validEvidence();
    receiptMismatch.receipt.backupBinding.serverImageDigest = digest("0");
    expect(() =>
      validateBackupRestoreEvidence(receiptMismatch.manifest, receiptMismatch.receipt),
    ).toThrow(/serverImageDigest.*accepted backup manifest/);
  });

  it("fails closed on owner, superuser, or writable backup identities", () => {
    const postgresOwner = validEvidence();
    postgresOwner.manifest.access.postgres.databaseOwner = true;
    expect(() =>
      validateBackupRestoreEvidence(postgresOwner.manifest, postgresOwner.receipt),
    ).toThrow(/databaseOwner: must be false/);

    const objectWriter = validEvidence();
    objectWriter.manifest.access.objectStore.canWriteObjects = true;
    expect(() =>
      validateBackupRestoreEvidence(objectWriter.manifest, objectWriter.receipt),
    ).toThrow(/canWriteObjects: must be false/);

    const noRlsCoverage = validEvidence();
    noRlsCoverage.manifest.access.postgres.bypassRlsForBackup = false;
    expect(() =>
      validateBackupRestoreEvidence(noRlsCoverage.manifest, noRlsCoverage.receipt),
    ).toThrow(/bypassRlsForBackup: must be true/);

    const noTagRead = validEvidence();
    noTagRead.manifest.access.objectStore.canReadObjectTags = false;
    expect(() => validateBackupRestoreEvidence(noTagRead.manifest, noTagRead.receipt)).toThrow(
      /canReadObjectTags: must be true/,
    );
  });

  it("requires authenticated encryption with separately held keys", () => {
    const { manifest, receipt } = validEvidence();
    manifest.database.artifact.encryption.keyStoredSeparately = false;

    expect(() => validateBackupRestoreEvidence(manifest, receipt)).toThrow(
      /keyStoredSeparately: must be true/,
    );
  });

  it("requires distinct role artifacts and the same logical replacement environment", () => {
    const reusedArtifact = validEvidence();
    reusedArtifact.manifest.objects.artifact.plaintextSha256 =
      reusedArtifact.manifest.database.artifact.plaintextSha256;
    reusedArtifact.manifest.objects.artifact.encryptedSha256 =
      reusedArtifact.manifest.database.artifact.encryptedSha256;
    expect(() =>
      validateBackupRestoreEvidence(reusedArtifact.manifest, reusedArtifact.receipt),
    ).toThrow(/role digests must be pairwise distinct/);

    const crossRoleReuse = validEvidence();
    crossRoleReuse.manifest.objects.artifact.plaintextSha256 =
      crossRoleReuse.manifest.database.artifact.encryptedSha256;
    expect(() =>
      validateBackupRestoreEvidence(crossRoleReuse.manifest, crossRoleReuse.receipt),
    ).toThrow(/role digests must be pairwise distinct/);

    const inventoryReuse = validEvidence();
    inventoryReuse.manifest.objects.inventorySha256 =
      inventoryReuse.manifest.database.migrationLedgerSha256;
    expect(() =>
      validateBackupRestoreEvidence(inventoryReuse.manifest, inventoryReuse.receipt),
    ).toThrow(/role digests must be pairwise distinct/);

    const wrongEnvironment = validEvidence();
    wrongEnvironment.receipt.replacementHost.environment = "different-environment";
    expect(() =>
      validateBackupRestoreEvidence(wrongEnvironment.manifest, wrongEnvironment.receipt),
    ).toThrow(/replacementHost.environment.*logical source environment/);
  });

  it("requires off-host retention through both independent acceptances", () => {
    const expiredBeforeManifestReview = validEvidence();
    expiredBeforeManifestReview.manifest.offHostStorage.retentionUntilUtc = "2026-09-27T00:24:00Z";
    expect(() =>
      validateBackupRestoreEvidence(
        expiredBeforeManifestReview.manifest,
        expiredBeforeManifestReview.receipt,
      ),
    ).toThrow(/retentionUntilUtc.*manifest owner and independent-review acceptance/);

    const expiredBeforeRestoreReview = validEvidence();
    expiredBeforeRestoreReview.manifest.offHostStorage.retentionUntilUtc = "2026-09-27T15:19:00Z";
    expiredBeforeRestoreReview.receipt.backupBinding.backupManifestSha256 =
      computeEvidenceDocumentSha256(expiredBeforeRestoreReview.manifest);
    expect(() =>
      validateBackupRestoreEvidence(
        expiredBeforeRestoreReview.manifest,
        expiredBeforeRestoreReview.receipt,
      ),
    ).toThrow(/retentionUntilUtc.*independent restore review/);
  });

  it("recomputes RPO and RTO rather than trusting declared durations", () => {
    const wrongRpo = validEvidence();
    wrongRpo.receipt.timing.actualRpoSeconds = 1;
    expect(() => validateBackupRestoreEvidence(wrongRpo.manifest, wrongRpo.receipt)).toThrow(
      /actualRpoSeconds: must recompute to 43200/,
    );

    const lateRestore = validEvidence();
    lateRestore.receipt.timing.serviceValidatedAtUtc = "2026-09-27T16:05:01Z";
    lateRestore.receipt.timing.actualRtoSeconds = 14_401;
    lateRestore.receipt.cleanup.plaintextArtifactsDeletedAtUtc = "2026-09-27T16:10:00Z";
    lateRestore.receipt.ownerAcceptance.acceptedAtUtc = "2026-09-27T16:15:00Z";
    lateRestore.receipt.independentReviewer.acceptedAtUtc = "2026-09-27T16:20:00Z";
    expect(() => validateBackupRestoreEvidence(lateRestore.manifest, lateRestore.receipt)).toThrow(
      /exceeds the four-hour RTO/,
    );
  });

  it("rejects restored inventories that differ from the encrypted source set", () => {
    const { manifest, receipt } = validEvidence();
    receipt.verification.objectInventorySha256 = digest("0");

    expect(() => validateBackupRestoreEvidence(manifest, receipt)).toThrow(
      /objectInventorySha256: does not match the source inventory/,
    );

    const tagMismatch = validEvidence();
    tagMismatch.receipt.verification.objectTagInventorySha256 = digest("0");
    expect(() => validateBackupRestoreEvidence(tagMismatch.manifest, tagMismatch.receipt)).toThrow(
      /objectTagInventorySha256: does not match the source inventory/,
    );

    const tagsNotRestored = validEvidence();
    tagsNotRestored.receipt.verification.objectTagInventoryMatch = false;
    expect(() =>
      validateBackupRestoreEvidence(tagsNotRestored.manifest, tagsNotRestored.receipt),
    ).toThrow(/objectTagInventoryMatch: must be true/);
  });

  it("requires redacted records and accepted independent review", () => {
    const privateReceipt = validEvidence();
    privateReceipt.receipt.redaction.containsPrivateUrls = true;
    expect(() =>
      validateBackupRestoreEvidence(privateReceipt.manifest, privateReceipt.receipt),
    ).toThrow(/containsPrivateUrls: must be false/);

    const pendingReview = validEvidence();
    pendingReview.receipt.independentReviewer.decision = "pending";
    expect(() =>
      validateBackupRestoreEvidence(pendingReview.manifest, pendingReview.receipt),
    ).toThrow(/decision: must be accepted/);
  });

  it("rejects future-dated backup and restore events using an injectable validation clock", () => {
    const now = new Date("2026-09-27T15:21:00Z");
    const future = "2026-09-27T15:27:00Z";
    const manifestCases = [
      [
        "source.captureStartedAtUtc",
        (value: ReturnType<typeof validEvidence>["manifest"]) => {
          value.source.captureStartedAtUtc = future;
        },
      ],
      [
        "source.snapshotCutoffAtUtc",
        (value: ReturnType<typeof validEvidence>["manifest"]) => {
          value.source.snapshotCutoffAtUtc = future;
        },
      ],
      [
        "source.captureCompletedAtUtc",
        (value: ReturnType<typeof validEvidence>["manifest"]) => {
          value.source.captureCompletedAtUtc = future;
        },
      ],
      [
        "objects.inventoryGeneratedAtUtc",
        (value: ReturnType<typeof validEvidence>["manifest"]) => {
          value.objects.inventoryGeneratedAtUtc = future;
        },
      ],
      [
        "offHostStorage.storedAtUtc",
        (value: ReturnType<typeof validEvidence>["manifest"]) => {
          value.offHostStorage.storedAtUtc = future;
        },
      ],
      [
        "ownerAcceptance.acceptedAtUtc",
        (value: ReturnType<typeof validEvidence>["manifest"]) => {
          value.ownerAcceptance.acceptedAtUtc = future;
        },
      ],
      [
        "independentReviewer.acceptedAtUtc",
        (value: ReturnType<typeof validEvidence>["manifest"]) => {
          value.independentReviewer.acceptedAtUtc = future;
        },
      ],
    ] as const;
    for (const [path, mutate] of manifestCases) {
      const { manifest } = validEvidence();
      mutate(manifest);
      expect(() => validateBackupManifest(manifest, { now }), path).toThrow(
        new RegExp(`manifest\\.${path.replaceAll(".", "\\.")}.*cannot be in the future`),
      );
    }

    const receiptCases = [
      [
        "timing.failureDeclaredAtUtc",
        (value: ReturnType<typeof validEvidence>["receipt"]) => {
          value.timing.failureDeclaredAtUtc = future;
        },
      ],
      [
        "timing.restoreStartedAtUtc",
        (value: ReturnType<typeof validEvidence>["receipt"]) => {
          value.timing.restoreStartedAtUtc = future;
        },
      ],
      [
        "timing.serviceValidatedAtUtc",
        (value: ReturnType<typeof validEvidence>["receipt"]) => {
          value.timing.serviceValidatedAtUtc = future;
        },
      ],
      [
        "cleanup.plaintextArtifactsDeletedAtUtc",
        (value: ReturnType<typeof validEvidence>["receipt"]) => {
          value.cleanup.plaintextArtifactsDeletedAtUtc = future;
        },
      ],
      [
        "ownerAcceptance.acceptedAtUtc",
        (value: ReturnType<typeof validEvidence>["receipt"]) => {
          value.ownerAcceptance.acceptedAtUtc = future;
        },
      ],
      [
        "independentReviewer.acceptedAtUtc",
        (value: ReturnType<typeof validEvidence>["receipt"]) => {
          value.independentReviewer.acceptedAtUtc = future;
        },
      ],
    ] as const;
    for (const [path, mutate] of receiptCases) {
      const { manifest, receipt } = validEvidence();
      mutate(receipt);
      expect(() => validateBackupRestoreEvidence(manifest, receipt, { now }), path).toThrow(
        new RegExp(`receipt\\.${path.replaceAll(".", "\\.")}.*cannot be in the future`),
      );
    }
  });

  it("accepts event timestamps at the five-minute clock-skew boundary", () => {
    const { manifest, receipt } = validEvidence();
    receipt.independentReviewer.acceptedAtUtc = "2026-09-27T15:26:00Z";

    expect(() =>
      validateBackupRestoreEvidence(manifest, receipt, {
        now: new Date("2026-09-27T15:21:00Z"),
      }),
    ).not.toThrow();
  });

  it("never trusts a caller-supplied cached manifest validation result", () => {
    const { manifest, receipt } = validEvidence();
    manifest.redaction.containsCredentials = true;
    receipt.backupBinding.backupManifestSha256 = computeEvidenceDocumentSha256(manifest);
    const forgedResult = {
      storedAt: Date.parse(manifest.offHostStorage.storedAtUtc),
      retentionUntil: Date.parse(manifest.offHostStorage.retentionUntilUtc),
      snapshotCutoffAt: Date.parse(manifest.source.snapshotCutoffAtUtc),
      manifestSha256: receipt.backupBinding.backupManifestSha256,
    };

    expect(() =>
      (validateRestoreReceipt as (...args: unknown[]) => unknown)(receipt, manifest, forgedResult),
    ).toThrow(/containsCredentials: must be false/);
  });

  it("documents a pending gate and a fail-closed provisioning prerequisite", async () => {
    const [runbook, record, ledgerSource] = await Promise.all([
      readFile(resolve(repositoryRoot, "docs/runbooks/backup-restore.md"), "utf8"),
      readFile(resolve(repositoryRoot, "docs/evidence/provider-restore.md"), "utf8"),
      readFile(resolve(repositoryRoot, "docs/release-readiness.json"), "utf8"),
    ]);
    const ledger = JSON.parse(ledgerSource) as {
      gates: Array<{ id: string; status: string; evidence: unknown[] }>;
    };
    const gate = ledger.gates.find(({ id }) => id === "off-host-restore");

    expect(runbook).toContain("check-backup-restore-evidence.mjs");
    expect(runbook).toContain("BYPASSRLS");
    expect(runbook).toContain("fail closed");
    expect(record).toContain("backup-restore-evidence.schema.json");
    expect(gate).toEqual(expect.objectContaining({ status: "pending", evidence: [] }));
  });
});

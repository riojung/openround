import type { RecoveryPackExportReport } from "@openround/contracts";

export const exportSource: RecoveryPackExportReport["source"] = {
  artifactType: "recovery_pack",
  packId: "10000000-0000-4000-8000-000000000001",
  packVersionId: "10000000-0000-4000-8000-000000000002",
  packVersion: 3,
  contentHash: "a".repeat(64),
  title: "Frozen < Recovery Pack",
};

export function exportReport(
  format: RecoveryPackExportReport["format"] = "csv",
): RecoveryPackExportReport {
  return {
    schemaVersion: 1,
    format,
    source: { ...exportSource },
    checkpointCount: 2,
    exportedCheckpointCount: 2,
    canExport: true,
    findings: [
      {
        code: "WORKFLOW_OMITTED",
        severity: "warning",
        disposition: "omitted",
        fieldPath: "interventions",
        affectedItems: 1,
        reason: "Facilitator guidance is not a checkpoint workflow in this format.",
      },
    ],
  };
}

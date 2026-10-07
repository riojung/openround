import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  RecoveryPackExportFindingSchema,
  RecoveryPackExportFormatSchema,
  RecoveryPackExportReportEnvelopeSchema,
  RecoveryPackExportReportSchema,
  type RecoveryPackExportReport,
} from "../src/index.js";

function report(): RecoveryPackExportReport {
  return {
    schemaVersion: 1,
    format: "csv",
    source: {
      artifactType: "recovery_pack",
      packId: randomUUID(),
      packVersionId: randomUUID(),
      packVersion: 2,
      contentHash: "a".repeat(64),
      title: "Frozen Pack",
    },
    checkpointCount: 3,
    exportedCheckpointCount: 3,
    canExport: true,
    findings: [
      {
        code: "PACK_CARDS_OMITTED",
        severity: "warning",
        disposition: "omitted",
        fieldPath: "interventions",
        affectedItems: 2,
        reason: "Checkpoint exports do not contain the ordered guidance cards.",
      },
    ],
  };
}

describe("Recovery Pack export reports", () => {
  it("accepts both checkpoint formats and leaves warning-only exports available", () => {
    for (const format of ["csv", "qti3"] as const) {
      const value = { ...report(), format };
      expect(RecoveryPackExportReportSchema.parse(value)).toEqual(value);
      expect(RecoveryPackExportReportEnvelopeSchema.parse({ report: value })).toEqual({
        report: value,
      });
    }
    expect(RecoveryPackExportFormatSchema.safeParse("json").success).toBe(false);
  });

  it("binds source metadata to the exact version and excludes private payload fields", () => {
    const value = report();
    expect(
      RecoveryPackExportReportSchema.safeParse({ ...value, attemptToken: "private" }).success,
    ).toBe(false);
    expect(
      RecoveryPackExportReportSchema.safeParse({
        ...value,
        source: { ...value.source, mediaId: randomUUID() },
      }).success,
    ).toBe(false);
    for (const contentHash of ["", "A".repeat(64), "a".repeat(63)])
      expect(
        RecoveryPackExportReportSchema.safeParse({
          ...value,
          source: { ...value.source, contentHash },
        }).success,
      ).toBe(false);
    expect(
      RecoveryPackExportReportSchema.safeParse({
        ...value,
        source: { ...value.source, packVersion: 0 },
      }).success,
    ).toBe(false);
    expect(
      RecoveryPackExportReportEnvelopeSchema.safeParse({ report: value, rawAnswers: [] }).success,
    ).toBe(false);
  });

  it("blocks unsupported content without reporting a partial successful download", () => {
    const value = report();
    const blocked = {
      ...value,
      canExport: false,
      exportedCheckpointCount: 0,
      findings: [
        ...value.findings,
        {
          code: "UNSUPPORTED_CHECKPOINT",
          severity: "error",
          disposition: "unsupported",
          fieldPath: "diagnostic.type",
          affectedItems: 1,
          reason: "This checkpoint is outside the supported export profile.",
        },
      ],
    };
    expect(RecoveryPackExportReportSchema.safeParse(blocked).success).toBe(true);
    expect(RecoveryPackExportReportSchema.safeParse({ ...blocked, canExport: true }).success).toBe(
      false,
    );
    expect(
      RecoveryPackExportReportSchema.safeParse({ ...blocked, exportedCheckpointCount: 1 }).success,
    ).toBe(false);
    expect(RecoveryPackExportReportSchema.safeParse({ ...value, canExport: false }).success).toBe(
      false,
    );
    expect(
      RecoveryPackExportReportSchema.safeParse({ ...value, exportedCheckpointCount: 2 }).success,
    ).toBe(false);
  });

  it("separates omitted fields, extension metadata, and transformations from blockers", () => {
    const value = report().findings[0]!;
    for (const disposition of ["omitted", "extension_only", "transformed"] as const)
      expect(RecoveryPackExportFindingSchema.safeParse({ ...value, disposition }).success).toBe(
        true,
      );
    expect(RecoveryPackExportFindingSchema.safeParse({ ...value, severity: "error" }).success).toBe(
      false,
    );
    expect(
      RecoveryPackExportFindingSchema.safeParse({ ...value, disposition: "unsupported" }).success,
    ).toBe(false);
  });

  it("bounds reports and rejects missing, unknown, or nonintegral finding data", () => {
    const value = report();
    const finding = value.findings[0]!;
    for (const changes of [
      { code: "not-stable" },
      { code: "A".repeat(81) },
      { fieldPath: " " },
      { fieldPath: "a".repeat(241) },
      { affectedItems: 0 },
      { affectedItems: 1.5 },
      { affectedItems: 101 },
      { reason: " " },
      { reason: "a".repeat(1_001) },
      { excerpt: "Private source text" },
    ])
      expect(RecoveryPackExportFindingSchema.safeParse({ ...finding, ...changes }).success).toBe(
        false,
      );
    expect(
      RecoveryPackExportReportSchema.safeParse({ ...value, findings: Array(101).fill(finding) })
        .success,
    ).toBe(false);
    for (const checkpointCount of [0, 1, 4, 2.5])
      expect(
        RecoveryPackExportReportSchema.safeParse({
          ...value,
          checkpointCount,
          exportedCheckpointCount: checkpointCount,
        }).success,
      ).toBe(false);
    expect(RecoveryPackExportReportSchema.safeParse({ ...value, schemaVersion: 2 }).success).toBe(
      false,
    );
  });
});

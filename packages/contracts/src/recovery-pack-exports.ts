import { z } from "zod";

/** Native JSON remains the complete content format; these are checkpoint projections. */
export const RecoveryPackExportFormatSchema = z.enum(["csv", "qti3"]);
export type RecoveryPackExportFormat = z.infer<typeof RecoveryPackExportFormatSchema>;

export const RecoveryPackExportFindingSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/),
    severity: z.enum(["warning", "error"]),
    disposition: z.enum(["omitted", "extension_only", "transformed", "unsupported"]),
    fieldPath: z.string().trim().min(1).max(240),
    affectedItems: z.number().int().min(1).max(100),
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .superRefine((finding, context) => {
    if ((finding.severity === "error") !== (finding.disposition === "unsupported"))
      context.addIssue({
        code: "custom",
        path: ["disposition"],
        message: "Only unsupported content is a blocking export error",
      });
  });
export type RecoveryPackExportFinding = z.infer<typeof RecoveryPackExportFindingSchema>;

/** Identifies a frozen source without embedding media, credentials, or authored findings. */
export const RecoveryPackExportSourceSchema = z
  .object({
    artifactType: z.literal("recovery_pack"),
    packId: z.string().uuid(),
    packVersionId: z.string().uuid(),
    packVersion: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    title: z.string().trim().min(1).max(160),
  })
  .strict();
export type RecoveryPackExportSource = z.infer<typeof RecoveryPackExportSourceSchema>;

/** Deterministic, content-version-bound advice; no generation timestamp or learner evidence. */
export const RecoveryPackExportReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    format: RecoveryPackExportFormatSchema,
    source: RecoveryPackExportSourceSchema,
    checkpointCount: z.number().int().min(2).max(3),
    exportedCheckpointCount: z.number().int().min(0).max(3),
    canExport: z.boolean(),
    findings: z.array(RecoveryPackExportFindingSchema).max(100),
  })
  .strict()
  .superRefine((report, context) => {
    const blocking = report.findings.some((finding) => finding.severity === "error");
    if (report.canExport === blocking)
      context.addIssue({
        code: "custom",
        path: ["canExport"],
        message: "Export availability must match its blocking findings",
      });
    if (report.exportedCheckpointCount !== (report.canExport ? report.checkpointCount : 0))
      context.addIssue({
        code: "custom",
        path: ["exportedCheckpointCount"],
        message: "Exports contain every frozen checkpoint or are blocked without a partial file",
      });
  });
export type RecoveryPackExportReport = z.infer<typeof RecoveryPackExportReportSchema>;

export const RecoveryPackExportReportEnvelopeSchema = z
  .object({ report: RecoveryPackExportReportSchema })
  .strict();
export type RecoveryPackExportReportEnvelope = z.infer<
  typeof RecoveryPackExportReportEnvelopeSchema
>;

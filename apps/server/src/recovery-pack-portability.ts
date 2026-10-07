import {
  QuizContentSchema,
  RecoveryPackContentSchema,
  RecoveryPackExportReportSchema,
  type QuizDraft,
  type RecoveryPackExportFinding,
  type RecoveryPackExportFormat,
  type RecoveryPackExportReport,
} from "@openround/contracts";
import type { RecoveryPackVersionRecord } from "@openround/db";
import { csvFormulaEscapingRequired } from "./portability.js";
import { hasUnpairedSurrogate } from "./portable-text.js";
import { qtiExportTextIssues } from "./qti.js";

/** The format boundary contains original frozen checkpoints, not inserted Pack copies. */
export function recoveryPackExportProfile(
  version: RecoveryPackVersionRecord,
  format: RecoveryPackExportFormat,
): { report: RecoveryPackExportReport; draft: QuizDraft | null } {
  const checkpointCount = version.content.delayedProbe ? 3 : 2;
  const findings: RecoveryPackExportFinding[] = [];
  const add = (
    code: string,
    disposition: RecoveryPackExportFinding["disposition"],
    fieldPath: string,
    affectedItems: number,
    reason: string,
    severity: RecoveryPackExportFinding["severity"] = "warning",
  ) => findings.push({ code, severity, disposition, fieldPath, affectedItems, reason });
  const finish = (draft: QuizDraft | null) => ({
    draft,
    report: RecoveryPackExportReportSchema.parse({
      schemaVersion: 1,
      format,
      source: {
        artifactType: "recovery_pack",
        packId: version.packId,
        packVersionId: version.id,
        packVersion: version.version,
        contentHash: version.contentHash,
        title: version.content.title,
      },
      checkpointCount,
      exportedCheckpointCount: draft ? checkpointCount : 0,
      canExport: Boolean(draft),
      findings,
    }),
  });
  const parsed = RecoveryPackContentSchema.safeParse(version.content);
  if (!parsed.success) {
    add(
      "INVALID_RECOVERY_PACK_CONTENT",
      "unsupported",
      "content",
      1,
      "The frozen content does not satisfy the published Recovery Pack checkpoint profile. No checkpoints are exported.",
      "error",
    );
    return finish(null);
  }
  const content = parsed.data;
  const checkpoints = [
    { role: "diagnostic", question: content.diagnostic },
    { role: "recheck", question: content.recheck },
    ...(content.delayedProbe ? [{ role: "delayedProbe", question: content.delayedProbe }] : []),
  ];
  const complete = QuizContentSchema.safeParse({
    title: content.title,
    description: "",
    questions: checkpoints.map(({ question }) => structuredClone(question)),
  });
  if (!complete.success) {
    add(
      "INVALID_CHECKPOINT_SET",
      "unsupported",
      "checkpoints",
      checkpointCount,
      "The frozen checkpoints cannot be represented by the supported checkpoint-set profile. No checkpoints are exported.",
      "error",
    );
    return finish(null);
  }
  if (format === "qti3") {
    for (const problem of qtiExportTextIssues(complete.data)) {
      const fieldPath = (problem.field ?? "checkpoints").replace(
        /^questions\.(\d+)\./,
        (_, index: string) => `${checkpoints[Number(index)]!.role}.`,
      );
      add(problem.code, "unsupported", fieldPath, 1, problem.message, "error");
    }
  } else {
    for (const { role, question } of checkpoints) {
      const cells = [
        { field: "prompt", value: question.prompt },
        { field: "explanation", value: question.explanation },
        ...(question.type === "numeric" ? [{ field: "unit", value: question.unit ?? "" }] : []),
      ];
      for (const cell of cells) {
        if (hasUnpairedSurrogate(cell.value)) {
          add(
            "INVALID_CSV_UNICODE",
            "unsupported",
            `${role}.${cell.field}`,
            1,
            "This exported text contains an unpaired Unicode surrogate that UTF-8 encoding would replace. No CSV checkpoints are exported.",
            "error",
          );
        }
      }
    }
  }
  if (findings.some((finding) => finding.severity === "error")) return finish(null);
  add(
    "PACK_PROVENANCE_OMITTED",
    "omitted",
    "source",
    1,
    "Converted checkpoints do not restore Pack identity, version, content hash, Pack-role attribution or the immutable Pack baseline. This report identifies the frozen source; use the original Pack JSON to retain Pack content.",
  );
  add(
    "PACK_SEQUENCE_OMITTED",
    "omitted",
    "content",
    1,
    "Checkpoints are exported as a checkpoint set, not a Recovery Pack learning sequence. Intervention playback and delayed-probe scheduling are not represented.",
  );
  add(
    "PACK_INTERVENTIONS_OMITTED",
    "omitted",
    "interventions",
    content.interventions.length,
    "Intervention card IDs, titles and bodies are not included in the checkpoint export.",
  );
  const cardCitations = content.interventions.reduce(
    (count, card) => count + card.citations.length,
    0,
  );
  if (cardCitations) {
    add(
      "INTERVENTION_CITATIONS_OMITTED",
      "omitted",
      "interventions[*].citations",
      cardCitations,
      "Intervention source citations are not included in the checkpoint export.",
    );
  }
  if (content.citations.length) {
    add(
      "PACK_CITATIONS_OMITTED",
      "omitted",
      "citations",
      content.citations.length,
      "Pack-level source citations are not included in the checkpoint export.",
    );
  }
  add(
    "PACK_CONCEPT_GROUPING_OMITTED",
    "omitted",
    "conceptKeys",
    content.conceptKeys.length,
    "Pack-level concept grouping is not restored. Individual checkpoint concept keys are retained in CSV columns or OpenRound QTI extension metadata.",
  );
  if (content.misconceptionKeys.length) {
    add(
      "PACK_MISCONCEPTION_GROUPING_OMITTED",
      "omitted",
      "misconceptionKeys",
      content.misconceptionKeys.length,
      "Pack-level misconception grouping is not restored. Authored choice misconception keys are retained in CSV or OpenRound QTI extension metadata.",
    );
  }
  if (content.description) {
    add(
      "PACK_DESCRIPTION_OMITTED",
      "omitted",
      "description",
      1,
      "The Pack description is not included in the checkpoint export.",
    );
  }
  add(
    format === "csv" ? "PACK_TITLE_OMITTED" : "PACK_TITLE_TRANSFORMED",
    format === "csv" ? "omitted" : "transformed",
    "title",
    1,
    format === "csv"
      ? "CSV has no Pack title column. Choose a checkpoint-set title when importing."
      : "QTI item titles include the Pack title and checkpoint prompt, truncated to 160 characters. They are not a canonical Pack title and do not restore it on import.",
  );
  add(
    "IMPORTED_IDS_TRANSFORMED",
    "transformed",
    "checkpoints[*].id",
    checkpointCount,
    "OpenRound checkpoint-set import assigns fresh checkpoint and choice IDs while remapping the diagnostic-to-recheck link. The export uses the original frozen checkpoint IDs.",
  );
  for (const { role, question } of checkpoints) {
    if (question.mediaId || question.mediaAlt) {
      add(
        "CHECKPOINT_MEDIA_OMITTED",
        "omitted",
        `${role}.media`,
        1,
        "Private media references, bytes, URLs and alternative text are not included. Attach media again after import.",
      );
    }
    if (question.sourceCitations?.length) {
      add(
        "CHECKPOINT_CITATIONS_OMITTED",
        "omitted",
        `${role}.sourceCitations`,
        question.sourceCitations.length,
        "Checkpoint source citations are not included in the checkpoint export.",
      );
    }
    if (format === "csv") {
      const cells = [
        question.prompt,
        question.explanation,
        ...(question.type === "numeric"
          ? [question.correctValue, question.tolerance, question.unit ?? ""]
          : []),
      ];
      if (cells.some(csvFormulaEscapingRequired)) {
        add(
          "CSV_FORMULA_ESCAPED",
          "transformed",
          role,
          1,
          "Spreadsheet-like cell prefixes are protected with a leading apostrophe, including negative numeric answers where present. OpenRound CSV import removes that protection and retains the original values.",
        );
      }
      if (cells.some((cell) => cell.startsWith("'") && csvFormulaEscapingRequired(cell.slice(1)))) {
        add(
          "CSV_LITERAL_APOSTROPHE_AMBIGUOUS",
          "transformed",
          role,
          1,
          "An authored leading apostrophe before a spreadsheet-like prefix is indistinguishable from CSV formula protection. OpenRound CSV import removes that apostrophe; use original Pack JSON when its exact text matters.",
        );
      }
    }
  }
  if (format === "qti3") {
    add(
      "QTI_OPENROUND_METADATA",
      "extension_only",
      "checkpoints",
      checkpointCount,
      "Checkpoint purpose, confidence, delivery, concept keys, linked recheck, time limit, base points and explanation are retained in OPENROUND_METADATA, not native QTI learning-flow or feedback fields. Other QTI consumers may ignore this extension; standard scoring uses normalized 0/1 outcomes.",
    );
    const choiceMetadata = checkpoints.reduce(
      (count, { question }) =>
        count +
        ("choices" in question
          ? question.choices.filter((choice) => choice.feedback || choice.misconceptionKey).length
          : 0),
      0,
    );
    if (choiceMetadata) {
      add(
        "QTI_CHOICE_METADATA",
        "extension_only",
        "checkpoints[*].choices",
        choiceMetadata,
        "Authored choice feedback and misconception keys are retained in OPENROUND_METADATA, not standard QTI feedback declarations. Other QTI consumers may ignore these fields.",
      );
    }
    const numericCount = checkpoints.filter(({ question }) => question.type === "numeric").length;
    if (numericCount) {
      add(
        "QTI_NUMERIC_METADATA",
        "extension_only",
        "checkpoints[*].numeric",
        numericCount,
        "Tolerance is encoded in standard QTI response-processing bounds and units appear in visible item text. OpenRound restoration of the authored tolerance and unit fields uses OPENROUND_METADATA.",
      );
      add(
        "QTI_NUMERIC_FLOAT_PRECISION",
        "transformed",
        "checkpoints[*].correctValue",
        numericCount,
        "QTI numeric responses use the float base type, so external engines may round decimal values or tolerance bounds. The exporter constructs exact decimal strings and OpenRound reimport preserves those strings; CSV also retains them exactly.",
      );
    }
  }
  return finish(complete.data);
}

/** A defensive serializer failure must not expose validation payloads or private references. */
export function blockedRecoveryPackExportReport(report: RecoveryPackExportReport) {
  return RecoveryPackExportReportSchema.parse({
    ...report,
    canExport: false,
    exportedCheckpointCount: 0,
    findings: [
      ...report.findings,
      {
        code: "EXPORT_PROFILE_UNSUPPORTED",
        severity: "error",
        disposition: "unsupported",
        fieldPath: "checkpoints",
        affectedItems: report.checkpointCount,
        reason:
          "The checkpoint serializer rejected this frozen content. No checkpoints are exported.",
      },
    ],
  });
}

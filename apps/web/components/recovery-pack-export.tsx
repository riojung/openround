"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { RecoveryPackExportReport } from "@openround/contracts";
import {
  createPackExportReview,
  type PackExportFormat,
  type PackExportReviewState,
  type PackExportSource,
} from "../lib/recovery-pack-export";

export function PackExportReportView({ report }: { report: RecoveryPackExportReport }) {
  return (
    <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
      <p lang="">{report.source.title}</p>
      <dl>
        <dt>Frozen published version</dt>
        <dd>
          {report.source.packVersion} · {report.source.packVersionId}
        </dd>
        <dt>Content hash (SHA-256)</dt>
        <dd>
          <code>{report.source.contentHash}</code>
        </dd>
        <dt>Checkpoint projection</dt>
        <dd>
          {report.exportedCheckpointCount} of {report.checkpointCount} checkpoints exportable ·{" "}
          {report.format === "csv" ? "CSV" : "QTI 3"}
        </dd>
      </dl>
      <h4>Export findings</h4>
      {report.findings.length ? (
        <ul aria-label="Export findings">
          {report.findings.map((finding, index) => (
            <li key={index}>
              <strong>
                {finding.severity === "error" ? "Error" : "Warning"}: {finding.code}
              </strong>
              <p>
                <code>{finding.fieldPath}</code> · {finding.disposition.replaceAll("_", " ")} ·{" "}
                {finding.affectedItems} affected {finding.affectedItems === 1 ? "item" : "items"}
              </p>
              <p lang="">{finding.reason}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p>No findings for this checkpoint projection.</p>
      )}
      {!report.canExport ? (
        <p className="notice">
          This format cannot export all checkpoints. Review the errors; the artifact download is
          unavailable. You can still download this report.
        </p>
      ) : null}
    </div>
  );
}

export function RecoveryPackExportPanel({
  source,
  disabled = false,
}: {
  source: PackExportSource;
  disabled?: boolean;
}) {
  const formatId = useId();
  const headingId = useId();
  const [state, setState] = useState<PackExportReviewState>({
    format: "csv",
    report: null,
    busy: null,
    error: "",
    status: "",
  });
  const alive = useRef(true);
  const reportHeading = useRef<HTMLHeadingElement>(null);
  const errorParagraph = useRef<HTMLParagraphElement>(null);
  const manager = useRef<ReturnType<typeof createPackExportReview> | null>(null);
  if (!manager.current) {
    manager.current = createPackExportReview({
      source,
      onState: (next) => {
        if (alive.current) setState(next);
      },
    });
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      manager.current?.cancel();
    };
  }, []);
  useEffect(() => {
    if (state.error) errorParagraph.current?.focus();
    else if (state.report) reportHeading.current?.focus();
  }, [state.error, state.report]);
  return (
    <section
      aria-labelledby={headingId}
      style={{ minWidth: 0, overflowWrap: "anywhere", marginTop: 24 }}
    >
      <h3 id={headingId}>Checkpoint portability</h3>
      <p>
        CSV and QTI 3 export checkpoint projections, not the whole Recovery Pack workflow. Review
        each format’s structured losses first. Polling Pops JSON keeps the complete Pack content;
        media references are included, not the private media files.
      </p>
      <label className="field" htmlFor={formatId}>
        <span>Published Pack export format</span>
        <select
          id={formatId}
          className="select"
          value={state.format}
          disabled={disabled || state.busy === "artifact"}
          onChange={(event) =>
            manager.current!.selectFormat(event.target.value as PackExportFormat)
          }
        >
          <option value="csv">CSV checkpoints</option>
          <option value="qti3">QTI 3 checkpoint package</option>
        </select>
      </label>
      <button
        className="button-quiet"
        type="button"
        disabled={disabled || Boolean(state.busy)}
        onClick={() => void manager.current!.preview()}
      >
        Review export losses
      </button>
      <p role="status" aria-live="polite">
        {state.status}
      </p>
      {state.error ? (
        <p className="error" role="alert" tabIndex={-1} ref={errorParagraph}>
          {state.error}
        </p>
      ) : null}
      {state.report ? (
        <>
          <h4 tabIndex={-1} ref={reportHeading}>
            Reviewed {state.format === "csv" ? "CSV" : "QTI 3"} export
          </h4>
          <PackExportReportView report={state.report} />
        </>
      ) : null}
      <div className="button-row">
        <button
          className="button"
          type="button"
          disabled={disabled || Boolean(state.busy) || !state.report?.canExport}
          onClick={() => void manager.current!.artifact()}
        >
          {state.format === "csv" ? "Download CSV checkpoints" : "Download QTI 3 package"}
        </button>
        <button
          className="button-quiet"
          type="button"
          disabled={disabled || Boolean(state.busy) || !state.report}
          onClick={() => manager.current!.report()}
        >
          Download export report JSON
        </button>
      </div>
    </section>
  );
}

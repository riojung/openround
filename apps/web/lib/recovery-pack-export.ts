import {
  RecoveryPackExportReportSchema,
  type RecoveryPackExportReport,
} from "@openround/contracts";
import { API_URL, ApiClientError, apiFetch, humanError } from "./api";

export type PackExportFormat = RecoveryPackExportReport["format"];
export type PackExportSource = RecoveryPackExportReport["source"];
export interface PackExportReviewState {
  format: PackExportFormat;
  report: RecoveryPackExportReport | null;
  busy: "preview" | "artifact" | null;
  error: string;
  status: string;
}

export function packExportReportPath(versionId: string, format: PackExportFormat) {
  return `/v1/recovery-packs/versions/${encodeURIComponent(versionId)}/export-report?format=${format}`;
}

export function validatePackExportReport(
  value: unknown,
  source: PackExportSource,
  format: PackExportFormat,
) {
  const parsed = RecoveryPackExportReportSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.format !== format ||
    Object.entries(source).some(
      ([field, expected]) => parsed.data.source[field as keyof PackExportSource] !== expected,
    )
  )
    throw new Error(
      "The export report does not match this frozen Pack version and format. Review again.",
    );
  return parsed.data;
}

export async function fetchPackExportReport(
  source: PackExportSource,
  format: PackExportFormat,
  signal: AbortSignal,
) {
  const result = await apiFetch<{ report: unknown }>(
    packExportReportPath(source.packVersionId, format),
    { signal },
  );
  return result.report;
}

export async function fetchPackExportArtifact(
  report: RecoveryPackExportReport,
  signal: AbortSignal,
) {
  const csv = report.format === "csv";
  const path = `/v1/recovery-packs/versions/${encodeURIComponent(report.source.packVersionId)}/export.${csv ? "csv" : "qti.zip"}`;
  const mime = csv ? "text/csv" : "application/zip";
  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: { accept: mime },
    signal,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new ApiClientError(
      body?.error?.message ?? `Request failed (${response.status})`,
      body?.error?.code,
      response.status,
    );
  }
  if (
    response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== mime ||
    response.headers.get("x-openround-export-report") !==
      packExportReportPath(report.source.packVersionId, report.format)
  )
    throw new Error("The download does not match the reviewed export. No file was downloaded.");
  return response.blob();
}

export function downloadPackExportBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  try {
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    // Let the browser consume the click before revoking the temporary URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export function createPackExportReview({
  source,
  fetchReport = fetchPackExportReport,
  fetchArtifact = fetchPackExportArtifact,
  download = downloadPackExportBlob,
  onState,
}: {
  source: PackExportSource;
  fetchReport?: typeof fetchPackExportReport;
  fetchArtifact?: typeof fetchPackExportArtifact;
  download?: typeof downloadPackExportBlob;
  onState: (state: PackExportReviewState) => void;
}) {
  const frozenSource = Object.freeze(structuredClone(source));
  let generation = 0;
  let controller: AbortController | null = null;
  let state: PackExportReviewState = {
    format: "csv",
    report: null,
    busy: null,
    error: "",
    status: "",
  };
  const publish = (next: PackExportReviewState) => {
    state = next;
    onState(next);
  };
  const current = (captured: number, signal: AbortSignal) =>
    captured === generation && !signal.aborted;
  const begin = () => {
    generation += 1;
    controller?.abort();
    controller = new AbortController();
    return { captured: generation, signal: controller.signal };
  };
  return {
    state: () => state,
    selectFormat(format: PackExportFormat) {
      if (state.busy === "artifact" || format === state.format) return;
      generation += 1;
      controller?.abort();
      publish({
        format,
        report: null,
        busy: null,
        error: "",
        status: "Review this format before downloading.",
      });
    },
    async preview() {
      if (state.busy) return;
      const format = state.format;
      const { captured, signal } = begin();
      publish({
        ...state,
        report: null,
        busy: "preview",
        error: "",
        status: "Reviewing frozen export losses…",
      });
      try {
        const raw = await fetchReport(frozenSource, format, signal);
        if (!current(captured, signal)) return;
        const report = validatePackExportReport(raw, frozenSource, format);
        publish({
          ...state,
          report,
          busy: null,
          status: "Export losses reviewed. Check the findings before downloading.",
        });
      } catch (error) {
        if (current(captured, signal))
          publish({
            ...state,
            busy: null,
            error: humanError(error),
            status: "No export report was accepted. Review again to retry.",
          });
      }
    },
    async artifact() {
      if (state.busy || !state.report?.canExport) return;
      let report: RecoveryPackExportReport;
      try {
        report = validatePackExportReport(state.report, frozenSource, state.format);
      } catch (error) {
        publish({
          ...state,
          report: null,
          error: humanError(error),
          status: "No verified export is available. Review again before downloading.",
        });
        return;
      }
      const { captured, signal } = begin();
      publish({
        ...state,
        busy: "artifact",
        error: "",
        status: "Receiving the reviewed frozen export…",
      });
      try {
        const blob = await fetchArtifact(report, signal);
        if (!current(captured, signal)) return;
        download(
          blob,
          `polling-pops-recovery-pack-${report.source.packVersionId}.${report.format === "csv" ? "csv" : "qti.zip"}`,
        );
        publish({
          ...state,
          busy: null,
          status: "Reviewed export download started. Check your browser’s downloads.",
        });
      } catch (error) {
        if (current(captured, signal))
          publish({
            ...state,
            busy: null,
            error: humanError(error),
            status: "No file download started. Retry the same reviewed export.",
          });
      }
    },
    report() {
      if (state.busy || !state.report) return;
      try {
        const report = validatePackExportReport(state.report, frozenSource, state.format);
        download(
          new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
          `polling-pops-recovery-pack-${report.source.packVersionId}-${report.format}-export-report.json`,
        );
        publish({ ...state, error: "", status: "Validated export report download started." });
      } catch (error) {
        publish({ ...state, error: humanError(error), status: "No report download started." });
      }
    },
    cancel() {
      generation += 1;
      controller?.abort();
      state = { ...state, busy: null };
    },
  };
}

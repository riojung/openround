import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecoveryPackExportReport } from "@openround/contracts";
import { ApiClientError } from "./api";
import { exportReport, exportSource } from "../test-utils/recovery-pack-export";
import {
  createPackExportReview,
  downloadPackExportBlob,
  fetchPackExportArtifact,
  packExportReportPath,
  validatePackExportReport,
} from "./recovery-pack-export";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("frozen Pack export review", () => {
  it("requires strict reports with the same format and every frozen source field", () => {
    const report = exportReport();
    expect(validatePackExportReport(report, exportSource, "csv")).toEqual(report);
    for (const field of Object.keys(exportSource)) {
      const mismatched = structuredClone(report);
      Object.assign(mismatched.source, { [field]: field === "packVersion" ? 4 : "wrong" });
      expect(() => validatePackExportReport(mismatched, exportSource, "csv")).toThrow(
        "does not match",
      );
    }
    expect(() => validatePackExportReport(report, exportSource, "qti3")).toThrow();
    expect(() =>
      validatePackExportReport({ ...report, privateAssetUrl: "secret" }, exportSource, "csv"),
    ).toThrow();
    expect(() =>
      validatePackExportReport({ ...report, exportedCheckpointCount: 1 }, exportSource, "csv"),
    ).toThrow();
  });

  it("does not request or download before an explicit preview and serializes parallel clicks", async () => {
    let resolve!: (report: RecoveryPackExportReport) => void;
    const fetchReport = vi.fn(
      () =>
        new Promise<RecoveryPackExportReport>((done) => {
          resolve = done;
        }),
    );
    const fetchArtifact = vi.fn();
    const download = vi.fn();
    const manager = createPackExportReview({
      source: exportSource,
      fetchReport,
      fetchArtifact,
      download,
      onState: vi.fn(),
    });
    await manager.artifact();
    manager.report();
    expect(fetchReport).not.toHaveBeenCalled();
    expect(fetchArtifact).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    const preview = manager.preview();
    await manager.preview();
    expect(fetchReport).toHaveBeenCalledTimes(1);
    expect(manager.state().report).toBeNull();
    resolve(exportReport());
    await preview;
    expect(manager.state().report).toEqual(exportReport());
  });

  it("aborts and fences a stale CSV report after switching to QTI", async () => {
    let resolve!: (report: RecoveryPackExportReport) => void;
    const fetchReport = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<RecoveryPackExportReport>((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValueOnce(exportReport("qti3"));
    const manager = createPackExportReview({ source: exportSource, fetchReport, onState: vi.fn() });
    const csv = manager.preview();
    manager.selectFormat("qti3");
    expect(fetchReport.mock.calls[0]![2].aborted).toBe(true);
    await manager.preview();
    resolve(exportReport());
    await csv;
    expect(manager.state()).toMatchObject({
      format: "qti3",
      report: { format: "qti3" },
      busy: null,
      error: "",
    });
  });

  it("never adopts a late report or artifact from a replaced source/workspace instance", async () => {
    let resolveReport!: (report: RecoveryPackExportReport) => void;
    const onState = vi.fn();
    const manager = createPackExportReview({
      source: exportSource,
      fetchReport: () =>
        new Promise((done) => {
          resolveReport = done;
        }),
      onState,
    });
    const preview = manager.preview();
    manager.cancel();
    const callbacks = onState.mock.calls.length;
    resolveReport(exportReport());
    await preview;
    expect(onState).toHaveBeenCalledTimes(callbacks);
    expect(manager.state().report).toBeNull();

    let resolveBlob!: (blob: Blob) => void;
    const download = vi.fn();
    const downloading = createPackExportReview({
      source: exportSource,
      fetchReport: async () => exportReport(),
      fetchArtifact: () =>
        new Promise((done) => {
          resolveBlob = done;
        }),
      download,
      onState,
    });
    await downloading.preview();
    const artifact = downloading.artifact();
    downloading.cancel();
    resolveBlob(new Blob(["old workspace export"]));
    await artifact;
    expect(download).not.toHaveBeenCalled();
  });

  it("retains the validated report through a failed transfer and retries the same pinned artifact", async () => {
    let reject!: (error: unknown) => void;
    const fetchArtifact = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Blob>((_done, fail) => {
            reject = fail;
          }),
      )
      .mockResolvedValueOnce(new Blob(["frozen CSV"]));
    const download = vi.fn();
    const manager = createPackExportReview({
      source: exportSource,
      fetchReport: async () => exportReport(),
      fetchArtifact,
      download,
      onState: vi.fn(),
    });
    await manager.preview();
    const attempt = manager.artifact();
    manager.selectFormat("qti3");
    await manager.artifact();
    manager.report();
    expect(manager.state()).toMatchObject({ format: "csv", busy: "artifact" });
    expect(download).not.toHaveBeenCalled();
    expect(fetchArtifact).toHaveBeenCalledTimes(1);
    reject(new ApiClientError("Download paused", "FEATURE_DISABLED", 503));
    await attempt;
    expect(manager.state()).toMatchObject({
      report: exportReport(),
      busy: null,
      error: "Download paused",
    });
    expect(manager.state().status).toBe(
      "No file download started. Retry the same reviewed export.",
    );
    expect(download).not.toHaveBeenCalled();
    await manager.artifact();
    expect(fetchArtifact.mock.calls[1]![0]).toEqual(fetchArtifact.mock.calls[0]![0]);
    expect(download).toHaveBeenCalledTimes(1);
    expect(download.mock.calls[0]![1]).toBe(
      `polling-pops-recovery-pack-${exportSource.packVersionId}.csv`,
    );
  });

  it("blocks artifacts but permits an identical validated JSON report for an unsupported projection", async () => {
    const report = {
      ...exportReport("qti3"),
      canExport: false,
      exportedCheckpointCount: 0,
      findings: [
        {
          code: "QUESTION_UNSUPPORTED",
          severity: "error" as const,
          disposition: "unsupported" as const,
          fieldPath: "diagnostic",
          affectedItems: 1,
          reason: "This checkpoint cannot be represented.",
        },
      ],
    };
    const download = vi.fn();
    const fetchArtifact = vi.fn();
    const manager = createPackExportReview({
      source: exportSource,
      fetchReport: async () => report,
      fetchArtifact,
      download,
      onState: vi.fn(),
    });
    manager.selectFormat("qti3");
    await manager.preview();
    await manager.artifact();
    expect(fetchArtifact).not.toHaveBeenCalled();
    manager.report();
    expect(JSON.parse(await (download.mock.calls[0]![0] as Blob).text())).toEqual(report);
    expect(download.mock.calls[0]![1]).toBe(
      `polling-pops-recovery-pack-${exportSource.packVersionId}-qti3-export-report.json`,
    );
  });
});

describe("raw Pack artifact transfer", () => {
  it.each([401, 422, 500])("never turns a %s error response into a file", async (status) => {
    const response = new Response(
      JSON.stringify({ error: { code: "EXPORT_FAILED", message: "No export available" } }),
      { status, headers: { "content-type": "application/json" } },
    );
    const blob = vi.spyOn(response, "blob");
    const fetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetch);
    await expect(
      fetchPackExportArtifact(exportReport(), new AbortController().signal),
    ).rejects.toMatchObject({ status, message: "No export available" });
    expect(blob).not.toHaveBeenCalled();
    expect(fetch.mock.calls[0]![1]).toMatchObject({
      credentials: "include",
      headers: { accept: "text/csv" },
    });
  });

  it.each([
    ["application/json", packExportReportPath(exportSource.packVersionId, "csv")],
    ["text/csv", packExportReportPath(exportSource.packVersionId, "qti3")],
    ["text/csv", packExportReportPath("another-version", "csv")],
  ])("rejects an unreviewed MIME/report-header pair %s %s", async (mime, header) => {
    const response = new Response("not a validated export", {
      headers: { "content-type": mime, "x-openround-export-report": header },
    });
    const blob = vi.spyOn(response, "blob");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(
      fetchPackExportArtifact(exportReport(), new AbortController().signal),
    ).rejects.toThrow("does not match");
    expect(blob).not.toHaveBeenCalled();
  });

  it("reads real CSV bytes only after successful response metadata", async () => {
    const response = new Response("prompt,answer\nFrozen checkpoint,4", {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "x-openround-export-report": packExportReportPath(exportSource.packVersionId, "csv"),
      },
    });
    const fetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetch);
    const blob = await fetchPackExportArtifact(exportReport(), new AbortController().signal);
    expect(await blob.text()).toContain("Frozen checkpoint");
    expect(fetch.mock.calls[0]![0]).toContain(`/versions/${exportSource.packVersionId}/export.csv`);
  });

  it("creates and revokes only temporary object URLs without opening a popup", () => {
    vi.useFakeTimers();
    const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    const append = vi.fn();
    vi.stubGlobal("document", { createElement: vi.fn(() => anchor), body: { append } });
    vi.stubGlobal("window", { setTimeout });
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:temporary-export");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    downloadPackExportBlob(new Blob(["frozen"]), "export.csv");
    expect(create).toHaveBeenCalledOnce();
    expect(anchor).toMatchObject({ href: "blob:temporary-export", download: "export.csv" });
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:temporary-export");
  });
});

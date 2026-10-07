import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { exportReport, exportSource } from "../test-utils/recovery-pack-export";
import { PackExportReportView, RecoveryPackExportPanel } from "./recovery-pack-export";

describe("published Recovery Pack export panel", () => {
  it("starts read-only with a labeled format, review action, disabled downloads and no automatic fetch", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const markup = renderToStaticMarkup(<RecoveryPackExportPanel source={exportSource} />);
    expect(markup).toContain("Published Pack export format");
    expect(markup).toContain("CSV checkpoints");
    expect(markup).toContain("QTI 3 checkpoint package");
    expect(markup).toContain("Review export losses");
    expect(markup).toContain("complete Pack content");
    expect(markup).toContain("not the private media files");
    expect(markup).toMatch(/disabled=""[^>]*>Download CSV checkpoints/);
    expect(markup).toMatch(/disabled=""[^>]*>Download export report JSON/);
    expect(markup).toContain('role="status" aria-live="polite"');
    expect(markup).not.toContain("target=");
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });

  it("renders frozen source/count and every structured loss as wrapping plaintext", () => {
    const report = exportReport();
    report.findings[0]!.reason = "<script>notHtml()</script> " + "LongCitationOrTerm".repeat(30);
    const markup = renderToStaticMarkup(<PackExportReportView report={report} />);
    for (const visible of [
      report.source.packVersionId,
      report.source.contentHash,
      "2 of 2 checkpoints",
      "WORKFLOW_OMITTED",
      "interventions",
      "omitted",
      "1 affected item",
    ])
      expect(markup).toContain(visible);
    expect(markup).toContain("Frozen &lt; Recovery Pack");
    expect(markup).toContain("&lt;script&gt;notHtml()&lt;/script&gt;");
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("min-width:0;overflow-wrap:anywhere");
  });
});

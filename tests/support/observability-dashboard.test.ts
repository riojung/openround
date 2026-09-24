import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

interface DashboardPanel {
  id: number;
  title: string;
  description?: string;
  panels?: DashboardPanel[];
  targets?: Array<{ expr?: string }>;
}

async function dashboardPanels() {
  const dashboard = JSON.parse(
    await readFile(
      join(repositoryRoot, "infra/observability/grafana/dashboards/openround-overview.json"),
      "utf8",
    ),
  ) as { panels: DashboardPanel[] };
  const flatten = (panels: DashboardPanel[]): DashboardPanel[] =>
    panels.flatMap((panel) => [panel, ...flatten(panel.panels ?? [])]);
  return flatten(dashboard.panels);
}

describe("provisioned operations dashboard", () => {
  it("shows canonical recovery stages only as aggregate volume", async () => {
    const panel = (await dashboardPanels()).find(
      ({ title }) => title === "Server-recorded recovery stage volume",
    );

    expect(panel).toBeDefined();
    expect(panel?.description).toMatch(/different counting units/i);
    expect(panel?.description).toMatch(/not a cohort funnel/i);
    expect(panel?.description).toMatch(/browser-submitted telemetry is excluded/i);
    expect(panel?.targets).toHaveLength(1);
    const expression = panel?.targets?.[0]?.expr ?? "";
    expect(expression).toContain("openround_recovery_funnel_stages_total");
    expect(expression).toContain("sum by (stage, artifact_type, segment)");
    expect(expression).toContain('artifact_type=~"round|presentation"');
    expect(expression).toContain('segment=~"education|workplace"');
  });

  it("exposes every Presentation latency signal used by the target-region gate", async () => {
    const panel = (await dashboardPanels()).find(
      ({ title }) => title === "Presentation latency SLOs",
    );
    const expressions = panel?.targets?.map(({ expr = "" }) => expr).join("\n") ?? "";

    expect(panel).toBeDefined();
    expect(expressions).toContain("openround_presentation_admission_duration_seconds_bucket");
    expect(expressions).toContain(
      "openround_presentation_response_acknowledgement_duration_seconds_bucket",
    );
    expect(expressions).toContain(
      "openround_presentation_client_event_receipt_duration_seconds_bucket",
    );
    expect(expressions).toContain("histogram_quantile(0.95");
    expect(expressions).toContain("histogram_quantile(0.99");
  });
});

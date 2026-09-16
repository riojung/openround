import { describe, expect, it } from "vitest";
import { MetricsService } from "../src/metrics.js";

describe("MetricsService", () => {
  it("records bounded client event receipt dimensions", async () => {
    const metrics = new MetricsService();

    metrics.observeClientEventReceipt("question.open", "participant", "acknowledged", 0.12);
    metrics.observeClientEventReceipt("unexpected.dynamic.event", "host", "timeout", 5);

    const rendered = await metrics.render();
    expect(rendered).toContain(
      'openround_client_event_receipt_duration_seconds_count{event_type="question.open",role="participant",outcome="acknowledged"} 1',
    );
    expect(rendered).toContain(
      'openround_client_event_receipt_duration_seconds_count{event_type="other",role="host",outcome="timeout"} 1',
    );
    expect(rendered).not.toContain("unexpected.dynamic.event");
  });
});

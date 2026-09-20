import { describe, expect, it } from "vitest";
import { MetricsService } from "../src/metrics.js";

describe("MetricsService", () => {
  it("records bounded client event receipt dimensions", async () => {
    const metrics = new MetricsService();

    metrics.observeClientEventReceipt("question.open", "participant", "acknowledged", 0.12);
    metrics.observeClientEventReceipt("audience.event", "presenter", "acknowledged", 0.08);
    metrics.observeClientEventReceipt("unexpected.dynamic.event", "host", "timeout", 5);

    const rendered = await metrics.render();
    expect(rendered).toContain(
      'openround_client_event_receipt_duration_seconds_count{event_type="question.open",role="participant",outcome="acknowledged"} 1',
    );
    expect(rendered).toContain(
      'openround_client_event_receipt_duration_seconds_count{event_type="audience.event",role="presenter",outcome="acknowledged"} 1',
    );
    expect(rendered).toContain(
      'openround_client_event_receipt_duration_seconds_count{event_type="other",role="host",outcome="timeout"} 1',
    );
    expect(rendered).not.toContain("unexpected.dynamic.event");
  });

  it("records answer commit wait and persistence without session labels", async () => {
    const metrics = new MetricsService();

    metrics.observeAnswerCommitStage("wait", 0.003);
    metrics.observeAnswerCommitStage("persist", 0.04);

    const rendered = await metrics.render();
    expect(rendered).toContain(
      'openround_answer_commit_stage_duration_seconds_count{stage="wait"} 1',
    );
    expect(rendered).toContain(
      'openround_answer_commit_stage_duration_seconds_count{stage="persist"} 1',
    );
  });

  it("records authoring completion and failure attempts without workspace labels", async () => {
    const metrics = new MetricsService();
    metrics.recordAuthoringJob("pdf", "completed", 1.25);
    metrics.recordAuthoringJob("docx", "failed_extraction", 0.05);

    const rendered = await metrics.render();
    expect(rendered).toContain(
      'openround_authoring_jobs_total{source_type="pdf",outcome="completed"} 1',
    );
    expect(rendered).toContain(
      'openround_authoring_job_duration_seconds_count{source_type="docx",outcome="failed_extraction"} 1',
    );
  });

  it("records only the bounded artifact type for authoring product events", async () => {
    const metrics = new MetricsService();

    metrics.recordProductEvent({
      name: "draft_conflict",
      dimensions: { artifactType: "presentation" },
    });

    const rendered = await metrics.render();
    expect(rendered).toContain(
      'openround_product_events_total{name="draft_conflict",creation_path="none",recipe="none",scenario="none",segment="none",beta_version="none",duration_bucket="none",artifact_type="presentation"} 1',
    );
    expect(rendered).not.toMatch(/presentationId|artifactId|title|sourceText/);
  });

  it("records audit retention without workspace labels", async () => {
    const metrics = new MetricsService();
    metrics.recordRetention({
      expiredLiveSessions: 0,
      purgedSessions: 0,
      purgedPracticeAssignments: 4,
      purgedAuditEvents: 2,
      purgedProductEvents: 3,
      purgedMedia: 0,
      failedMedia: 0,
    });

    const rendered = await metrics.render();
    expect(rendered).toContain(
      'openround_retention_records_total{resource="audit_event",outcome="deleted"} 2',
    );
    expect(rendered).toContain(
      'openround_retention_records_total{resource="product_event",outcome="deleted"} 3',
    );
    expect(rendered).toContain(
      'openround_retention_records_total{resource="practice_assignment",outcome="deleted"} 4',
    );
  });
});

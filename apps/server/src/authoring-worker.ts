import type { Repository } from "@openround/db";
import { validateAuthoringOutput, type AuthoringAssistant } from "./authoring-assistant.js";
import {
  extractSourceIsolated,
  type ExtractedSource,
  type SourceExtractionInput,
} from "./source-extraction.js";
import type { MetricsService } from "./metrics.js";

export type AuthoringWorkerResult =
  "idle" | "completed" | "retry_scheduled" | "failed" | "superseded";

export class AuthoringWorker {
  constructor(
    private readonly repository: Repository,
    private readonly assistant: AuthoringAssistant | null,
    private readonly leaseMs: number,
    private readonly extractionTimeoutMs: number,
    private readonly metrics?: MetricsService,
    private readonly extractor: (
      input: SourceExtractionInput,
      timeoutMs: number,
    ) => Promise<ExtractedSource> = extractSourceIsolated,
  ) {}

  async runOnce(now = new Date()): Promise<AuthoringWorkerResult> {
    if (!this.assistant) return "idle";
    const job = await this.repository.claimAuthoringJob(
      now,
      new Date(now.getTime() + this.leaseMs),
    );
    if (!job) return "idle";
    const startedAt = performance.now();

    let source: ExtractedSource;
    try {
      source = await this.extractor(
        {
          sourceType: job.sourceType,
          sourceName: job.sourceName,
          sourceText: job.sourceText,
          sourceBlob: job.sourceBlob,
        },
        this.extractionTimeoutMs,
      );
    } catch (error) {
      const updated = await this.repository.retryAuthoringJob(
        job.id,
        job.attempts,
        error instanceof Error ? error.message : "Source extraction failed",
        now,
        true,
      );
      if (!updated) return "superseded";
      this.metrics?.recordAuthoringJob(
        job.sourceType,
        "failed_extraction",
        (performance.now() - startedAt) / 1_000,
      );
      return "failed";
    }

    try {
      const raw = await this.assistant.generate(source);
      const output = validateAuthoringOutput({
        raw,
        source,
        sourceDigest: job.sourceDigest,
        provider: this.assistant.providerName,
        model: this.assistant.modelName,
        generatedAt: now,
      });
      const completed = await this.repository.completeAuthoringJob(
        job.id,
        job.attempts,
        output,
        now,
      );
      if (!completed) return "superseded";
      this.metrics?.recordAuthoringJob(
        job.sourceType,
        "completed",
        (performance.now() - startedAt) / 1_000,
      );
      return "completed";
    } catch (error) {
      const failed = job.attempts >= 3;
      const delayMs = Math.min(60_000, 2_000 * 2 ** Math.max(0, job.attempts - 1));
      const updated = await this.repository.retryAuthoringJob(
        job.id,
        job.attempts,
        error instanceof Error ? error.message : "Authoring generation failed",
        new Date(now.getTime() + delayMs),
        failed,
      );
      if (!updated) return "superseded";
      this.metrics?.recordAuthoringJob(
        job.sourceType,
        failed ? "failed_generation" : "retry_scheduled",
        (performance.now() - startedAt) / 1_000,
      );
      return failed ? "failed" : "retry_scheduled";
    }
  }

  async runUntilIdle(limit = 25) {
    const results: AuthoringWorkerResult[] = [];
    for (let index = 0; index < limit; index += 1) {
      const result = await this.runOnce();
      results.push(result);
      if (result !== "completed") break;
    }
    return results;
  }
}

import { randomUUID } from "node:crypto";
import { ProductEventSchema, type ProductEvent, type ProductEventName } from "@openround/contracts";
import type { ProductEventRecord, Repository, Segment } from "@openround/db";
import type { MetricsService } from "./metrics.js";

const PRODUCT_EVENT_RETENTION_MS = 30 * 24 * 60 * 60_000;

export interface ProductEventInput {
  name: ProductEventName;
  occurredAt?: string;
  dimensions?: ProductEvent["dimensions"];
}

export interface ProductEventDispatch {
  workspaceId: string;
  events: ProductEventInput[];
  segment?: Segment;
  now?: Date;
}

export async function recordBetaProductEvents(input: {
  repository: Repository;
  metrics: MetricsService;
  workspaceId: string;
  events: ProductEventInput[];
  segment?: Segment;
  now?: Date;
}) {
  if (input.events.length === 0) return 0;
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + PRODUCT_EVENT_RETENTION_MS);
  let segment = input.segment;
  if (!segment) {
    try {
      segment = await input.repository.getWorkspaceSegment(input.workspaceId);
    } catch {
      // Segment enrichment is best effort; telemetry persistence must still proceed.
    }
  }
  const records: ProductEventRecord[] = input.events.map((event) => {
    const parsed = ProductEventSchema.parse({
      name: event.name,
      occurredAt: event.occurredAt ?? now.toISOString(),
      dimensions: {
        ...(event.dimensions ?? {}),
        ...(segment ? { segment } : {}),
        betaVersion: "p0-2026",
      },
    });
    return {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      ...parsed,
      expiresAt,
      createdAt: now,
    };
  });
  await input.repository.recordProductEvents(records);
  for (const event of records) input.metrics.recordProductEvent(event);
  return records.length;
}

export class ProductEventDispatcher {
  private tail: Promise<void> = Promise.resolve();
  private pendingEvents = 0;
  private closed = false;

  constructor(
    private readonly repository: Repository,
    private readonly metrics: MetricsService,
    private readonly reportFailure: (error: unknown) => void = () => undefined,
    private readonly maximumPendingEvents = 10_000,
  ) {}

  enqueue(input: ProductEventDispatch) {
    if (input.events.length === 0) return 0;
    if (this.closed || this.pendingEvents + input.events.length > this.maximumPendingEvents) {
      this.reportSafely(
        new Error(
          this.closed
            ? "Product event dispatcher is closed"
            : "Product event dispatcher queue is full",
        ),
      );
      return 0;
    }

    const queued: ProductEventDispatch = {
      ...input,
      events: input.events.map((event) => ({
        ...event,
        ...(event.dimensions ? { dimensions: { ...event.dimensions } } : {}),
      })),
      ...(input.now ? { now: new Date(input.now) } : {}),
    };
    this.pendingEvents += queued.events.length;
    const run = this.tail.then(async () => {
      try {
        await recordBetaProductEvents({
          repository: this.repository,
          metrics: this.metrics,
          ...queued,
        });
      } catch (error) {
        this.reportSafely(error);
      } finally {
        this.pendingEvents -= queued.events.length;
      }
    });
    this.tail = run.catch((error: unknown) => this.reportSafely(error));
    return queued.events.length;
  }

  async drain() {
    await this.tail;
  }

  async close() {
    this.closed = true;
    await this.drain();
  }

  private reportSafely(error: unknown) {
    try {
      this.reportFailure(error);
    } catch {
      // Telemetry and its logging must never affect product flows.
    }
  }
}

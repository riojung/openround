import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@openround/db";
import { MetricsService } from "../src/metrics.js";
import { ProductEventDispatcher } from "../src/product-events.js";

describe("ProductEventDispatcher", () => {
  it("observes transactionally persisted evidence without another database write", async () => {
    const repository = new MemoryRepository();
    const metrics = new MetricsService();
    const recordMetric = vi.spyOn(metrics, "recordProductEvent");
    const recordEvents = vi.spyOn(repository, "recordProductEvents");
    const dispatcher = new ProductEventDispatcher(repository, metrics);
    const event = {
      id: randomUUID(),
      workspaceId: randomUUID(),
      name: "practice_assignment_created" as const,
      occurredAt: new Date().toISOString(),
      dimensions: { segment: "workplace" as const, betaVersion: "p0-2026" as const },
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    };
    dispatcher.recordPersisted(event);
    await dispatcher.drain();
    expect(recordMetric).toHaveBeenCalledExactlyOnceWith({ ...event, authoritative: true });
    expect(recordEvents).not.toHaveBeenCalled();
    expect(repository.productEvents).toEqual([]);
  });

  it("keeps metrics failures outside a committed product flow", () => {
    const metrics = new MetricsService();
    const failure = new Error("metrics unavailable");
    vi.spyOn(metrics, "recordProductEvent").mockImplementation(() => {
      throw failure;
    });
    const report = vi.fn();
    const dispatcher = new ProductEventDispatcher(new MemoryRepository(), metrics, report);
    expect(() =>
      dispatcher.recordPersisted({
        id: randomUUID(),
        workspaceId: randomUUID(),
        name: "practice_assignment_created",
        occurredAt: new Date().toISOString(),
        dimensions: {},
        createdAt: new Date(),
        expiresAt: new Date(),
      }),
    ).not.toThrow();
    expect(report).toHaveBeenCalledExactlyOnceWith(failure);
  });

  it("queues persistence without making the caller wait and supports deterministic draining", async () => {
    const repository = new MemoryRepository();
    const originalRecord = repository.recordProductEvents.bind(repository);
    let markStarted!: () => void;
    let releasePersistence!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const persistenceGate = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    repository.recordProductEvents = async (events) => {
      markStarted();
      await persistenceGate;
      await originalRecord(events);
    };
    const dispatcher = new ProductEventDispatcher(repository, new MetricsService());

    expect(
      dispatcher.enqueue({
        workspaceId: randomUUID(),
        segment: "workplace",
        events: [{ name: "round_published" }],
      }),
    ).toBe(1);
    await started;
    let drained = false;
    const draining = dispatcher.drain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    releasePersistence();
    await draining;
    expect(repository.productEvents).toEqual([
      expect.objectContaining({
        name: "round_published",
        dimensions: { segment: "workplace", betaVersion: "p0-2026" },
      }),
    ]);
  });

  it("logs and swallows a failed write before continuing with the next queued batch", async () => {
    const repository = new MemoryRepository();
    const originalRecord = repository.recordProductEvents.bind(repository);
    let attempts = 0;
    repository.recordProductEvents = async (events) => {
      attempts += 1;
      if (attempts === 1) throw new Error("telemetry storage unavailable");
      await originalRecord(events);
    };
    const failures: unknown[] = [];
    const dispatcher = new ProductEventDispatcher(repository, new MetricsService(), (error) =>
      failures.push(error),
    );
    const workspaceId = randomUUID();

    dispatcher.enqueue({ workspaceId, events: [{ name: "round_published" }] });
    dispatcher.enqueue({ workspaceId, events: [{ name: "report_viewed" }] });
    await dispatcher.drain();

    expect(failures).toEqual([
      expect.objectContaining({ message: "telemetry storage unavailable" }),
    ]);
    expect(repository.productEvents).toEqual([
      expect.objectContaining({
        workspaceId,
        name: "report_viewed",
        dimensions: { segment: "workplace", betaVersion: "p0-2026" },
      }),
    ]);
  });
});

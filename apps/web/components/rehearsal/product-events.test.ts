import { describe, expect, it } from "vitest";
import { buildRehearsalProductEvent, rehearsalDurationBucket } from "./product-events.js";

describe("recovery rehearsal product events", () => {
  it("buckets duration at exact allowlisted boundaries", () => {
    expect(rehearsalDurationBucket(0)).toBe("under_1m");
    expect(rehearsalDurationBucket(59_999)).toBe("under_1m");
    expect(rehearsalDurationBucket(60_000)).toBe("1_to_5m");
    expect(rehearsalDurationBucket(299_999)).toBe("1_to_5m");
    expect(rehearsalDurationBucket(300_000)).toBe("5_to_15m");
    expect(rehearsalDurationBucket(899_999)).toBe("5_to_15m");
    expect(rehearsalDurationBucket(900_000)).toBe("over_15m");
  });

  it("emits only the allowlisted start name and scenario dimension", () => {
    expect(
      buildRehearsalProductEvent({
        name: "rehearsal_started",
        scenario: "split_room",
        occurredAt: "2026-09-18T12:00:00.000Z",
      }),
    ).toEqual({
      name: "rehearsal_started",
      occurredAt: "2026-09-18T12:00:00.000Z",
      dimensions: { scenario: "split_room" },
    });
  });

  it("adds only a coarse duration bucket when rehearsal is completed", () => {
    const event = buildRehearsalProductEvent({
      name: "rehearsal_completed",
      scenario: "confident_misconception",
      occurredAt: "2026-09-18T12:04:00.000Z",
      elapsedMs: 240_000,
    });

    expect(event).toEqual({
      name: "rehearsal_completed",
      occurredAt: "2026-09-18T12:04:00.000Z",
      dimensions: {
        scenario: "confident_misconception",
        durationBucket: "1_to_5m",
      },
    });
    expect(JSON.stringify(event)).not.toMatch(/quiz|question|prompt|participant|learner|response/i);
  });
});

import { describe, expect, it, vi } from "vitest";
import { createAudienceRealtimeReceipt, withRealtimeReceipt } from "./realtime";

describe("withRealtimeReceipt", () => {
  it("acknowledges receipt before processing an event", () => {
    const order: string[] = [];
    const handler = withRealtimeReceipt(() => order.push("handled"));

    handler({ eventId: "event-1" }, () => order.push("acknowledged"));

    expect(order).toEqual(["acknowledged", "handled"]);
  });

  it("continues to process events sent without a receipt callback", () => {
    const process = vi.fn();

    withRealtimeReceipt(process)({ eventId: "legacy-event" });

    expect(process).toHaveBeenCalledWith({ eventId: "legacy-event" });
  });
});

describe("createAudienceRealtimeReceipt", () => {
  it("deduplicates at-least-once events and identifies sequence gaps", () => {
    const gaps: boolean[] = [];
    const receive = createAudienceRealtimeReceipt((gap) => gaps.push(gap));
    const event = (eventId: string, audienceSeq: number) => ({
      eventId,
      sessionId: "8dce12bc-efb8-4b9c-9a60-2cf8e846fc33",
      audienceSeq,
      schemaVersion: 1 as const,
      serverTime: new Date().toISOString(),
      type: "audience.summary.updated",
      payload: {},
    });

    receive(event("first", 1));
    receive(event("first", 1));
    receive(event("stale", 1));
    receive(event("third", 3));

    expect(gaps).toEqual([false, true]);
  });

  it("accepts a coalesced summary projection for the same durable sequence", () => {
    const types: string[] = [];
    const receive = createAudienceRealtimeReceipt((_gap, envelope) => types.push(envelope.type));
    const base = {
      sessionId: "8dce12bc-efb8-4b9c-9a60-2cf8e846fc33",
      audienceSeq: 4,
      schemaVersion: 1 as const,
      serverTime: new Date().toISOString(),
      payload: {},
    };

    receive({
      ...base,
      eventId: "4aa2080b-9b3d-466b-9449-b73953874bf6",
      type: "chat.message.created",
    });
    receive({
      ...base,
      eventId: "62b1ac87-dd67-442e-b449-84fb8b070015",
      type: "audience.summary.updated",
    });

    expect(types).toEqual(["chat.message.created", "audience.summary.updated"]);
  });

  it("passes a newer aggregate payload even when its envelope arrives out of order", () => {
    const received: Array<{ gap: boolean; type: string }> = [];
    const receive = createAudienceRealtimeReceipt((gap, envelope) =>
      received.push({ gap, type: envelope.type }),
    );
    const base = {
      sessionId: "8dce12bc-efb8-4b9c-9a60-2cf8e846fc33",
      schemaVersion: 1 as const,
      serverTime: new Date().toISOString(),
    };

    receive({
      ...base,
      eventId: "4aa2080b-9b3d-466b-9449-b73953874bf6",
      audienceSeq: 10,
      type: "chat.message.created",
      payload: {},
    });
    receive({
      ...base,
      eventId: "62b1ac87-dd67-442e-b449-84fb8b070015",
      audienceSeq: 9,
      type: "audience.summary.updated",
      payload: { summary: { audienceSeq: 11 } },
    });

    expect(received).toEqual([
      { gap: false, type: "chat.message.created" },
      { gap: false, type: "audience.summary.updated" },
    ]);
  });

  it("passes distinct chat projections that publish in reverse sequence order", () => {
    const received: Array<{ audienceSeq: number; gap: boolean }> = [];
    const receive = createAudienceRealtimeReceipt((gap, envelope) =>
      received.push({ audienceSeq: envelope.audienceSeq, gap }),
    );
    const base = {
      sessionId: "8dce12bc-efb8-4b9c-9a60-2cf8e846fc33",
      schemaVersion: 1 as const,
      serverTime: new Date().toISOString(),
      type: "chat.message.created",
      payload: {},
    };

    receive({
      ...base,
      eventId: "4aa2080b-9b3d-466b-9449-b73953874bf6",
      audienceSeq: 11,
    });
    receive({
      ...base,
      eventId: "62b1ac87-dd67-442e-b449-84fb8b070015",
      audienceSeq: 10,
    });

    expect(received).toEqual([
      { audienceSeq: 11, gap: false },
      { audienceSeq: 10, gap: true },
    ]);
  });
});

import { describe, expect, it, vi } from "vitest";
import { withRealtimeReceipt } from "./realtime";

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

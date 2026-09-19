import { describe, expect, it } from "vitest";
import { ProductEventSchema } from "@openround/contracts";
import { buildProductEvent } from "./product-events.js";

describe("workspace product events", () => {
  it("builds a content-free follow-up share event", () => {
    const event = buildProductEvent("followup_shared", {}, new Date("2026-09-18T12:00:00Z"));

    expect(ProductEventSchema.parse(event)).toEqual({
      name: "followup_shared",
      occurredAt: "2026-09-18T12:00:00.000Z",
      dimensions: {},
    });
    expect(JSON.stringify(event)).not.toMatch(/id|token|url|content|answer|alias/i);
  });
});

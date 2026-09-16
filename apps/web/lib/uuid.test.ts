import { describe, expect, it } from "vitest";
import { clientUuid } from "./uuid";

describe("clientUuid", () => {
  it("creates distinct RFC 4122 version 4 identifiers", () => {
    const first = clientUuid();
    const second = clientUuid();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second).not.toBe(first);
  });
});

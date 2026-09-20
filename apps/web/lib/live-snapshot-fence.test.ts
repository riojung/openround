import { describe, expect, it } from "vitest";
import { shouldApplyLiveSnapshot } from "./live-snapshot-fence";

describe("shouldApplyLiveSnapshot", () => {
  it("rejects a delayed response from an older request", () => {
    expect(
      shouldApplyLiveSnapshot({ requestId: 4, revision: 8 }, { requestId: 3, revision: 8 }),
    ).toBe(false);
  });

  it("rejects a newer poll that observed an older server revision", () => {
    expect(
      shouldApplyLiveSnapshot({ requestId: 4, revision: 9 }, { requestId: 5, revision: 8 }),
    ).toBe(false);
  });

  it("accepts an up-to-date response", () => {
    expect(
      shouldApplyLiveSnapshot({ requestId: 4, revision: 9 }, { requestId: 5, revision: 10 }),
    ).toBe(true);
  });

  it("accepts a newer authoritative revision even when an earlier mutation returns last", () => {
    expect(
      shouldApplyLiveSnapshot({ requestId: 5, revision: 8 }, { requestId: 4, revision: 9 }),
    ).toBe(true);
  });
});

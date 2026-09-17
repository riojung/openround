import { describe, expect, it } from "vitest";
import { ApiClientError } from "./api";
import { shouldReplaceSavedAttempt } from "./followup-resume";

describe("follow-up attempt resume", () => {
  it("replaces a saved credential only when the server definitively rejects it", () => {
    expect(
      shouldReplaceSavedAttempt(new ApiClientError("Invalid token", "UNAUTHORIZED", 401)),
    ).toBe(true);
    expect(
      shouldReplaceSavedAttempt(new ApiClientError("Unavailable", "INTERNAL_ERROR", 503)),
    ).toBe(false);
    expect(shouldReplaceSavedAttempt(new TypeError("Network request failed"))).toBe(false);
  });
});

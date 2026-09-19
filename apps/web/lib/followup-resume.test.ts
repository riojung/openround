import { describe, expect, it } from "vitest";
import { ApiClientError } from "./api";
import {
  isCurrentFollowupAccess,
  releasePendingFollowupAttempt,
  reservePendingFollowupAttempt,
  shouldDiscardSavedAttemptForAccess,
  shouldReplaceSavedAttempt,
} from "./followup-resume";

describe("follow-up attempt resume", () => {
  it("reuses a pending client token until the matching start request succeeds", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    };
    let generated = 0;
    const createToken = () => `attempt-${++generated}`;

    const first = reservePendingFollowupAttempt(storage, "pending", createToken);
    const replay = reservePendingFollowupAttempt(storage, "pending", createToken);
    expect(replay).toBe(first);
    expect(generated).toBe(1);

    releasePendingFollowupAttempt(storage, "pending", "another-token");
    expect(storage.getItem("pending")).toBe(first);
    releasePendingFollowupAttempt(storage, "pending", first);
    expect(storage.getItem("pending")).toBeNull();
    expect(reservePendingFollowupAttempt(storage, "pending", createToken)).not.toBe(first);
  });

  it("discards an attempt only when a newly supplied access identity changes", () => {
    expect(shouldDiscardSavedAttemptForAccess("", "learner-a-access")).toBe(false);
    expect(shouldDiscardSavedAttemptForAccess("learner-a-access", "learner-a-access")).toBe(false);
    expect(shouldDiscardSavedAttemptForAccess("learner-b-access", "learner-a-access")).toBe(true);
    expect(shouldDiscardSavedAttemptForAccess("learner-b-access", "")).toBe(true);
  });

  it("does not let a delayed request commit after the access identity switches", async () => {
    let storedAccessToken = "learner-a-access";
    let cancelled = false;
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    }).then(() => isCurrentFollowupAccess("learner-a-access", storedAccessToken, cancelled));

    storedAccessToken = "learner-b-access";
    cancelled = true;
    release();

    await expect(delayed).resolves.toBe(false);
    expect(isCurrentFollowupAccess("learner-a-access", storedAccessToken, false)).toBe(false);
    expect(isCurrentFollowupAccess("learner-a-access", "learner-a-access", true)).toBe(false);
    expect(isCurrentFollowupAccess("learner-b-access", storedAccessToken, false)).toBe(true);
  });

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

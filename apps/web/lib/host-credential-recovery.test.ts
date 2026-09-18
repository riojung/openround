import { describe, expect, it } from "vitest";

import {
  createHostCredentialRecovery,
  hostCredentialStorageKey,
} from "./host-credential-recovery.js";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("host credential recovery", () => {
  it("clears only the rejected session credential and grants one recovery attempt", () => {
    const sessionKey = hostCredentialStorageKey("session-a");
    const otherSessionKey = hostCredentialStorageKey("session-b");
    const storage = memoryStorage({
      [sessionKey]: "stale-token",
      [otherSessionKey]: "other-token",
    });
    const recovery = createHostCredentialRecovery(storage, "session-a");

    expect(recovery.claim("UNAUTHORIZED", "stale-token")).toBe(true);
    expect(storage.getItem(sessionKey)).toBeNull();
    expect(storage.getItem(otherSessionKey)).toBe("other-token");

    recovery.save("replacement-token");
    expect(recovery.claim("UNAUTHORIZED", "replacement-token")).toBe(false);
    expect(storage.getItem(sessionKey)).toBeNull();
  });

  it("allows one command-time recovery after an earlier authenticated sync succeeds", () => {
    const key = hostCredentialStorageKey("session-a");
    const storage = memoryStorage({ [key]: "initial-token" });
    const recovery = createHostCredentialRecovery(storage, "session-a");

    expect(recovery.claim("UNAUTHORIZED", "initial-token")).toBe(true);
    recovery.save("authenticated-token");
    recovery.succeeded();

    expect(recovery.claim("UNAUTHORIZED", "authenticated-token")).toBe(true);
    expect(storage.getItem(key)).toBeNull();
    expect(recovery.claim("UNAUTHORIZED", "authenticated-token")).toBe(false);
  });

  it("does not clear or consume recovery for a non-authentication failure", () => {
    const key = hostCredentialStorageKey("session-a");
    const storage = memoryStorage({ [key]: "host-token" });
    const recovery = createHostCredentialRecovery(storage, "session-a");

    expect(recovery.claim("RATE_LIMITED", "host-token")).toBe(false);
    expect(storage.getItem(key)).toBe("host-token");
    expect(recovery.claim("UNAUTHORIZED", "host-token")).toBe(true);
  });

  it("does not erase a newer credential when an older sync response arrives late", () => {
    const key = hostCredentialStorageKey("session-a");
    const storage = memoryStorage({ [key]: "newer-token" });
    const recovery = createHostCredentialRecovery(storage, "session-a");

    expect(recovery.claim("UNAUTHORIZED", "older-token")).toBe(true);
    expect(storage.getItem(key)).toBe("newer-token");
  });
});

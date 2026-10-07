import { describe, expect, it, vi } from "vitest";
import { createPresentationHostPassManager } from "./presentation-host-pass";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

describe("Presentation host passes", () => {
  it("rejects an initial stale stored pass into compatibility mode without automatically rotating", async () => {
    const storage = memoryStorage({ "openround:presentation-host:session": "revoked-pass" });
    const passes = createPresentationHostPassManager(storage, "session");
    expect(passes.token()).toBe("revoked-pass");
    expect(passes.reject("revoked-pass")).toBe(true);
    expect(passes.token()).toBeNull();
    const mint = vi.fn(async () => "automatic-pass");
    await expect(passes.acquireAutomatic(mint)).resolves.toBeNull();
    await expect(passes.acquireAutomatic(mint)).resolves.toBeNull();
    expect(mint).not.toHaveBeenCalled();
    passes.replace("explicit-replacement");
    expect(passes.token()).toBe("explicit-replacement");
  });

  it("does not let delayed rejection erase a newer stored pass or another session", () => {
    const storage = memoryStorage({
      "openround:presentation-host:session": "first-pass",
      "openround:presentation-host:other-session": "other-pass",
    });
    const passes = createPresentationHostPassManager(storage, "session");
    passes.replace("new-pass");
    expect(passes.reject("first-pass")).toBe(false);
    expect(passes.token()).toBe("new-pass");
    expect(storage.getItem("openround:presentation-host:other-session")).toBe("other-pass");
  });

  it("does not automatically reacquire after an acquired pass is rejected", async () => {
    const passes = createPresentationHostPassManager(memoryStorage(), "session");
    const mint = vi.fn(async () => "initial-pass");
    await expect(passes.acquireAutomatic(mint)).resolves.toBe("initial-pass");
    expect(passes.reject("initial-pass")).toBe(true);
    await expect(passes.acquireAutomatic(mint)).resolves.toBeNull();
    expect(mint).toHaveBeenCalledOnce();
  });

  it("shares one deferred startup acquisition across disposed and replacement effects", async () => {
    const passes = createPresentationHostPassManager(memoryStorage(), "session");
    let resolve!: (token: string) => void;
    const mint = vi.fn(
      () =>
        new Promise<string>((resolvePromise) => {
          resolve = resolvePromise;
        }),
    );
    const firstEffect = passes.acquireAutomatic(mint);
    const secondEffect = passes.acquireAutomatic(mint);
    expect(firstEffect).toBe(secondEffect);
    await Promise.resolve();
    expect(mint).toHaveBeenCalledOnce();
    // The disposed first effect no longer owns saving the successful response.
    resolve("shared-initial-pass");
    await expect(secondEffect).resolves.toBe("shared-initial-pass");
    await expect(firstEffect).resolves.toBe("shared-initial-pass");
    expect(passes.token()).toBe("shared-initial-pass");
    await expect(passes.acquireAutomatic(mint)).resolves.toBe("shared-initial-pass");
    expect(mint).toHaveBeenCalledOnce();
  });

  it("does not overwrite an explicit replacement with a deferred startup result", async () => {
    const passes = createPresentationHostPassManager(memoryStorage(), "session");
    let resolve!: (token: string) => void;
    const mint = vi.fn(
      () =>
        new Promise<string>((resolvePromise) => {
          resolve = resolvePromise;
        }),
    );
    const startup = passes.acquireAutomatic(mint);
    await Promise.resolve();
    passes.replace("manual-replacement");
    resolve("stale-startup-pass");
    await expect(startup).resolves.toBe("manual-replacement");
    expect(passes.token()).toBe("manual-replacement");
    expect(mint).toHaveBeenCalledOnce();
  });

  it("does not restore a rejected explicit replacement from an older startup response", async () => {
    const passes = createPresentationHostPassManager(memoryStorage(), "session");
    let resolve!: (token: string) => void;
    const mint = vi.fn(
      () =>
        new Promise<string>((resolvePromise) => {
          resolve = resolvePromise;
        }),
    );
    const startup = passes.acquireAutomatic(mint);
    await Promise.resolve();
    passes.replace("manual-replacement");
    expect(passes.reject("manual-replacement")).toBe(true);
    await expect(passes.acquireAutomatic(mint)).resolves.toBeNull();
    resolve("stale-startup-pass");
    await expect(startup).resolves.toBeNull();
    expect(passes.token()).toBeNull();
    expect(mint).toHaveBeenCalledOnce();
  });

  it("shares a failed startup request and does not automatically retry it", async () => {
    const passes = createPresentationHostPassManager(memoryStorage(), "session");
    let reject!: (error: Error) => void;
    const mint = vi.fn(
      () =>
        new Promise<string>((_, rejectPromise) => {
          reject = rejectPromise;
        }),
    );
    const first = passes.acquireAutomatic(mint);
    const second = passes.acquireAutomatic(mint);
    const failure = expect(Promise.all([first, second])).rejects.toThrow("Unavailable");
    await Promise.resolve();
    reject(new Error("Unavailable"));
    await failure;
    await expect(passes.acquireAutomatic(mint)).resolves.toBeNull();
    expect(mint).toHaveBeenCalledOnce();
  });
});

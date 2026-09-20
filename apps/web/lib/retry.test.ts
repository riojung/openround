import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./api";
import { isRetryableSaveError, retryWithBackoff } from "./retry";

describe("retryWithBackoff", () => {
  it("retries transient writes with bounded exponential delays", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new ApiClientError("unavailable", "INTERNAL_ERROR", 503))
      .mockRejectedValueOnce(new TypeError("network interrupted"))
      .mockResolvedValue("saved");
    const sleep = vi.fn(async () => undefined);

    await expect(
      retryWithBackoff(operation, { attempts: 3, baseDelayMs: 100, maxDelayMs: 150, sleep }),
    ).resolves.toBe("saved");
    expect(sleep.mock.calls).toEqual([[100], [150]]);
  });

  it("does not retry validation or revision conflicts", async () => {
    const operation = vi.fn(async () => {
      throw new ApiClientError("stale", "STALE_DRAFT", 409);
    });

    await expect(retryWithBackoff(operation, { sleep: async () => undefined })).rejects.toThrow(
      "stale",
    );
    expect(operation).toHaveBeenCalledTimes(1);
    expect(isRetryableSaveError(new ApiClientError("bad", "VALIDATION_ERROR", 422))).toBe(false);
  });
});

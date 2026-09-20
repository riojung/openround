import { describe, expect, it, vi } from "vitest";
import { RecoverableOperationQueue } from "./recoverable-operation-queue";

describe("RecoverableOperationQueue", () => {
  it("reports a failed operation to its caller and still runs the next operation", async () => {
    const queue = new RecoverableOperationQueue();
    const first = queue.enqueue(async () => {
      throw new Error("save failed");
    });
    const secondOperation = vi.fn(async () => undefined);
    const second = queue.enqueue(secondOperation);

    await expect(first).rejects.toThrow("save failed");
    await expect(second).resolves.toBeUndefined();
    expect(secondOperation).toHaveBeenCalledOnce();
  });
});

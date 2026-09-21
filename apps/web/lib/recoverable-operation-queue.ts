/**
 * Serializes mutations while keeping each caller's result observable. A failed
 * operation does not poison the queue, but its returned promise still rejects.
 */
export class RecoverableOperationQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

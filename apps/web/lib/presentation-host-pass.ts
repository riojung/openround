export function isPresentationHostPassRejection(error: unknown) {
  const { code, status } = (error ?? {}) as { code?: string; status?: number };
  return code === "UNAUTHORIZED" || status === 401;
}

/** A rejected pass requires explicit replacement; delayed rejection cannot remove a newer pass. */
export function createPresentationHostPassManager(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  sessionId: string,
) {
  const key = `openround:presentation-host:${sessionId}`;
  let automaticAcquisitionAvailable = true;
  let generation = 0;
  let acquisition: { generation: number; promise: Promise<string | null> } | null = null;
  return {
    token: () => storage.getItem(key),
    acquireAutomatic(mint: () => Promise<string>): Promise<string | null> {
      const existing = storage.getItem(key);
      if (existing) return Promise.resolve(existing);
      if (acquisition?.generation === generation) return acquisition.promise;
      if (!automaticAcquisitionAvailable) return Promise.resolve(null);
      automaticAcquisitionAvailable = false;
      const acquiredGeneration = generation;
      const promise = Promise.resolve()
        .then(mint)
        .then((controlToken) => {
          if (generation === acquiredGeneration && storage.getItem(key) === null) {
            storage.setItem(key, controlToken);
          }
          return storage.getItem(key);
        })
        .catch((error) => {
          // An explicit replacement or rejection supersedes even a failed older acquisition.
          if (generation !== acquiredGeneration) return storage.getItem(key);
          throw error;
        })
        .finally(() => {
          if (acquisition?.promise === promise) acquisition = null;
        });
      acquisition = { generation: acquiredGeneration, promise };
      return promise;
    },
    reject(rejectedToken: string) {
      if (storage.getItem(key) !== rejectedToken) return false;
      storage.removeItem(key);
      automaticAcquisitionAvailable = false;
      generation += 1;
      return true;
    },
    replace(controlToken: string) {
      storage.setItem(key, controlToken);
      automaticAcquisitionAvailable = false;
      generation += 1;
    },
  };
}

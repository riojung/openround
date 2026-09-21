const DATABASE_NAME = "openround-builder-recovery";
const STORE_NAME = "drafts";
const DATABASE_VERSION = 1;

export interface BuilderRecoverySnapshot<T> {
  key: string;
  savedAt: string;
  revision: number;
  draft: T;
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Draft recovery is unavailable"));
  });
}

async function transaction<T>(
  mode: IDBTransactionMode,
  execute: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const database = await openDatabase();
  if (!database) return null;
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = execute(database.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Draft recovery failed"));
    });
  } finally {
    database.close();
  }
}

export async function saveBuilderRecovery<T>(
  key: string,
  revision: number,
  draft: T,
): Promise<void> {
  await transaction("readwrite", (store) =>
    store.put({ key, revision, draft, savedAt: new Date().toISOString() }),
  );
}

export async function loadBuilderRecovery<T>(
  key: string,
): Promise<BuilderRecoverySnapshot<T> | null> {
  return transaction<BuilderRecoverySnapshot<T> | undefined>("readonly", (store) =>
    store.get(key),
  ).then((value) => value ?? null);
}

export async function clearBuilderRecovery(key: string): Promise<void> {
  await transaction("readwrite", (store) => store.delete(key));
}

interface SessionCredentialStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export function hostCredentialStorageKey(sessionId: string) {
  return `openround:host:${sessionId}`;
}

export function createHostCredentialRecovery(storage: SessionCredentialStorage, sessionId: string) {
  const key = hostCredentialStorageKey(sessionId);
  let recoveryClaimed = false;

  return {
    save(token: string) {
      storage.setItem(key, token);
    },
    claim(errorCode: string, rejectedToken: string) {
      if (errorCode !== "UNAUTHORIZED") return false;
      if (storage.getItem(key) === rejectedToken) storage.removeItem(key);
      if (recoveryClaimed) return false;
      recoveryClaimed = true;
      return true;
    },
    succeeded() {
      recoveryClaimed = false;
    },
  };
}

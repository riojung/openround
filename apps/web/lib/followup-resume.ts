import { ApiClientError } from "./api";

interface AttemptStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function reservePendingFollowupAttempt(
  storage: AttemptStorage,
  key: string,
  createToken: () => string,
) {
  const existing = storage.getItem(key);
  if (existing) return existing;
  const token = createToken();
  storage.setItem(key, token);
  return token;
}

export function releasePendingFollowupAttempt(
  storage: AttemptStorage,
  key: string,
  expectedToken: string,
) {
  if (storage.getItem(key) === expectedToken) storage.removeItem(key);
}

export function shouldDiscardSavedAttemptForAccess(
  incomingAccessToken: string,
  storedAccessToken: string,
) {
  return incomingAccessToken.length > 0 && incomingAccessToken !== storedAccessToken;
}

export function isCurrentFollowupAccess(
  expectedAccessToken: string,
  storedAccessToken: string,
  cancelled: boolean,
) {
  return !cancelled && expectedAccessToken === storedAccessToken;
}

export function shouldReplaceSavedAttempt(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 401;
}

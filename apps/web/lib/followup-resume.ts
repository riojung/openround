import { ApiClientError } from "./api";

export function shouldReplaceSavedAttempt(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 401;
}

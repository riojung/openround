import { ApiClientError } from "./api";

interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
  sleep?: (delayMs: number) => Promise<void>;
}

const defaultSleep = (delayMs: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));

export function isRetryableSaveError(error: unknown) {
  if (error instanceof ApiClientError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return error instanceof TypeError;
}

/**
 * Retries transient writes in serial order with a small bounded exponential delay. Callers must
 * keep their mutation id stable across attempts so an ambiguous network failure remains safe.
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  {
    attempts = 3,
    baseDelayMs = 180,
    maxDelayMs = 1_200,
    shouldRetry = isRetryableSaveError,
    sleep = defaultSleep,
  }: RetryOptions = {},
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts - 1 || !shouldRetry(error)) throw error;
      await sleep(Math.min(maxDelayMs, baseDelayMs * 2 ** attempt));
    }
  }
  throw lastError;
}

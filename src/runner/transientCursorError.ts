/** Cursor provider failures that are usually transient (stream disconnect, load). */
export const DEFAULT_CURSOR_TRANSIENT_MAX_ATTEMPTS = 5;

/** First backoff delay before retrying `sandbox.run` (ms). */
export const DEFAULT_CURSOR_TRANSIENT_BASE_DELAY_MS = 5_000;

/** Cap per retry wait (ms). */
export const DEFAULT_CURSOR_TRANSIENT_MAX_DELAY_MS = 120_000;

/** Default jitter ratio applied to backoff delays (0.2 = ±20%). */
export const DEFAULT_CURSOR_TRANSIENT_JITTER_RATIO = 0.2;

export function isTransientCursorErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("resource_exhausted") ||
    normalized.includes("error_resource_exhausted")
  );
}

export function isTransientCursorRetriesExhaustedMessage(message: string): boolean {
  return message.toLowerCase().includes("exhausted") && message.includes("Sandcastle");
}

export function isTransientCursorError(error: unknown): boolean {
  if (error instanceof Error) {
    return isTransientCursorErrorMessage(error.message);
  }
  if (typeof error === "string") {
    return isTransientCursorErrorMessage(error);
  }
  return false;
}

/** Exponential backoff: base * 2^(attempt-1), capped. `attempt` is 1-based. */
export function transientCursorBackoffDelayMs(
  attempt: number,
  baseDelayMs = DEFAULT_CURSOR_TRANSIENT_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_CURSOR_TRANSIENT_MAX_DELAY_MS,
): number {
  if (attempt <= 1) {
    return 0;
  }
  const exponent = attempt - 2;
  const delay = baseDelayMs * 2 ** exponent;
  return Math.min(maxDelayMs, delay);
}

export function jitterDelayMs(
  delayMs: number,
  jitterRatio = DEFAULT_CURSOR_TRANSIENT_JITTER_RATIO,
  rng: () => number = Math.random,
): number {
  if (delayMs <= 0 || jitterRatio <= 0) {
    return delayMs;
  }
  // Uniform jitter in [1-jitterRatio, 1+jitterRatio]
  const factor = 1 - jitterRatio + rng() * (2 * jitterRatio);
  return Math.max(0, Math.round(delayMs * factor));
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function formatTransientCursorExhaustedMessage(
  message: string,
  attempts: number,
): string {
  return `${message} (exhausted ${attempts} Sandcastle attempts with exponential backoff)`;
}

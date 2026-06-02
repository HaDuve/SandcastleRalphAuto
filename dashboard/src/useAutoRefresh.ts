import { useEffect, useRef } from "react";

export type UseAutoRefreshOptions = {
  enabled: boolean;
  intervalMs: number;
  onRefresh: () => void | Promise<void>;
  /** When this value changes, clear the interval and reset catch-up timing. */
  resetKey?: string | number | null;
};

type VisibilityDocument = {
  visibilityState: string;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

function visibilityDocument(): VisibilityDocument | null {
  const candidate = (globalThis as { document?: VisibilityDocument }).document;
  return candidate ?? null;
}

export function useAutoRefresh({
  enabled,
  intervalMs,
  onRefresh,
  resetKey = null,
}: UseAutoRefreshOptions): void {
  const onRefreshRef = useRef(onRefresh);
  const lastSuccessfulRefreshAtRef = useRef<number | null>(null);
  const intervalIdRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    const doc = visibilityDocument();
    if (!doc) {
      return;
    }

    const clearScheduledRefresh = () => {
      if (intervalIdRef.current !== null) {
        clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
      }
    };

    const runRefresh = () => {
      void Promise.resolve(onRefreshRef.current()).then(() => {
        lastSuccessfulRefreshAtRef.current = Date.now();
      });
    };

    const startInterval = () => {
      clearScheduledRefresh();
      intervalIdRef.current = setInterval(runRefresh, intervalMs);
    };

    const handleVisibilityChange = () => {
      if (!enabled) {
        return;
      }
      if (doc.visibilityState === "hidden") {
        clearScheduledRefresh();
        return;
      }

      const lastRefreshAt = lastSuccessfulRefreshAtRef.current;
      if (lastRefreshAt !== null && Date.now() - lastRefreshAt >= intervalMs) {
        runRefresh();
      }
      startInterval();
    };

    lastSuccessfulRefreshAtRef.current = null;
    clearScheduledRefresh();

    if (!enabled) {
      return clearScheduledRefresh;
    }

    if (doc.visibilityState === "visible") {
      startInterval();
    }

    doc.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      doc.removeEventListener("visibilitychange", handleVisibilityChange);
      clearScheduledRefresh();
    };
  }, [enabled, intervalMs, resetKey]);
}

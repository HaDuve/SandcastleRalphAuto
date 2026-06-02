export type TailPhaseLogOptions = {
  logPath: string;
  onChunk: (chunk: string) => void;
  readTextFile?: (path: string) => Promise<string>;
  pollIntervalMs?: number;
  signal?: AbortSignal;
};

export type TailPhaseLogHandle = {
  stop: () => Promise<void>;
};

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

export function startTailPhaseLog(
  options: TailPhaseLogOptions,
): TailPhaseLogHandle {
  const readTextFile =
    options.readTextFile ??
    (async (path: string) => {
      const { readFile } = await import("node:fs/promises");
      return readFile(path, "utf8");
    });
  const pollIntervalMs = options.pollIntervalMs ?? 250;

  let offset = 0;
  let stopped = false;
  let pollInFlight = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const poll = async (final = false): Promise<void> => {
    if ((!final && stopped) || pollInFlight) {
      return;
    }
    pollInFlight = true;
    try {
      const content = await readTextFile(options.logPath);
      if (content.length > offset) {
        const chunk = content.slice(offset);
        offset = content.length;
        if (chunk.length > 0) {
          options.onChunk(chunk);
        }
      }
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    } finally {
      pollInFlight = false;
    }
  };

  const onAbort = (): void => {
    void stop();
  };

  if (options.signal) {
    if (options.signal.aborted) {
      stopped = true;
    } else {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  if (!stopped) {
    void poll();
    timer = setInterval(() => {
      void poll();
    }, pollIntervalMs);
  }

  async function stop(): Promise<void> {
    if (stopped) {
      return;
    }
    stopped = true;
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
    options.signal?.removeEventListener("abort", onAbort);
    while (pollInFlight) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await poll(true);
  }

  return { stop };
}

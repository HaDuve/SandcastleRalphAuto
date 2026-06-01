import type { RunOutcome } from "./types.js";

export type WorkerStatus = "unknown" | "idle" | "running" | "paused";

export type WorkerState = {
  status: WorkerStatus;
  lastOutcome: RunOutcome | null;
};

type WorkerStatusEvent = {
  type: string;
  workerStatus?: WorkerStatus;
  reason?: string;
};

function isTerminalOutcome(reason: string): reason is Exclude<RunOutcome["outcome"], "error"> {
  return (
    reason === "queue-empty" ||
    reason === "blocked" ||
    reason === "awaiting-human" ||
    reason === "killed"
  );
}

function defaultWorkerState(): WorkerState {
  return { status: "unknown", lastOutcome: null };
}

function normalizeCurrent(current: WorkerState | WorkerStatus | undefined): WorkerState {
  if (current === undefined) {
    return defaultWorkerState();
  }
  if (typeof current === "string") {
    return { status: current, lastOutcome: null };
  }
  return current;
}

function runOutcomeFromWorkerStopped(reason: string | undefined): RunOutcome {
  if (!reason) {
    return {
      outcome: "error",
      reason: "Worker stopped without a reason",
      stoppedAt: new Date().toISOString(),
    };
  }
  if (isTerminalOutcome(reason)) {
    return {
      outcome: reason,
      stoppedAt: new Date().toISOString(),
    };
  }
  return {
    outcome: "error",
    reason,
    stoppedAt: new Date().toISOString(),
  };
}

export function applyWorkerEvent(
  current: WorkerState | WorkerStatus | undefined,
  event: WorkerStatusEvent,
): WorkerState {
  const state = normalizeCurrent(current);

  switch (event.type) {
    case "connected":
      return {
        ...state,
        status: event.workerStatus ?? state.status ?? "unknown",
      };
    case "worker-started":
      return { status: "running", lastOutcome: null };
    case "worker-paused":
      return { ...state, status: "paused" };
    case "worker-resumed":
      return { ...state, status: "running" };
    case "worker-stopped":
      return {
        status: "idle",
        lastOutcome: runOutcomeFromWorkerStopped(event.reason),
      };
    default:
      return state.status === "unknown" ? defaultWorkerState() : state;
  }
}

export function isControlReady(status: WorkerStatus): boolean {
  return status !== "unknown";
}

export function canHideProject(status: WorkerStatus): boolean {
  return status !== "running";
}

export function workerStateFromSnapshot(input: {
  workerStatus?: "idle" | "running" | "paused";
  lastRunOutcome?: RunOutcome | null;
}): WorkerState {
  return {
    status: input.workerStatus ?? "unknown",
    lastOutcome: input.lastRunOutcome ?? null,
  };
}

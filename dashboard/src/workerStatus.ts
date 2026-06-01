import type { RunOutcome } from "./types.js";

export type WorkerStatus = "unknown" | "idle" | "running" | "paused";

export type WorkerState = {
  status: WorkerStatus;
  lastOutcome: RunOutcome | null;
};

type WorkerStatusEvent = {
  type: string;
  workerStatus?: WorkerStatus;
  lastRunOutcome?: RunOutcome;
};

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
        lastOutcome: event.lastRunOutcome ?? state.lastOutcome,
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

export function stoppedRunOutcome(state: WorkerState | undefined): RunOutcome | null {
  if (!state || state.status === "running") {
    return null;
  }
  return state.lastOutcome;
}

export function workerStateFromSnapshot(input: {
  workerStatus?: "idle" | "running" | "paused";
  lastRunOutcome?: RunOutcome | null;
}): WorkerState {
  const status = input.workerStatus ?? "unknown";
  return {
    status,
    lastOutcome:
      status === "running" ? null : (input.lastRunOutcome ?? null),
  };
}

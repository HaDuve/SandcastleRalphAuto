export type WorkerStatus = "unknown" | "idle" | "running" | "paused";

type WorkerStatusEvent = {
  type: string;
  workerStatus?: WorkerStatus;
};

export function applyWorkerEvent(
  current: WorkerStatus | undefined,
  event: WorkerStatusEvent,
): WorkerStatus {
  switch (event.type) {
    case "connected":
      return event.workerStatus ?? current ?? "unknown";
    case "worker-started":
      return "running";
    case "worker-paused":
      return "paused";
    case "worker-resumed":
      return "running";
    case "worker-stopped":
      return "idle";
    default:
      return current ?? "unknown";
  }
}

export function isControlReady(status: WorkerStatus): boolean {
  return status !== "unknown";
}

export function canHideProject(status: WorkerStatus): boolean {
  return status !== "running";
}

import { type ActiveState } from "../state/index.js";
import { type WorkerManager } from "./workerManager.js";

export type ActiveSummary = {
  issue: number;
  phase: ActiveState["phase"];
  status: ActiveState["status"];
};

export type WorkerStatusSnapshot = "idle" | "running" | "paused";

export function toActiveSummary(active: ActiveState | null): ActiveSummary | null {
  if (!active) {
    return null;
  }
  return { issue: active.issue, phase: active.phase, status: active.status };
}

export function workerStatusFor(
  workerManager: WorkerManager,
  projectId: string,
): WorkerStatusSnapshot {
  if (!workerManager.isRunning(projectId)) {
    return "idle";
  }
  return workerManager.isPaused(projectId) ? "paused" : "running";
}

import type { Project, ProjectActiveSummary } from "./types.js";
import type { WorkerState, WorkerStatus } from "./workerStatus.js";

export function resolveWorkerStatusForCard(
  project: Project,
  workerState: WorkerState | undefined,
): WorkerStatus {
  if (workerState && workerState.status !== "unknown") {
    return workerState.status;
  }
  return project.workerStatus ?? "unknown";
}

export function resolveActiveSummaryForCard(
  project: Project,
  summary: ProjectActiveSummary | null | undefined,
): ProjectActiveSummary | null {
  return summary ?? project.active ?? null;
}

export function formatProjectStatusIndicator(
  workerStatus: WorkerStatus,
  active: ProjectActiveSummary | null | undefined,
): string {
  if (active?.status === "blocked" || active?.status === "awaiting-human") {
    return "blocked";
  }
  if (workerStatus === "paused") {
    return "paused";
  }
  if (workerStatus === "running") {
    const phase = active?.phase ?? "…";
    return `running · ${phase}`;
  }
  return "idle";
}

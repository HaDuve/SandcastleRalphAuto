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

export type WorkerPosture = "paused" | "running" | "blocked" | "idle";

export function workerPostureLabel(
  workerStatus: WorkerStatus,
  active: Pick<ProjectActiveSummary, "status"> | null | undefined,
): WorkerPosture {
  if (workerStatus === "paused") {
    return "paused";
  }
  if (workerStatus === "running") {
    return "running";
  }
  if (active?.status === "blocked" || active?.status === "awaiting-human") {
    return "blocked";
  }
  return "idle";
}

export function formatProjectStatusIndicator(
  workerStatus: WorkerStatus,
  active: ProjectActiveSummary | null | undefined,
): string {
  const posture = workerPostureLabel(workerStatus, active);
  if (posture === "paused") {
    return "paused";
  }
  if (posture === "running") {
    const phase = active?.phase ?? "…";
    return `running · ${phase}`;
  }
  if (posture === "blocked") {
    return "blocked";
  }
  return "idle";
}

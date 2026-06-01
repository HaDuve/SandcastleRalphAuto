import type { ProjectActiveSummary } from "./types.js";
import type { WorkerStatus } from "./workerStatus.js";

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

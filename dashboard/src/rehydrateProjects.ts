import type { Project } from "./types.js";
import { workerStateFromSnapshot, type WorkerState } from "./workerStatus.js";

export function workerStatesFromProjects(
  projects: Project[],
  selectedIds: ReadonlySet<string>,
): Record<string, WorkerState> {
  const states: Record<string, WorkerState> = {};
  for (const project of projects) {
    if (!selectedIds.has(project.id)) {
      continue;
    }
    states[project.id] = workerStateFromSnapshot({
      workerStatus: project.workerStatus,
      lastRunOutcome: project.lastRunOutcome,
    });
  }
  return states;
}


import {
  resolveActiveSummaryForCard,
  resolveWorkerStatusForCard,
} from "./projectStatus.js";
import type { Project, ProjectActiveSummary, RunOutcome } from "./types.js";
import type { WorkerState } from "./workerStatus.js";

export type FleetSummary = {
  running: number;
  paused: number;
  blocked: number;
  idle: number;
  hidden: number;
};

const BLOCKED_OUTCOMES = new Set<RunOutcome["outcome"]>([
  "blocked",
  "awaiting-human",
  "error",
]);

function isBlockedPosture(
  active: ProjectActiveSummary | null,
  lastOutcome: RunOutcome | null | undefined,
): boolean {
  if (active?.status === "blocked" || active?.status === "awaiting-human") {
    return true;
  }
  return lastOutcome !== null && lastOutcome !== undefined && BLOCKED_OUTCOMES.has(lastOutcome.outcome);
}

function bucketProject(
  project: Project,
  workerStates: Record<string, WorkerState>,
  activeSummaries: Record<string, ProjectActiveSummary | null>,
): keyof Pick<FleetSummary, "running" | "paused" | "blocked" | "idle"> {
  const workerState = workerStates[project.id];
  const status = resolveWorkerStatusForCard(project, workerState);

  if (status === "running") {
    return "running";
  }
  if (status === "paused") {
    return "paused";
  }

  const active = resolveActiveSummaryForCard(project, activeSummaries[project.id]);
  const lastOutcome =
    workerState?.lastOutcome ?? project.lastRunOutcome ?? null;

  if (isBlockedPosture(active, lastOutcome)) {
    return "blocked";
  }

  return "idle";
}

export function summarizeFleet(
  visibleProjects: Project[],
  workerStates: Record<string, WorkerState>,
  activeSummaries: Record<string, ProjectActiveSummary | null>,
  hiddenCount: number,
): FleetSummary {
  const summary: FleetSummary = {
    running: 0,
    paused: 0,
    blocked: 0,
    idle: 0,
    hidden: hiddenCount,
  };

  for (const project of visibleProjects) {
    summary[bucketProject(project, workerStates, activeSummaries)] += 1;
  }

  return summary;
}

export function formatFleetLine(summary: FleetSummary): string {
  const parts = [
    `${summary.running} running`,
    `${summary.paused} paused`,
    `${summary.blocked} blocked`,
    `${summary.idle} idle`,
  ];
  if (summary.hidden > 0) {
    parts.push(`${summary.hidden} hidden`);
  }
  return parts.join(" · ");
}

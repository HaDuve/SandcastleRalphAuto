import { formatPhaseDuration } from "./phaseDuration.js";
import { resolveActiveSummaryForCard, resolveWorkerStatusForCard } from "./projectStatus.js";
import { formatOutcomeLabel } from "./runOutcomeUi.js";
import type { ActiveSlice, Project, ProjectActiveSummary } from "./types.js";
import type { WorkerState, WorkerStatus } from "./workerStatus.js";

export type FocusedStatus = {
  message: string | null;
  id: string | null;
  remote: string | null;
  path: string | null;
  worker: string | null;
  phase: string | null;
  issue: number | null;
  pr: number | null;
  outcome: string | null;
  reason: string | null;
  sinceStop: string | null;
  phaseElapsed: string | null;
};

const emptyStatus: FocusedStatus = {
  message: "No project selected",
  id: null,
  remote: null,
  path: null,
  worker: null,
  phase: null,
  issue: null,
  pr: null,
  outcome: null,
  reason: null,
  sinceStop: null,
  phaseElapsed: null,
};

function workerLabel(workerStatus: WorkerStatus, activeStatus: ActiveSlice["status"] | undefined): string {
  if (workerStatus === "paused") {
    return "paused";
  }
  if (workerStatus === "running") {
    return "running";
  }
  if (activeStatus === "blocked" || activeStatus === "awaiting-human") {
    return "blocked";
  }
  return "idle";
}

function formatSinceStop(stoppedAt: string, now: string): string {
  const elapsed = formatPhaseDuration(stoppedAt, now);
  return elapsed === "—" ? "—" : `${elapsed} ago`;
}

export function buildFocusedStatus(
  project: Project | null,
  workerState: WorkerState | undefined,
  activeSummary: ProjectActiveSummary | null | undefined,
  activeSlice: ActiveSlice | null | undefined,
  now: string,
): FocusedStatus {
  if (!project) {
    return emptyStatus;
  }

  const workerStatus = resolveWorkerStatusForCard(project, workerState);
  if (workerStatus === "unknown") {
    return {
      ...emptyStatus,
      message: "Connecting…",
      id: project.id,
      remote: project.remote,
      path: project.path,
    };
  }

  const active = activeSlice ?? resolveActiveSummaryForCard(project, activeSummary);
  const activeStatus = activeSlice?.status ?? activeSummary?.status;
  const phase = activeSlice?.phase ?? activeSummary?.phase ?? null;
  const issue = activeSlice?.issue ?? activeSummary?.issue ?? null;
  const pr = activeSlice?.pr ?? null;
  const startedAt = activeSlice?.startedAt;
  const lastOutcome = workerState?.lastOutcome ?? project.lastRunOutcome ?? null;
  const worker = workerLabel(workerStatus, activeStatus);
  const running = workerStatus === "running";

  let outcome: string | null = null;
  let reason: string | null = null;
  let sinceStop: string | null = null;
  let phaseElapsed: string | null = null;

  if (running && startedAt) {
    phaseElapsed = formatPhaseDuration(startedAt, now);
  } else if (!running && lastOutcome) {
    outcome = formatOutcomeLabel(lastOutcome.outcome);
    reason = lastOutcome.reason ?? null;
    sinceStop = formatSinceStop(lastOutcome.stoppedAt, now);
  }

  return {
    message: null,
    id: project.id,
    remote: project.remote,
    path: project.path,
    worker,
    phase,
    issue,
    pr,
    outcome,
    reason,
    sinceStop,
    phaseElapsed,
  };
}

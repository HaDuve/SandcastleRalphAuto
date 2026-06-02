import { formatPhaseDuration } from "./phaseDuration.js";
import { formatTimestampLocal } from "./timeFormat.js";
import {
  resolveActiveSummaryForCard,
  resolveWorkerStatusForCard,
  workerPostureLabel,
} from "./projectStatus.js";
import { formatOutcomeLabel } from "./runOutcomeUi.js";
import type { ActiveSlice, Project, ProjectActiveSummary } from "./types.js";
import type { WorkerState } from "./workerStatus.js";

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
  stoppedAt: string | null;
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
  stoppedAt: null,
  sinceStop: null,
  phaseElapsed: null,
};

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
  const phase = activeSlice?.phase ?? activeSummary?.phase ?? null;
  const issue = activeSlice?.issue ?? activeSummary?.issue ?? null;
  const pr = activeSlice?.pr ?? null;
  const startedAt = activeSlice?.startedAt;
  const lastOutcome = workerState?.lastOutcome ?? project.lastRunOutcome ?? null;
  const worker = workerPostureLabel(workerStatus, active);
  const running = workerStatus === "running";

  let outcome: string | null = null;
  let reason: string | null = null;
  let stoppedAt: string | null = null;
  let sinceStop: string | null = null;
  let phaseElapsed: string | null = null;

  if (running && startedAt) {
    phaseElapsed = formatPhaseDuration(startedAt, now);
  } else if (!running && lastOutcome) {
    outcome = formatOutcomeLabel(lastOutcome.outcome);
    reason = lastOutcome.reason ?? null;
    stoppedAt = formatTimestampLocal(lastOutcome.stoppedAt) ?? null;
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
    stoppedAt,
    sinceStop,
    phaseElapsed,
  };
}
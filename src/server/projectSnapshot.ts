import { type GhRunner } from "../merge/index.js";
import { type ActiveState } from "../state/index.js";
import { fetchGhIssueMeta } from "./issueMeta.js";
import { type WorkerManager } from "./workerManager.js";

export type ActiveSummary = {
  issue: number;
  title?: string;
  phase: ActiveState["phase"];
  status: ActiveState["status"];
  branch: string;
  pr?: number;
  startedAt?: string;
};

export type WorkerStatusSnapshot = "idle" | "running" | "paused";

export function toActiveSummary(active: ActiveState | null): ActiveSummary | null {
  if (!active) {
    return null;
  }
  return {
    issue: active.issue,
    phase: active.phase,
    status: active.status,
    branch: active.branch,
    pr: active.pr,
    startedAt: active.startedAt,
  };
}

export async function enrichActiveSummary(
  active: ActiveState | null,
  remote: string,
  gh: GhRunner,
): Promise<ActiveSummary | null> {
  const base = toActiveSummary(active);
  if (!base) {
    return null;
  }
  const meta = await fetchGhIssueMeta(gh, remote, base.issue);
  return meta ? { ...base, title: meta.title } : base;
}

export async function enrichActiveState(
  active: ActiveState | null,
  remote: string,
  gh: GhRunner,
): Promise<(ActiveState & { title?: string }) | null> {
  if (!active) {
    return null;
  }
  const meta = await fetchGhIssueMeta(gh, remote, active.issue);
  return meta ? { ...active, title: meta.title } : active;
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

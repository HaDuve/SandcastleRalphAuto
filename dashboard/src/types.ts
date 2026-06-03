export type RunOutcome = {
  outcome: "queue-empty" | "blocked" | "awaiting-human" | "killed" | "error";
  reason?: string;
  phase?: string;
  stoppedAt: string;
  logRef?: string;
  /** Merged-tail recovery skipped after exhaustion (ADR 0011). */
  recoveryWarning?: string;
};

export type ProjectActiveSummary = {
  issue: number;
  title?: string;
  phase: string;
  status: "active" | "blocked" | "awaiting-human";
  branch?: string;
  pr?: number;
  startedAt?: string;
};

export type Project = {
  id: string;
  path: string;
  remote: string;
  defaultBase: string;
  afkLabel: string;
  blockedLabels: string[];
  autoMerge: boolean;
  concurrency: "single";
  sandbox: "none";
  workerStatus?: "idle" | "running" | "paused";
  lastRunOutcome?: RunOutcome | null;
  active?: ProjectActiveSummary | null;
};

export type QueueIssue = {
  number: number;
  labels: string[];
  skipped: boolean;
  eligible: boolean;
};

export type ActiveSlice = {
  issue: number;
  title?: string;
  phase: string;
  branch: string;
  pr?: number;
  status: "active" | "blocked" | "awaiting-human";
  reason?: string;
  resumeSkill?: string;
  startedAt?: string;
  debug?: {
    activePath: string;
    activeMtimeMs: number | null;
    activeBytes: number | null;
    workerLockPath: string;
    workerLockPid: number | null;
  };
};

export type HistoryPhase = {
  phase: string;
  startedAt: string;
  endedAt: string;
};

export type HistoryEntry = {
  pr: number;
  issue: number;
  branch: string;
  startedAt: string;
  endedAt: string;
  phases: HistoryPhase[];
};

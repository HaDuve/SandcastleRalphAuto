export type RunOutcome = {
  outcome: "queue-empty" | "blocked" | "awaiting-human" | "killed" | "error";
  reason?: string;
  phase?: string;
  stoppedAt: string;
  logRef?: string;
};

export type ProjectActiveSummary = {
  issue: number;
  phase: string;
  status: "active" | "blocked" | "awaiting-human";
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
  phase: string;
  branch: string;
  pr?: number;
  status: "active" | "blocked" | "awaiting-human";
  reason?: string;
  resumeSkill?: string;
  startedAt?: string;
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

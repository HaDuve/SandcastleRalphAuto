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

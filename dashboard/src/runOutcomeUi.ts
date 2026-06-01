import type { RunOutcome } from "./types.js";

export function formatOutcomeLabel(outcome: RunOutcome["outcome"]): string {
  switch (outcome) {
    case "queue-empty":
      return "Queue empty";
    case "blocked":
      return "Blocked";
    case "awaiting-human":
      return "Awaiting human";
    case "killed":
      return "Killed";
    case "error":
      return "Error";
  }
}

export function outcomeBannerClass(outcome: RunOutcome["outcome"]): string {
  return `run-outcome-banner--${outcome}`;
}

export function phaseLogHref(projectId: string, phase: string): string {
  const params = new URLSearchParams({ phase });
  return `/api/projects/${encodeURIComponent(projectId)}/log?${params}`;
}

export function phaseLogLinkLabel(phase: string): string {
  return `${phase} log`;
}

export function projectCardClass(lastOutcome: RunOutcome | null | undefined): string {
  if (!lastOutcome) {
    return "project-card";
  }
  return `project-card project-card--${lastOutcome.outcome}`;
}

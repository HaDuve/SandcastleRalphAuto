import type { ActiveSlice, Project, ProjectActiveSummary } from "./types.js";

export function activeSummariesFromProjects(
  projects: Project[],
): Record<string, ProjectActiveSummary | null> {
  const summaries: Record<string, ProjectActiveSummary | null> = {};
  for (const project of projects) {
    summaries[project.id] = project.active ?? null;
  }
  return summaries;
}

export function activeSummaryFromSlice(
  active: ActiveSlice | null,
): ProjectActiveSummary | null {
  if (!active) {
    return null;
  }
  return {
    issue: active.issue,
    title: active.title,
    phase: active.phase,
    status: active.status,
    branch: active.branch,
    pr: active.pr,
    startedAt: active.startedAt,
  };
}

export function withActivePhase(
  summary: ProjectActiveSummary | null | undefined,
  phase: string,
  issue?: number,
): ProjectActiveSummary | null {
  if (!summary) {
    if (issue === undefined) {
      return null;
    }
    return { issue, phase, status: "active" };
  }
  return { ...summary, phase };
}

import type { ActiveSlice, ProjectActiveSummary, QueueIssue } from "./types.js";

export const STARTING_PLACEHOLDER_PHASE = "starting…";

export function firstEligibleQueueIssue(queue: QueueIssue[]): number | null {
  let best: number | null = null;
  for (const entry of queue) {
    if (!entry.eligible || entry.skipped) {
      continue;
    }
    if (best === null || entry.number < best) {
      best = entry.number;
    }
  }
  return best;
}

function branchForIssue(issue: number): string {
  return `issue-${issue}`;
}

function summaryToSlice(summary: ProjectActiveSummary): ActiveSlice {
  return {
    issue: summary.issue,
    title: summary.title,
    phase: summary.phase,
    branch: summary.branch ?? branchForIssue(summary.issue),
    pr: summary.pr,
    startedAt: summary.startedAt,
    status: summary.status,
  };
}

export function optimisticStartContext(input: {
  queue: QueueIssue[];
  active: ActiveSlice | null;
  catalogActive: ProjectActiveSummary | null | undefined;
  summary: ProjectActiveSummary | null | undefined;
}): { summary: ProjectActiveSummary; slice: ActiveSlice | null } {
  if (input.active) {
    const { issue, title, phase, status, branch, pr, startedAt } = input.active;
    return {
      summary: { issue, title, phase, status, branch, pr, startedAt },
      slice: input.active,
    };
  }

  if (input.summary) {
    return {
      summary: input.summary,
      slice: summaryToSlice(input.summary),
    };
  }

  if (input.catalogActive) {
    return {
      summary: input.catalogActive,
      slice: summaryToSlice(input.catalogActive),
    };
  }

  const nextIssue = firstEligibleQueueIssue(input.queue);
  if (nextIssue !== null) {
    const summary: ProjectActiveSummary = {
      issue: nextIssue,
      phase: "tdd",
      status: "active",
      branch: branchForIssue(nextIssue),
    };
    return { summary, slice: summaryToSlice(summary) };
  }

  const summary: ProjectActiveSummary = {
    issue: 0,
    phase: STARTING_PLACEHOLDER_PHASE,
    status: "active",
  };
  return {
    summary,
    slice: {
      issue: 0,
      phase: STARTING_PLACEHOLDER_PHASE,
      branch: "—",
      status: "active",
    },
  };
}

export function focusedPhase(
  projectId: string | null,
  activeSummaries: Record<string, ProjectActiveSummary | null>,
  active: ActiveSlice | null,
): string | null {
  if (projectId === null) {
    return null;
  }
  return activeSummaries[projectId]?.phase ?? active?.phase ?? null;
}

export function focusedLogIssue(
  projectId: string | null,
  active: ActiveSlice | null,
  catalogActive: ProjectActiveSummary | null | undefined,
  activeSummaries: Record<string, ProjectActiveSummary | null>,
): number | null {
  if (active?.issue !== undefined) {
    return active.issue;
  }
  if (catalogActive?.issue !== undefined) {
    return catalogActive.issue;
  }
  if (projectId === null) {
    return null;
  }
  const summaryIssue = activeSummaries[projectId]?.issue;
  return summaryIssue !== undefined && summaryIssue > 0 ? summaryIssue : null;
}

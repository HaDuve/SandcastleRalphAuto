import { type Project } from "../registry/index.js";

export type GhIssue = {
  number: number;
  state: "OPEN" | "CLOSED";
  labels: { name: string }[];
};

export function filterEligibleIssues(
  issues: GhIssue[],
  project: Pick<Project, "afkLabel" | "blockedLabels">,
  skips: number[],
): GhIssue[] {
  const skipSet = new Set(skips);

  return issues.filter((candidate) => {
    if (candidate.state !== "OPEN") {
      return false;
    }
    if (skipSet.has(candidate.number)) {
      return false;
    }

    const labelNames = new Set(candidate.labels.map((label) => label.name));
    if (!labelNames.has(project.afkLabel)) {
      return false;
    }

    return !project.blockedLabels.some((blocked) => labelNames.has(blocked));
  });
}

export function selectNextIssue(
  issues: GhIssue[],
  project: Pick<Project, "afkLabel" | "blockedLabels">,
  skips: number[],
): number | null {
  const eligible = filterEligibleIssues(issues, project, skips);
  if (eligible.length === 0) {
    return null;
  }

  return eligible.reduce((lowest, current) =>
    current.number < lowest.number ? current : lowest,
  ).number;
}

export function parseGhIssueList(raw: string): GhIssue[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as GhIssue[]) : null;
  } catch {
    return null;
  }
}

import { filterEligibleIssues, parseGhIssueList } from "../next/select.js";
import { type Project } from "../registry/index.js";
import { readSkips } from "../state/index.js";
import { type GhRunner } from "../merge/index.js";

export type QueueIssue = {
  number: number;
  title?: string;
  labels: string[];
  skipped: boolean;
  eligible: boolean;
};

export async function fetchProjectQueue(
  project: Project,
  stateRoot: string,
  gh: GhRunner,
  readSkipsFn: typeof readSkips = readSkips,
): Promise<QueueIssue[]> {
  const issuesRaw = await gh([
    "issue",
    "list",
    "--repo",
    project.remote,
    "--state",
    "open",
    "--label",
    project.afkLabel,
    "--json",
    "number,title,labels,state",
  ]);
  const issues = parseGhIssueList(issuesRaw) ?? [];
  const skips = await readSkipsFn(project.remote, stateRoot);
  const skipSet = new Set(skips);
  const eligible = filterEligibleIssues(issues, project, skips);
  const eligibleSet = new Set(eligible.map((issue) => issue.number));

  return issues.map((issue) => {
    const row: QueueIssue = {
      number: issue.number,
      labels: issue.labels.map((label) => label.name),
      skipped: skipSet.has(issue.number),
      eligible: eligibleSet.has(issue.number),
    };
    if (typeof issue.title === "string" && issue.title.length > 0) {
      row.title = issue.title;
    }
    return row;
  });
}

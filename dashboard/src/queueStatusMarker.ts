import type { Project, QueueIssue } from "./types.js";

export function queueIssueNeedsStatusMarker(
  issue: QueueIssue,
  project: Project,
): boolean {
  if (issue.skipped) {
    return true;
  }
  return issue.labels.some((label) => project.blockedLabels.includes(label));
}

import type { Project, QueueIssue } from "./types.js";

export function exclusionReason(
  issue: QueueIssue,
  project: Project,
): string | null {
  if (issue.skipped) {
    return "Skipped by operator";
  }
  if (issue.eligible) {
    return null;
  }
  const blocked = issue.labels.find((label) => project.blockedLabels.includes(label));
  if (blocked) {
    return `Blocked: ${blocked}`;
  }
  return "Not eligible";
}

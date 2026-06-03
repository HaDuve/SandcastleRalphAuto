import { describe, expect, it } from "vitest";
import { queueIssueNeedsStatusMarker } from "../../dashboard/src/queueStatusMarker.js";
import type { Project, QueueIssue } from "../../dashboard/src/types.js";

const portfolio: Project = {
  id: "portfolio",
  path: "/tmp/portfolio",
  remote: "HaDuve/Portfolio",
  defaultBase: "main",
  afkLabel: "ready-for-agent",
  blockedLabels: ["needs-info"],
  autoMerge: true,
  concurrency: "single",
  sandbox: "none",
};

describe("queueIssueNeedsStatusMarker", () => {
  it("marks skipped issues", () => {
    const issue: QueueIssue = {
      number: 1,
      labels: ["ready-for-agent"],
      skipped: true,
      eligible: false,
    };
    expect(queueIssueNeedsStatusMarker(issue, portfolio)).toBe(true);
  });

  it("marks issues with a blocked label", () => {
    const issue: QueueIssue = {
      number: 2,
      labels: ["ready-for-agent", "needs-info"],
      skipped: false,
      eligible: false,
    };
    expect(queueIssueNeedsStatusMarker(issue, portfolio)).toBe(true);
  });

  it("does not mark eligible issues", () => {
    const issue: QueueIssue = {
      number: 3,
      labels: ["ready-for-agent"],
      skipped: false,
      eligible: true,
    };
    expect(queueIssueNeedsStatusMarker(issue, portfolio)).toBe(false);
  });
});

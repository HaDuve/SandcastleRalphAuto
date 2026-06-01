import { describe, expect, it } from "vitest";
import { exclusionReason } from "../../dashboard/src/queueReason.js";
import type { Project, QueueIssue } from "../../dashboard/src/types.js";

const project: Project = {
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

describe("exclusionReason", () => {
  it("returns null for eligible issues", () => {
    const issue: QueueIssue = {
      number: 10,
      labels: ["ready-for-agent"],
      skipped: false,
      eligible: true,
    };

    expect(exclusionReason(issue, project)).toBeNull();
  });

  it("returns operator skip reason", () => {
    const issue: QueueIssue = {
      number: 15,
      labels: ["ready-for-agent"],
      skipped: true,
      eligible: false,
    };

    expect(exclusionReason(issue, project)).toBe("Skipped by operator");
  });

  it("returns blocked label reason", () => {
    const issue: QueueIssue = {
      number: 12,
      labels: ["ready-for-agent", "needs-info"],
      skipped: false,
      eligible: false,
    };

    expect(exclusionReason(issue, project)).toBe("Blocked: needs-info");
  });
});

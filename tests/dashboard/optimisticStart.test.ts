import { describe, expect, it } from "vitest";
import {
  STARTING_PLACEHOLDER_PHASE,
  firstEligibleQueueIssue,
  focusedPhase,
  optimisticStartContext,
} from "../../dashboard/src/optimisticStart.js";
import type { ActiveSlice, QueueIssue } from "../../dashboard/src/types.js";

describe("firstEligibleQueueIssue", () => {
  it("returns the lowest eligible issue number", () => {
    const queue: QueueIssue[] = [
      { number: 12, labels: [], skipped: false, eligible: true },
      { number: 10, labels: [], skipped: false, eligible: true },
      { number: 11, labels: [], skipped: false, eligible: false },
    ];
    expect(firstEligibleQueueIssue(queue)).toBe(10);
  });

  it("ignores skipped and ineligible issues", () => {
    const queue: QueueIssue[] = [
      { number: 10, labels: [], skipped: true, eligible: true },
      { number: 11, labels: [], skipped: false, eligible: false },
    ];
    expect(firstEligibleQueueIssue(queue)).toBeNull();
  });
});

describe("optimisticStartContext", () => {
  const active: ActiveSlice = {
    issue: 11,
    phase: "review-pr",
    branch: "issue-11",
    status: "active",
  };

  it("reuses the focused active slice when resuming", () => {
    const result = optimisticStartContext({
      queue: [],
      active,
      catalogActive: null,
      summary: null,
    });
    expect(result.summary).toMatchObject({ issue: 11, phase: "review-pr", status: "active", branch: "issue-11" });
    expect(result.slice).toEqual(active);
  });

  it("uses the sidebar summary when active panel is empty", () => {
    const result = optimisticStartContext({
      queue: [],
      active: null,
      catalogActive: null,
      summary: { issue: 9, phase: "merge", status: "blocked" },
    });
    expect(result.summary.phase).toBe("merge");
    expect(result.slice?.branch).toBe("issue-9");
  });

  it("bootstraps tdd for the queue head when nothing is active yet", () => {
    const queue: QueueIssue[] = [
      { number: 10, labels: [], skipped: false, eligible: true },
    ];
    const result = optimisticStartContext({
      queue,
      active: null,
      catalogActive: null,
      summary: null,
    });
    expect(result.summary).toEqual({ issue: 10, phase: "tdd", status: "active", branch: "issue-10" });
    expect(result.slice).toMatchObject({ issue: 10, phase: "tdd", branch: "issue-10" });
  });

  it("falls back to a starting placeholder when context is unknown", () => {
    const result = optimisticStartContext({
      queue: [],
      active: null,
      catalogActive: null,
      summary: null,
    });
    expect(result.summary.phase).toBe(STARTING_PLACEHOLDER_PHASE);
    expect(result.slice?.phase).toBe(STARTING_PLACEHOLDER_PHASE);
  });
});

describe("focusedPhase", () => {
  it("prefers activeSummaries over REST active", () => {
    expect(
      focusedPhase("portfolio", { portfolio: { issue: 1, phase: "create-pr", status: "active" } }, {
        issue: 1,
        phase: "tdd",
        branch: "issue-1",
        status: "active",
      }),
    ).toBe("create-pr");
  });
});

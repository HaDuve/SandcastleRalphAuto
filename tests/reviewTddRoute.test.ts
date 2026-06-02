import { describe, expect, it } from "vitest";
import {
  isProceduralMergeBlockerText,
  isReviewTddProceduralOnlyBlockedHandoff,
  normalizeReviewTddProceduralDoneHandoff,
} from "../src/handoff/reviewTddRoute.js";
import type { Handoff } from "../src/handoff/index.js";
import { advanceSlice } from "../src/pipeline/advance.js";
import { PHASE_COMPLETE_SIGNAL } from "../src/runner/index.js";

const baseHandoff: Handoff = {
  project: "o/r",
  issue: 99,
  branch: "issue-99",
  phase: "review-tdd",
  acceptanceState: "blocked",
  blockers: ["PR author cannot submit an approving review (branch protection)"],
  mergeReady: false,
  nextSkill: "/merge",
  startedAt: "2026-06-01T00:00:00.000Z",
  endedAt: "2026-06-01T01:00:00.000Z",
  pr: 111,
};

describe("reviewTddRoute", () => {
  it("detects procedural merge blocker text", () => {
    expect(
      isProceduralMergeBlockerText(
        "PR author cannot submit an approving review to satisfy branch protection",
      ),
    ).toBe(true);
    expect(isProceduralMergeBlockerText("Add input validation for branch delete")).toBe(
      false,
    );
  });

  it("matches procedural-only blocked review-tdd handoff", () => {
    expect(isReviewTddProceduralOnlyBlockedHandoff(baseHandoff)).toBe(true);
    expect(
      isReviewTddProceduralOnlyBlockedHandoff({
        ...baseHandoff,
        blockers: ["Fix failing unit test in cleanup.ts"],
      }),
    ).toBe(false);
  });

  it("normalizes procedural blocked handoff to done for merge", () => {
    const fixed = normalizeReviewTddProceduralDoneHandoff(baseHandoff);
    expect(fixed.acceptanceState).toBe("done");
    expect(fixed.blockers).toEqual([]);
    expect(fixed.nextSkill).toBe("/merge");
  });

  it("advanceSlice advances review-tdd when only procedural blockers remain", () => {
    const outcome = advanceSlice({
      issue: 99,
      branch: "issue-99",
      pr: 111,
      phase: "review-tdd",
      result: {
        commits: [],
        branch: "issue-99",
        completionSignal: PHASE_COMPLETE_SIGNAL,
        handoff: baseHandoff,
      },
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.active.phase).toBe("merge");
    }
  });
});

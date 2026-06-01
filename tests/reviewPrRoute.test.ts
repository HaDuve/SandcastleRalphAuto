import { describe, expect, it } from "vitest";
import {
  formatReviewFindingsNote,
  isReviewPrRequestChangesToReviewTdd,
} from "../src/handoff/reviewPrRoute.js";
import { type Handoff } from "../src/handoff/index.js";

function reviewPrHandoff(overrides: Partial<Handoff> = {}): Handoff {
  return {
    project: "HaDuve/SandcastleRalphAuto",
    issue: 7,
    branch: "issue-7",
    phase: "review-pr",
    acceptanceState: "done",
    blockers: ["lint"],
    mergeReady: false,
    nextSkill: "/review-tdd",
    startedAt: "2026-06-01T00:00:00.000Z",
    endedAt: "2026-06-01T01:00:00.000Z",
    ...overrides,
  };
}

describe("isReviewPrRequestChangesToReviewTdd", () => {
  it("matches request-changes with findings in blockers", () => {
    expect(
      isReviewPrRequestChangesToReviewTdd(
        reviewPrHandoff({ verdict: "request-changes" }),
      ),
    ).toBe(true);
  });

  it("matches when verdict is omitted but route is /review-tdd", () => {
    expect(isReviewPrRequestChangesToReviewTdd(reviewPrHandoff())).toBe(true);
  });

  it("rejects approve verdict with open blockers", () => {
    expect(
      isReviewPrRequestChangesToReviewTdd(
        reviewPrHandoff({ verdict: "approve" }),
      ),
    ).toBe(false);
  });

  it("rejects wrong nextSkill", () => {
    expect(
      isReviewPrRequestChangesToReviewTdd(
        reviewPrHandoff({ nextSkill: "/merge" }),
      ),
    ).toBe(false);
  });
});

describe("formatReviewFindingsNote", () => {
  it("formats non-empty blockers", () => {
    expect(formatReviewFindingsNote(["a", "b"])).toBe(
      "Review findings (addressed in review-tdd): a; b",
    );
  });
});

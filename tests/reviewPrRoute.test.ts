import { describe, expect, it } from "vitest";
import {
  formatReviewFindingsNote,
  isReviewPrProceduralOnlyBlockedHandoff,
  isReviewPrRequestChangesToReviewTdd,
  isReviewPrRoutedToReviewTdd,
  normalizeReviewPrProceduralDoneHandoff,
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

  it("matches approve verdict with nits in blockers (ADR 0011)", () => {
    expect(
      isReviewPrRoutedToReviewTdd(
        reviewPrHandoff({ verdict: "approve", blockers: ["nit: rename helper"] }),
      ),
    ).toBe(true);
    expect(
      isReviewPrRequestChangesToReviewTdd(
        reviewPrHandoff({ verdict: "approve", blockers: ["nit: rename helper"] }),
      ),
    ).toBe(true);
  });

  it("rejects wrong nextSkill", () => {
    expect(
      isReviewPrRequestChangesToReviewTdd(
        reviewPrHandoff({ nextSkill: "/merge" }),
      ),
    ).toBe(false);
  });
});

describe("review-pr procedural blocked", () => {
  it("matches procedural-only blocked handoff at review-pr", () => {
    expect(
      isReviewPrProceduralOnlyBlockedHandoff({
        ...reviewPrHandoff(),
        acceptanceState: "blocked",
        blockers: ["Different maintainer must approve PR #113 (GitHub disallows self-approval)"],
      }),
    ).toBe(true);
  });

  it("normalizes procedural blocked handoff to done and strips procedural blockers", () => {
    const fixed = normalizeReviewPrProceduralDoneHandoff({
      ...reviewPrHandoff({ verdict: "approve" }),
      acceptanceState: "blocked",
      blockers: [
        "Different maintainer must approve",
        "nit: wire server-log SSE",
      ],
    });
    expect(fixed.acceptanceState).toBe("done");
    expect(fixed.blockers).toEqual(["nit: wire server-log SSE"]);
    expect(fixed.nextSkill).toBe("/review-tdd");
  });
});

describe("formatReviewFindingsNote", () => {
  it("formats non-empty blockers", () => {
    expect(formatReviewFindingsNote(["a", "b"])).toBe(
      "Review findings (addressed in review-tdd): a; b",
    );
  });
});

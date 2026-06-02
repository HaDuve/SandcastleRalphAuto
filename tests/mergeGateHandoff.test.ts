import { describe, expect, it } from "vitest";
import { type Handoff } from "../src/handoff/index.js";
import { normalizeHandoffForMergeGate } from "../src/merge/mergeGateHandoff.js";

function babysitDoneHandoff(overrides: Partial<Handoff> = {}): Handoff {
  return {
    project: "HaDuve/SandcastleRalphAuto",
    issue: 80,
    branch: "issue-80",
    pr: 87,
    phase: "babysit",
    acceptanceState: "done",
    verdict: "n/a",
    blockers: [],
    mergeReady: true,
    nextSkill: "/merge",
    startedAt: "2026-06-01T00:00:00.000Z",
    endedAt: "2026-06-01T01:00:00.000Z",
    ...overrides,
  };
}

describe("normalizeHandoffForMergeGate", () => {
  it("coerces babysit done with mergeReady to approve for the merge gate", () => {
    const normalized = normalizeHandoffForMergeGate(babysitDoneHandoff());

    expect(normalized.verdict).toBe("approve");
    expect(normalized.phase).toBe("babysit");
  });

  it("uses cached review handoff approve when babysit wrote n/a", () => {
    const review: Handoff = {
      ...babysitDoneHandoff(),
      phase: "review-tdd",
      verdict: "approve",
      nextSkill: "/merge",
    };

    const normalized = normalizeHandoffForMergeGate(
      babysitDoneHandoff(),
      review,
    );

    expect(normalized.verdict).toBe("approve");
  });

  it("does not coerce request-changes", () => {
    const normalized = normalizeHandoffForMergeGate(
      babysitDoneHandoff({ verdict: "request-changes", mergeReady: false }),
    );

    expect(normalized.verdict).toBe("request-changes");
  });
});

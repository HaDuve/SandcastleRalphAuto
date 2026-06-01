import { describe, expect, it } from "vitest";
import { buildPhaseStepperSteps } from "../../dashboard/src/phaseStepperSteps.js";

describe("buildPhaseStepperSteps", () => {
  it("marks earlier phases done and the current phase current", () => {
    expect(buildPhaseStepperSteps("review-pr")).toEqual([
      { phase: "tdd", state: "done" },
      { phase: "create-pr", state: "done" },
      { phase: "review-pr", state: "current" },
      { phase: "review-tdd", state: "pending" },
      { phase: "merge", state: "pending" },
      { phase: "next", state: "pending" },
    ]);
  });

  it("inserts babysit between merge and next when that recovery phase is active", () => {
    expect(buildPhaseStepperSteps("babysit")).toEqual([
      { phase: "tdd", state: "done" },
      { phase: "create-pr", state: "done" },
      { phase: "review-pr", state: "done" },
      { phase: "review-tdd", state: "done" },
      { phase: "merge", state: "done" },
      { phase: "babysit", state: "current" },
      { phase: "next", state: "pending" },
    ]);
  });

  it("leaves all steps pending when there is no active phase", () => {
    expect(buildPhaseStepperSteps(null)).toEqual([
      { phase: "tdd", state: "pending" },
      { phase: "create-pr", state: "pending" },
      { phase: "review-pr", state: "pending" },
      { phase: "review-tdd", state: "pending" },
      { phase: "merge", state: "pending" },
      { phase: "next", state: "pending" },
    ]);
  });
});

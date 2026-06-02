import { describe, expect, it } from "vitest";
import {
  isMergeAcceptanceBlockedStallReason,
  isMergeDeferredToBabysit,
} from "../src/handoff/index.js";

const conflictBlockers = [
  "PR #87 not mergeable: mergeStateStatus DIRTY — merge conflict with main",
];

describe("isMergeDeferredToBabysit", () => {
  it("is true when merge handoff is blocked and routes to /babysit", () => {
    expect(
      isMergeDeferredToBabysit({
        phase: "merge",
        acceptanceState: "blocked",
        nextSkill: "/babysit",
        mergeReady: false,
        blockers: conflictBlockers,
      }),
    ).toBe(true);
  });

  it("is true when blocked merge wrote /next but blockers are conflict/CI", () => {
    expect(
      isMergeDeferredToBabysit({
        phase: "merge",
        acceptanceState: "blocked",
        nextSkill: "/next",
        verdict: "approve",
        mergeReady: false,
        blockers: conflictBlockers,
      }),
    ).toBe(true);
  });

  it("is false when merge handoff is done", () => {
    expect(
      isMergeDeferredToBabysit({
        phase: "merge",
        acceptanceState: "done",
        nextSkill: "/next",
        mergeReady: true,
        blockers: [],
      }),
    ).toBe(false);
  });

  it("is false when blocked merge routes to review-tdd", () => {
    expect(
      isMergeDeferredToBabysit({
        phase: "merge",
        acceptanceState: "blocked",
        nextSkill: "/review-tdd",
        mergeReady: false,
        blockers: ["Open in-scope finding"],
      }),
    ).toBe(false);
  });

  it("is false when blocked with /next but no babysit-able blockers", () => {
    expect(
      isMergeDeferredToBabysit({
        phase: "merge",
        acceptanceState: "blocked",
        nextSkill: "/next",
        verdict: "approve",
        mergeReady: false,
        blockers: ["Requires explicit human sign-off"],
      }),
    ).toBe(false);
  });
});

describe("isMergeAcceptanceBlockedStallReason", () => {
  it("detects the advanceSlice stall message for blocked merge acceptance", () => {
    expect(
      isMergeAcceptanceBlockedStallReason(
        "Handoff acceptanceState is blocked, expected done",
        "merge",
      ),
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  isMergeAcceptanceBlockedStallReason,
  isMergeDeferredToBabysit,
} from "../src/handoff/index.js";

describe("isMergeDeferredToBabysit", () => {
  it("is true when merge handoff is blocked and routes to /babysit", () => {
    expect(
      isMergeDeferredToBabysit({
        phase: "merge",
        acceptanceState: "blocked",
        nextSkill: "/babysit",
      }),
    ).toBe(true);
  });

  it("is false when merge handoff is done", () => {
    expect(
      isMergeDeferredToBabysit({
        phase: "merge",
        acceptanceState: "done",
        nextSkill: "/next",
      }),
    ).toBe(false);
  });

  it("is false when blocked merge handoff does not route to babysit", () => {
    expect(
      isMergeDeferredToBabysit({
        phase: "merge",
        acceptanceState: "blocked",
        nextSkill: "/next",
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

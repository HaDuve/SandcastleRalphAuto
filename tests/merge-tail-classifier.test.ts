import { describe, expect, it } from "vitest";
import { type Handoff } from "../src/handoff/index.js";
import { classifyMergeTailBlock } from "../src/merge/classifyMergeTailBlock.js";
import { type MergeGateBlockKind } from "../src/merge/blockKinds.js";
import { type RunMergeGateBlocked } from "../src/merge/gate.js";

function blocked(kind: MergeGateBlockKind): Pick<RunMergeGateBlocked, "kind"> {
  return { kind };
}

function handoff(
  nextSkill: string,
  phase: Handoff["phase"] = "merge",
): Pick<Handoff, "nextSkill" | "phase"> {
  return { nextSkill, phase };
}

describe("classifyMergeTailBlock", () => {
  it.each([
    "required-checks-failed",
    "pr-not-mergeable",
    "unresolved-review-comments",
  ] as const)("classifies %s as babysit-able", (kind) => {
    expect(classifyMergeTailBlock(blocked(kind), handoff("/merge"))).toBe(
      "babysit-able",
    );
  });

  it.each([
    "no-approve-verdict",
    "open-blockers",
    "checks-parse-error",
    "mergeability-parse-error",
    "missing-merge-prerequisites",
  ] as const)("classifies %s as human", (kind) => {
    expect(classifyMergeTailBlock(blocked(kind), handoff("/merge"))).toBe(
      "human",
    );
  });

  it("classifies review-pr route to review-tdd as human even for CI failure", () => {
    expect(
      classifyMergeTailBlock(
        blocked("required-checks-failed"),
        handoff("/review-tdd", "review-pr"),
      ),
    ).toBe("human");
  });

  it("classifies CI failure as babysit-able after review-tdd (merge handoff)", () => {
    expect(
      classifyMergeTailBlock(
        blocked("required-checks-failed"),
        handoff("/merge", "review-tdd"),
      ),
    ).toBe("babysit-able");
  });
});

import { describe, expect, it } from "vitest";
import { type Handoff } from "../src/handoff/index.js";
import { classifyMergeTailBlock } from "../src/merge/classifyMergeTailBlock.js";
import { type MergeGateBlockKind } from "../src/merge/blockKinds.js";
import { type RunMergeGateBlocked } from "../src/merge/gate.js";

function blocked(kind: MergeGateBlockKind): Pick<RunMergeGateBlocked, "kind"> {
  return { kind };
}

function handoff(nextSkill: string): Pick<Handoff, "nextSkill"> {
  return { nextSkill };
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

  it("classifies review-tdd routing as human even for CI failure", () => {
    expect(
      classifyMergeTailBlock(
        blocked("required-checks-failed"),
        handoff("/review-tdd"),
      ),
    ).toBe("human");
  });
});

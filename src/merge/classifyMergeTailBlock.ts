import { type Handoff } from "../handoff/index.js";
import { type MergeGateBlockKind } from "./blockKinds.js";
import { type RunMergeGateBlocked } from "./gate.js";

export type MergeTailBlockClassification = "babysit-able" | "human";

const BABYSITABLE_KINDS: ReadonlySet<MergeGateBlockKind> = new Set([
  "required-checks-failed",
  "pr-not-mergeable",
  "unresolved-review-comments",
]);

export function classifyMergeTailBlock(
  blocked: Pick<RunMergeGateBlocked, "kind">,
  handoff: Pick<Handoff, "nextSkill">,
): MergeTailBlockClassification {
  if (handoff.nextSkill === "/review-tdd") {
    return "human";
  }
  if (BABYSITABLE_KINDS.has(blocked.kind)) {
    return "babysit-able";
  }
  return "human";
}

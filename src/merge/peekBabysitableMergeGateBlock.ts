import type { Handoff } from "../handoff/index.js";
import { classifyMergeTailBlock } from "./classifyMergeTailBlock.js";
import {
  runMergeGate,
  type GhRunner,
  type RunMergeGateBlocked,
  type RunMergeGateInput,
} from "./gate.js";
import { normalizeHandoffForMergeGate } from "./mergeGateHandoff.js";

/**
 * Returns a babysit-able merge-gate block when the PR is not ready to merge yet
 * (e.g. red required CI). Human-only blocks (no Approve) return null.
 */
export async function peekBabysitableMergeGateBlock(
  input: RunMergeGateInput,
  deps: { gh: GhRunner },
  reviewHandoff?: Handoff,
): Promise<Pick<RunMergeGateBlocked, "kind" | "reason"> | null> {
  const handoff = normalizeHandoffForMergeGate(input.handoff, reviewHandoff);
  const result = await runMergeGate({ ...input, handoff }, deps);
  if (result.status !== "blocked") {
    return null;
  }
  if (classifyMergeTailBlock(result, handoff) !== "babysit-able") {
    return null;
  }
  return { kind: result.kind, reason: result.reason };
}

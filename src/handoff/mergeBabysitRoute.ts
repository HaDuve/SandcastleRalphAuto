import type { Handoff } from "./schema.js";

function hasBabysitableMergeBlockers(blockers: readonly string[]): boolean {
  if (blockers.length === 0) {
    return false;
  }
  const text = blockers.join(" ");
  return (
    /\bconflict/i.test(text) ||
    /not mergeable/i.test(text) ||
    /\bmergeable\b/i.test(text) ||
    /\bdirty\b/i.test(text) ||
    /\bci\b/i.test(text) ||
    /\bchecks?\b/i.test(text) ||
    /\bcomments?\b/i.test(text)
  );
}

type MergeBabysitHandoff = Pick<
  Handoff,
  | "phase"
  | "acceptanceState"
  | "nextSkill"
  | "mergeReady"
  | "verdict"
  | "blockers"
>;

/**
 * Merge agent could not land the PR (conflicts, CI, etc.) and the host should run
 * `/babysit` instead of marking the slice blocked (ADR 0006).
 *
 * Agents sometimes write `nextSkill: "/next"` while blocked; infer babysit from
 * `mergeReady`, verdict, and conflict/CI blockers when review already approved.
 */
export function isMergeDeferredToBabysit(handoff: MergeBabysitHandoff): boolean {
  if (handoff.phase !== "merge" || handoff.acceptanceState !== "blocked") {
    return false;
  }
  if (handoff.nextSkill === "/babysit") {
    return true;
  }
  if (handoff.nextSkill === "/review-tdd") {
    return false;
  }
  if (handoff.verdict === "request-changes") {
    return false;
  }
  if (handoff.mergeReady !== false) {
    return false;
  }
  if (handoff.nextSkill !== "/next") {
    return false;
  }
  return hasBabysitableMergeBlockers(handoff.blockers);
}

export function isMergeAcceptanceBlockedStallReason(
  reason: string | undefined,
  phase: string,
): boolean {
  return (
    phase === "merge" &&
    reason !== undefined &&
    reason.includes("acceptanceState is blocked")
  );
}

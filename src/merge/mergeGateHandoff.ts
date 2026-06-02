import type { Handoff } from "../handoff/index.js";

/**
 * Babysit is mechanical recovery after review already passed; agents often write
 * `verdict: "n/a"` even when the PR is merge-ready (ADR 0006).
 */
export function normalizeHandoffForMergeGate(
  handoff: Handoff,
  reviewHandoff?: Handoff,
): Handoff {
  if (handoff.verdict === "approve" || handoff.verdict === "request-changes") {
    return handoff;
  }

  if (reviewHandoff?.verdict === "approve") {
    return { ...handoff, verdict: "approve" };
  }

  if (
    handoff.phase === "babysit" &&
    handoff.acceptanceState === "done" &&
    handoff.mergeReady &&
    handoff.blockers.length === 0
  ) {
    return { ...handoff, verdict: "approve" };
  }

  return handoff;
}

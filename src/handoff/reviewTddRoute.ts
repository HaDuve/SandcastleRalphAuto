import type { Handoff } from "./schema.js";

/**
 * Merge/procedural constraints that belong at the merge gate or for a human —
 * not as `review-tdd` `acceptanceState: "blocked"` (which stalls the linear pipeline).
 */
export function isProceduralMergeBlockerText(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /author can'?t approve/.test(lower) ||
    /can'?t submit an approving review/.test(lower) ||
    /branch protection/.test(lower) ||
    /\bprocedural\b/.test(lower) ||
    /self[- ]?approv/.test(lower) ||
    /no external reviewer approval/.test(lower) ||
    /merge gate requires/.test(lower) ||
    /clean approve verdict/.test(lower) ||
    /different maintainer/.test(lower) ||
    /must approve pr/.test(lower) ||
    /disallows self[- ]?approv/.test(lower) ||
    /github won'?t allow/.test(lower) ||
    /comment[- ]only/.test(lower)
  );
}

/**
 * `review-tdd` finished with code work done but marked blocked for merge/procedural reasons only.
 */
export function isReviewTddProceduralOnlyBlockedHandoff(handoff: Handoff): boolean {
  if (handoff.phase !== "review-tdd" || handoff.nextSkill !== "/merge") {
    return false;
  }
  if (handoff.acceptanceState !== "blocked") {
    return false;
  }
  if (handoff.blockers.length === 0) {
    return false;
  }
  return handoff.blockers.every(isProceduralMergeBlockerText);
}

export function isReviewTddAcceptanceBlockedStallReason(
  reason: string | undefined,
  phase: string,
): boolean {
  return (
    phase === "review-tdd" &&
    reason !== undefined &&
    reason.includes("acceptanceState is blocked") &&
    reason.includes("expected done")
  );
}

export function normalizeReviewTddProceduralDoneHandoff(handoff: Handoff): Handoff {
  const endedAt = handoff.endedAt || new Date().toISOString();
  return {
    ...handoff,
    phase: "review-tdd",
    acceptanceState: "done",
    blockers: [],
    mergeReady: false,
    nextSkill: "/merge",
    verdict: handoff.verdict ?? "n/a",
    endedAt,
  };
}

import type { Handoff } from "./schema.js";

/** review-pr finished with request-changes → host runs review-tdd (findings may live in `blockers`). */
export function isReviewPrRequestChangesToReviewTdd(handoff: Handoff): boolean {
  return (
    handoff.phase === "review-pr" &&
    handoff.verdict === "request-changes" &&
    handoff.nextSkill === "/review-tdd" &&
    handoff.acceptanceState === "done"
  );
}

export function formatReviewFindingsNote(blockers: string[]): string | null {
  if (blockers.length === 0) {
    return null;
  }
  return `Review findings (addressed in review-tdd): ${blockers.join("; ")}`;
}

export function isReviewPrBlockersStallReason(
  reason: string | undefined,
  phase: string,
): boolean {
  return (
    phase === "review-pr" &&
    reason !== undefined &&
    reason.startsWith("Handoff has blockers:")
  );
}

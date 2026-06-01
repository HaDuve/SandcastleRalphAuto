import type { Handoff } from "./schema.js";

/**
 * review-pr routed to review-tdd (findings may live in `blockers`).
 * `verdict` is optional; `approve` with open blockers is not a bypass.
 */
export function isReviewPrRequestChangesToReviewTdd(handoff: Handoff): boolean {
  return (
    handoff.phase === "review-pr" &&
    handoff.acceptanceState === "done" &&
    handoff.nextSkill === "/review-tdd" &&
    handoff.verdict !== "approve"
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

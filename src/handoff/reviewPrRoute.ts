import type { Handoff } from "./schema.js";
import {
  isProceduralMergeBlockerText,
} from "./reviewTddRoute.js";

/**
 * review-pr routed to review-tdd (findings, nits, or request-changes may live in `blockers`).
 */
export function isReviewPrRoutedToReviewTdd(handoff: Handoff): boolean {
  return (
    handoff.phase === "review-pr" &&
    handoff.acceptanceState === "done" &&
    handoff.nextSkill === "/review-tdd"
  );
}

/** @deprecated Use {@link isReviewPrRoutedToReviewTdd} — alias kept for ADR 0009 call sites. */
export const isReviewPrRequestChangesToReviewTdd = isReviewPrRoutedToReviewTdd;

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

export function isReviewPrAcceptanceBlockedStallReason(
  reason: string | undefined,
  phase: string,
): boolean {
  return (
    phase === "review-pr" &&
    reason !== undefined &&
    reason.includes("acceptanceState is blocked") &&
    reason.includes("expected done")
  );
}

/**
 * `review-pr` finished with procedural GitHub constraints only (not code findings).
 */
export function isReviewPrProceduralOnlyBlockedHandoff(handoff: Handoff): boolean {
  if (handoff.phase !== "review-pr" || handoff.nextSkill !== "/review-tdd") {
    return false;
  }
  if (handoff.acceptanceState !== "blocked") {
    return false;
  }
  if (handoff.blockers.length === 0) {
    return true;
  }
  return handoff.blockers.every(isProceduralMergeBlockerText);
}

export function normalizeReviewPrProceduralDoneHandoff(handoff: Handoff): Handoff {
  const endedAt = handoff.endedAt || new Date().toISOString();
  const blockers = handoff.blockers.filter(
    (text) => !isProceduralMergeBlockerText(text),
  );
  return {
    ...handoff,
    phase: "review-pr",
    acceptanceState: "done",
    blockers,
    mergeReady: false,
    nextSkill: "/review-tdd",
    verdict: handoff.verdict ?? "n/a",
    endedAt,
  };
}

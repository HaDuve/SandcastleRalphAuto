import { isMergeGateNoApproveBlockReason } from "../merge/mergeGateBlockReason.js";
import type { ActiveState } from "../state/index.js";
import { isMergeDeferredToBabysit } from "./mergeBabysitRoute.js";
import type { Handoff } from "./schema.js";

export const DEFAULT_MERGED_TAIL_MAX_ATTEMPTS = 2;

export const MERGED_TAIL_ELIGIBLE_PHASES = [
  "review-pr",
  "review-tdd",
  "merge",
] as const;

export type MergedTailEligiblePhase = (typeof MERGED_TAIL_ELIGIBLE_PHASES)[number];

export function isMergedTailEligiblePhase(phase: string): phase is MergedTailEligiblePhase {
  return (MERGED_TAIL_ELIGIBLE_PHASES as readonly string[]).includes(phase);
}

export function hasCompletedReviewTddApprove(handoff: Handoff): boolean {
  return (
    handoff.phase === "review-tdd" &&
    handoff.acceptanceState === "done" &&
    handoff.verdict === "approve" &&
    handoff.nextSkill === "/merge"
  );
}

export function isPipelineCompleteForMergedPr(handoff: Handoff): boolean {
  if (hasCompletedReviewTddApprove(handoff)) {
    return true;
  }
  return (
    handoff.phase === "merge" &&
    handoff.acceptanceState === "done" &&
    handoff.verdict === "approve"
  );
}

export function shouldEnterMergedTailRecovery(input: {
  active: ActiveState;
  prState: string;
  handoff: Handoff;
}): boolean {
  if (input.active.status !== "blocked") {
    return false;
  }
  if (!isMergedTailEligiblePhase(input.active.phase)) {
    return false;
  }
  if (input.active.pr === undefined) {
    return false;
  }
  if (input.prState !== "MERGED") {
    return false;
  }
  if (input.active.phase === "merge") {
    if (isMergeGateNoApproveBlockReason(input.active.reason)) {
      return false;
    }
    if (isMergeDeferredToBabysit(input.handoff)) {
      return false;
    }
    if (
      input.handoff.phase === "merge" &&
      input.handoff.acceptanceState === "blocked" &&
      input.handoff.nextSkill === "/review-tdd"
    ) {
      return false;
    }
  }
  return !isPipelineCompleteForMergedPr(input.handoff);
}

export function incrementMergedTailAttempt(handoff: Handoff): Handoff {
  const attempts = (handoff.mergedTailAttempts ?? 0) + 1;
  return { ...handoff, mergedTailAttempts: attempts };
}

export function isMergedTailExhausted(handoff: Handoff): boolean {
  return (handoff.mergedTailAttempts ?? 0) >= DEFAULT_MERGED_TAIL_MAX_ATTEMPTS;
}

export function buildMergedTailExhaustionWarning(issue: number, pr: number): string {
  return `Merged-tail recovery exhausted for issue #${issue} (PR #${pr}); advanced queue with warning`;
}

export function applyMergedTailExhaustionHandoff(
  handoff: Handoff,
  warning: string,
): Handoff {
  return {
    ...handoff,
    recoveryWarning: warning,
    endedAt: handoff.endedAt || new Date().toISOString(),
  };
}

export type MergedTailForceNextResume = {
  issue: number;
  pr: number;
  warning: string;
};

export type MergedTailRecoveryResume = {
  issue: number;
  pr: number;
  fromPhase: "review-pr";
  mergedTailReview: true;
};

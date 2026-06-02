import type { Handoff } from "./schema.js";

/**
 * Merge agent could not land the PR (conflicts, CI, etc.) and routes to `/babysit`.
 * Host runs recovery instead of marking the slice blocked (ADR 0006).
 */
export function isMergeDeferredToBabysit(
  handoff: Pick<Handoff, "phase" | "acceptanceState" | "nextSkill">,
): boolean {
  return (
    handoff.phase === "merge" &&
    handoff.acceptanceState === "blocked" &&
    handoff.nextSkill === "/babysit"
  );
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

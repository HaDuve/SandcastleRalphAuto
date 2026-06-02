import type { Handoff } from "./schema.js";
import { stat } from "node:fs/promises";
import {
  worktreeHasNoDiffVsOriginMain,
  type GitRunner,
} from "./worktreeNoDiff.js";

/** Host blocked because create-pr handoff used `acceptanceState: blocked`. */
export function isCreatePrNoDiffStallReason(
  reason: string | undefined,
  phase: string,
): boolean {
  return (
    phase === "create-pr" &&
    reason !== undefined &&
    reason.includes("acceptanceState is blocked") &&
    reason.includes("expected done")
  );
}

/** Agent prose for no-diff (fallback when git is unavailable). */
export function isCreatePrNoDiffBlockerText(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    (lower.includes("0 commits") && lower.includes("origin/main")) ||
    lower.includes("no pr was created") ||
    lower.includes("can't open a pr") ||
    lower.includes("cannot open a pr")
  );
}

export function isCreatePrNoDiffBlockedHandoff(handoff: Handoff): boolean {
  return (
    handoff.phase === "create-pr" &&
    handoff.acceptanceState === "blocked" &&
    handoff.blockers.some(isCreatePrNoDiffBlockerText)
  );
}

/** Host may advance the queue after create-pr with no PR to review. */
export function isCreatePrNoDiffDoneHandoff(handoff: Handoff): boolean {
  return (
    handoff.phase === "create-pr" &&
    handoff.acceptanceState === "done" &&
    handoff.nextSkill === "/next" &&
    handoff.pr === undefined &&
    handoff.blockers.length === 0
  );
}

export function normalizeCreatePrNoDiffHandoff(handoff: Handoff): Handoff {
  const endedAt = handoff.endedAt || new Date().toISOString();
  return {
    ...handoff,
    phase: "create-pr",
    acceptanceState: "done",
    blockers: [],
    mergeReady: false,
    nextSkill: "/next",
    pr: undefined,
    endedAt,
  };
}

/**
 * Git is source of truth; handoff must be create-pr no-diff shaped (blocked or done+/next).
 */
export async function confirmsCreatePrNoDiffAtWorktree(
  handoff: Handoff,
  worktreePath: string,
  git?: GitRunner,
): Promise<boolean> {
  if (handoff.phase !== "create-pr") {
    return false;
  }
  // If the worktree is missing (sandbox cleaned up), fall back to blocker text.
  try {
    await stat(worktreePath);
  } catch {
    return (
      isCreatePrNoDiffDoneHandoff(handoff) || isCreatePrNoDiffBlockedHandoff(handoff)
    );
  }

  const noDiff = await worktreeHasNoDiffVsOriginMain(worktreePath, git);
  if (!noDiff) {
    // Git could be unavailable or origin/main missing; fall back to blocker text.
    return (
      isCreatePrNoDiffDoneHandoff(handoff) || isCreatePrNoDiffBlockedHandoff(handoff)
    );
  }
  if (isCreatePrNoDiffDoneHandoff(handoff)) {
    return true;
  }
  // Git is source of truth: if the branch is not ahead of origin/main, treat
  // a blocked create-pr handoff as an empty slice even if the agent omitted
  // no-diff prose in `blockers`.
  return handoff.acceptanceState === "blocked";
}

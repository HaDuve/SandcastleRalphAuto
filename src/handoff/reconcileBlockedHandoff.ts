import { join } from "node:path";
import { parseRunnablePhase, type RunnablePhase } from "../prompts/phases.js";
import type { ActiveState } from "../state/schema.js";
import { readHostHandoff, writeHostHandoff } from "./hostStore.js";
import { readHandoff, writeHandoff } from "./io.js";
import type { Handoff } from "./schema.js";
import {
  isReviewPrBlockersStallReason,
  isReviewPrRequestChangesToReviewTdd,
} from "./reviewPrRoute.js";

export function isHandoffSchemaBlockReason(reason: string | undefined): boolean {
  return reason !== undefined && reason.includes("Invalid handoff schema");
}

function phaseFromNextSkill(nextSkill: string): RunnablePhase | null {
  const trimmed = nextSkill.startsWith("/") ? nextSkill.slice(1) : nextSkill;
  return parseRunnablePhase(trimmed);
}

function reconciledActive(
  active: ActiveState,
  handoff: Handoff,
): ActiveState | null {
  if (handoff.acceptanceState === "blocked" || handoff.issue !== active.issue) {
    return null;
  }

  if (handoff.acceptanceState === "done") {
    const nextPhase = phaseFromNextSkill(handoff.nextSkill);
    if (nextPhase === null) {
      return null;
    }
    return {
      issue: active.issue,
      branch: active.branch,
      pr: handoff.pr ?? active.pr,
      phase: nextPhase,
      status: "active",
      startedAt: active.startedAt,
    };
  }

  if (handoff.acceptanceState === "in-progress") {
    const phase = parseRunnablePhase(handoff.phase);
    if (phase === null) {
      return null;
    }
    return {
      issue: active.issue,
      branch: active.branch,
      pr: handoff.pr ?? active.pr,
      phase,
      status: "active",
      startedAt: active.startedAt,
    };
  }

  return null;
}

/**
 * When a slice is blocked only because handoff JSON used a synonym (e.g. `complete`),
 * re-read the worktree handoff with current schema normalization and resume.
 */
export async function tryReconcileSchemaBlockedHandoff(input: {
  projectPath: string;
  branch: string;
  stateRoot: string;
  projectId: string;
  active: ActiveState;
}): Promise<ActiveState | null> {
  if (
    input.active.status !== "blocked" ||
    !isHandoffSchemaBlockReason(input.active.reason)
  ) {
    return null;
  }

  const worktreePath = join(
    input.projectPath,
    ".sandcastle",
    "worktrees",
    input.branch,
  );

  let handoff: Handoff;
  try {
    handoff = await readHandoff(worktreePath);
  } catch {
    return null;
  }

  const next = reconciledActive(input.active, handoff);
  if (next === null) {
    return null;
  }

  await writeHandoff(handoff, worktreePath);
  await writeHostHandoff({
    stateRoot: input.stateRoot,
    projectId: input.projectId,
    handoff,
  });

  return next;
}

/**
 * When review-pr populated `blockers` with findings but routed to `/review-tdd`,
 * unblock the slice on Start so the linear pipeline can continue.
 */
export async function tryReconcileReviewPrBlockedHandoff(input: {
  stateRoot: string;
  projectId: string;
  projectPath: string;
  branch: string;
  active: ActiveState;
}): Promise<ActiveState | null> {
  if (
    input.active.status !== "blocked" ||
    !isReviewPrBlockersStallReason(input.active.reason, input.active.phase)
  ) {
    return null;
  }

  const worktreePath = join(
    input.projectPath,
    ".sandcastle",
    "worktrees",
    input.branch,
  );

  let handoff: Handoff | undefined;
  try {
    handoff = await readHandoff(worktreePath);
  } catch {
    try {
      handoff = await readHostHandoff({
        stateRoot: input.stateRoot,
        projectId: input.projectId,
      });
    } catch {
      return null;
    }
  }

  if (!isReviewPrRequestChangesToReviewTdd(handoff)) {
    return null;
  }

  return {
    issue: input.active.issue,
    branch: input.active.branch,
    pr: handoff.pr ?? input.active.pr,
    phase: "review-tdd",
    status: "active",
    startedAt: input.active.startedAt,
  };
}

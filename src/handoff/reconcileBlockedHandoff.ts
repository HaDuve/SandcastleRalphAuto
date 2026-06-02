import { unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  isMergeGateNoApproveBlockReason,
  normalizeHandoffForMergeGate,
  runMergeGate,
  type GhRunner,
} from "../merge/index.js";
import type { Project } from "../registry/index.js";
import { parseRunnablePhase, type RunnablePhase } from "../prompts/phases.js";
import { resolveActivePath, type ActiveState } from "../state/index.js";
import { readHostHandoff, writeHostHandoff } from "./hostStore.js";
import { readHandoff, writeHandoff } from "./io.js";
import type { Handoff } from "./schema.js";
import {
  isMergeAcceptanceBlockedStallReason,
  isMergeDeferredToBabysit,
} from "./mergeBabysitRoute.js";
import {
  formatReviewFindingsNote,
  isReviewPrBlockersStallReason,
  isReviewPrRequestChangesToReviewTdd,
} from "./reviewPrRoute.js";
import {
  isReviewTddAcceptanceBlockedStallReason,
  isReviewTddProceduralOnlyBlockedHandoff,
  normalizeReviewTddProceduralDoneHandoff,
} from "./reviewTddRoute.js";
import {
  confirmsCreatePrNoDiffAtWorktree,
  isCreatePrNoDiffStallReason,
  normalizeCreatePrNoDiffHandoff,
} from "./createPrNoDiffRoute.js";
import type { GitRunner } from "./worktreeNoDiff.js";
import {
  isTransientCursorErrorMessage,
  isTransientCursorRetriesExhaustedMessage,
} from "../runner/transientCursorError.js";

export function isHandoffSchemaBlockReason(reason: string | undefined): boolean {
  return reason !== undefined && reason.includes("Invalid handoff schema");
}

export function isTransientCursorBlockReason(reason: string | undefined): boolean {
  return (
    reason !== undefined &&
    isTransientCursorErrorMessage(reason) &&
    !isTransientCursorRetriesExhaustedMessage(reason)
  );
}

export function isMissingPhaseCompleteBlockReason(
  reason: string | undefined,
): boolean {
  return (
    reason !== undefined &&
    reason.includes("Phase did not emit PHASE_COMPLETE completion signal")
  );
}

/**
 * When a phase failed only due to transient Cursor `resource_exhausted` after
 * in-run retries, allow dashboard Start to resume the same phase.
 */
export function tryReconcileTransientCursorBlockedHandoff(input: {
  active: ActiveState;
}): ActiveState | null {
  if (
    input.active.status !== "blocked" ||
    !isTransientCursorBlockReason(input.active.reason)
  ) {
    return null;
  }

  const phase = parseRunnablePhase(input.active.phase);
  if (phase === null) {
    return null;
  }

  return {
    issue: input.active.issue,
    branch: input.active.branch,
    pr: input.active.pr,
    phase,
    status: "active",
    startedAt: input.active.startedAt,
  };
}

/**
 * When a phase completed its single iteration without emitting PHASE_COMPLETE,
 * treat the slice as retryable on dashboard Start and re-run the same phase.
 */
export function tryReconcileMissingPhaseCompleteBlockedHandoff(input: {
  active: ActiveState;
}): ActiveState | null {
  if (
    input.active.status !== "blocked" ||
    !isMissingPhaseCompleteBlockReason(input.active.reason)
  ) {
    return null;
  }

  const phase = parseRunnablePhase(input.active.phase);
  if (phase === null) {
    return null;
  }

  return {
    issue: input.active.issue,
    branch: input.active.branch,
    pr: input.active.pr,
    phase,
    status: "active",
    startedAt: input.active.startedAt,
  };
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
 * When review-tdd marked `acceptanceState: blocked` only for procedural merge constraints,
 * normalize and resume at `merge` on Start.
 */
export async function tryReconcileReviewTddProceduralBlockedHandoff(input: {
  stateRoot: string;
  projectId: string;
  projectPath: string;
  branch: string;
  active: ActiveState;
}): Promise<ActiveState | null> {
  if (
    input.active.status !== "blocked" ||
    !isReviewTddAcceptanceBlockedStallReason(
      input.active.reason,
      input.active.phase,
    )
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

  if (!isReviewTddProceduralOnlyBlockedHandoff(handoff)) {
    return null;
  }

  const fixed = normalizeReviewTddProceduralDoneHandoff(handoff);
  await writeHandoff(fixed, worktreePath);
  await writeHostHandoff({
    stateRoot: input.stateRoot,
    projectId: input.projectId,
    handoff: fixed,
  });

  return {
    issue: input.active.issue,
    branch: input.active.branch,
    pr: fixed.pr ?? input.active.pr,
    phase: "merge",
    status: "active",
    startedAt: input.active.startedAt,
  };
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

  const note = formatReviewFindingsNote(handoff.blockers);

  return {
    issue: input.active.issue,
    branch: input.active.branch,
    pr: handoff.pr ?? input.active.pr,
    phase: "review-tdd",
    status: "active",
    startedAt: input.active.startedAt,
    ...(note !== null ? { reason: note } : {}),
  };
}

/**
 * When merge completed with blocked acceptance (conflicts/CI) but the host stalled
 * before `/babysit`, resume the recovery phase on Start (ADR 0006).
 */
export async function tryReconcileMergeDeferredBabysitHandoff(input: {
  stateRoot: string;
  projectId: string;
  projectPath: string;
  branch: string;
  active: ActiveState;
}): Promise<ActiveState | null> {
  if (
    input.active.status !== "blocked" ||
    input.active.phase !== "merge" ||
    !isMergeAcceptanceBlockedStallReason(
      input.active.reason,
      input.active.phase,
    )
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
    try {
      handoff = await readHostHandoff({
        stateRoot: input.stateRoot,
        projectId: input.projectId,
      });
    } catch {
      return null;
    }
  }

  if (!isMergeDeferredToBabysit(handoff)) {
    return null;
  }

  return {
    issue: input.active.issue,
    branch: input.active.branch,
    pr: handoff.pr ?? input.active.pr,
    phase: "babysit",
    status: "active",
    startedAt: input.active.startedAt,
  };
}

export type MergeGateOnlyResume = {
  issue: number;
  pr: number;
};

export type CreatePrNoDiffResume = {
  issue: number;
  branch: string;
};

/**
 * When create-pr wrote blocked for zero commits / no PR, normalize handoff and
 * let the host advance the queue on Start without re-running create-pr.
 */
export async function tryReconcileCreatePrNoDiffBlockedHandoff(input: {
  projectPath: string;
  branch: string;
  stateRoot: string;
  projectId: string;
  active: ActiveState;
  git?: GitRunner;
}): Promise<CreatePrNoDiffResume | null> {
  if (
    input.active.status !== "blocked" ||
    !isCreatePrNoDiffStallReason(input.active.reason, input.active.phase)
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
    try {
      handoff = await readHostHandoff({
        stateRoot: input.stateRoot,
        projectId: input.projectId,
      });
    } catch {
      return null;
    }
  }

  if (!(await confirmsCreatePrNoDiffAtWorktree(handoff, worktreePath, input.git))) {
    return null;
  }

  const fixed = normalizeCreatePrNoDiffHandoff(handoff);
  await writeHandoff(fixed, worktreePath);
  await writeHostHandoff({
    stateRoot: input.stateRoot,
    projectId: input.projectId,
    handoff: fixed,
  });

  try {
    await unlink(resolveActivePath(input.stateRoot, input.projectId));
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }

  return { issue: input.active.issue, branch: input.active.branch };
}

/**
 * When the merge agent already merged on GitHub but the host blocked on
 * `verdict !== approve` (pre–PR #74) or stale `active.json` after the fix,
 * re-run the merge gate on Start and continue with `/next` only.
 */
export async function tryReconcileMergeGateBlockedHandoff(input: {
  project: Pick<Project, "autoMerge" | "remote">;
  stateRoot: string;
  projectId: string;
  active: ActiveState;
  gh: GhRunner;
  readHostHandoffFn?: typeof readHostHandoff;
}): Promise<MergeGateOnlyResume | null> {
  if (
    input.active.status !== "blocked" ||
    input.active.phase !== "merge" ||
    !isMergeGateNoApproveBlockReason(input.active.reason) ||
    input.active.pr === undefined
  ) {
    return null;
  }

  const readHost = input.readHostHandoffFn ?? readHostHandoff;
  let handoff: Handoff;
  try {
    handoff = await readHost({
      stateRoot: input.stateRoot,
      projectId: input.projectId,
    });
  } catch {
    return null;
  }

  const mergeResult = await runMergeGate(
    {
      handoff: normalizeHandoffForMergeGate(handoff),
      project: input.project,
      pr: input.active.pr,
    },
    { gh: input.gh },
  );

  if (mergeResult.status !== "auto-merge-queued") {
    return null;
  }

  try {
    await unlink(resolveActivePath(input.stateRoot, input.projectId));
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }

  return { issue: input.active.issue, pr: input.active.pr };
}

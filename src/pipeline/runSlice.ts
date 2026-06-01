import { unlink } from "node:fs/promises";
import { CANONICAL_PHASES, type CanonicalPhase } from "../prompts/phases.js";
import {
  runPhase,
  type RunPhaseOptions,
  type RunPhaseResult,
} from "../runner/index.js";
import {
  readActive,
  resolveActivePath,
  writeActive,
  type ActiveState,
} from "../state/index.js";
import { advanceSlice, skillForPhase } from "./advance.js";

export type RunLinearSliceOptions = {
  projectId: string;
  issue: number;
  branch: string;
  projectPath: string;
  stateRoot: string;
  /** Resume a slice after `/next` has already run `/tdd`. */
  fromPhase?: CanonicalPhase;
  runPhaseOptions?: Omit<
    RunPhaseOptions,
    "phase" | "branch" | "projectPath"
  >;
};

export type RunLinearSliceSuccess = {
  status: "ready-for-next";
  issue: number;
  branch: string;
  pr?: number;
  phasesCompleted: CanonicalPhase[];
};

export type RunLinearSliceBlocked = {
  status: "blocked";
  active: ActiveState;
  phasesCompleted: CanonicalPhase[];
};

export type RunLinearSliceAwaitingHuman = {
  status: "awaiting-human";
  active: ActiveState;
  phasesCompleted: CanonicalPhase[];
};

export type RunLinearSliceResult =
  | RunLinearSliceSuccess
  | RunLinearSliceBlocked
  | RunLinearSliceAwaitingHuman;

export type RunLinearSliceDeps = {
  runPhase: (
    options: RunPhaseOptions,
  ) => Promise<RunPhaseResult>;
};

const defaultDeps = (): RunLinearSliceDeps => ({
  runPhase,
});

async function clearActive(
  projectId: string,
  stateRoot: string,
): Promise<void> {
  try {
    await unlink(resolveActivePath(stateRoot, projectId));
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
}

export async function runLinearSlice(
  options: RunLinearSliceOptions,
  deps: RunLinearSliceDeps = defaultDeps(),
): Promise<RunLinearSliceResult> {
  const { projectId, issue, branch, projectPath, stateRoot, fromPhase } =
    options;
  const phasesCompleted: CanonicalPhase[] = [];
  let pr: number | undefined;

  const existing = await readActive(projectId, stateRoot);
  if (existing?.status === "blocked") {
    return { status: "blocked", active: existing, phasesCompleted };
  }
  if (existing?.status === "awaiting-human") {
    return { status: "awaiting-human", active: existing, phasesCompleted };
  }

  const phaseStartIndex =
    fromPhase === undefined
      ? 0
      : CANONICAL_PHASES.indexOf(fromPhase);
  if (fromPhase !== undefined && phaseStartIndex === -1) {
    throw new Error(`Unknown fromPhase: ${fromPhase}`);
  }

  for (const phase of CANONICAL_PHASES.slice(phaseStartIndex)) {
    const activeBeforeRun: ActiveState = {
      issue,
      phase,
      branch,
      pr,
      status: "active",
    };
    await writeActive(projectId, activeBeforeRun, stateRoot);

    let result: RunPhaseResult;
    try {
      result = await deps.runPhase({
        phase,
        branch,
        projectPath,
        ...options.runPhaseOptions,
      });
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Phase run failed";
      const blocked: ActiveState = {
        issue,
        phase,
        branch,
        pr,
        status: "blocked",
        reason,
        resumeSkill: skillForPhase(phase),
      };
      await writeActive(projectId, blocked, stateRoot);
      return { status: "blocked", active: blocked, phasesCompleted };
    }

    const outcome = advanceSlice({
      issue,
      branch,
      pr,
      phase,
      result,
    });

    if (!outcome.ok) {
      await writeActive(projectId, outcome.active, stateRoot);
      return {
        status: "blocked",
        active: outcome.active,
        phasesCompleted,
      };
    }

    phasesCompleted.push(phase);
    pr = outcome.active.pr;

    if (outcome.handoffToNext) {
      await clearActive(projectId, stateRoot);
      return {
        status: "ready-for-next",
        issue,
        branch,
        pr,
        phasesCompleted,
      };
    }

    await writeActive(projectId, outcome.active, stateRoot);
  }

  await clearActive(projectId, stateRoot);
  return {
    status: "ready-for-next",
    issue,
    branch,
    pr,
    phasesCompleted,
  };
}

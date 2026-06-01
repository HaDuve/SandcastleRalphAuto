import { unlink } from "node:fs/promises";
import {
  CANONICAL_PHASES,
  isRecoveryPhase,
  type CanonicalPhase,
  type RunnablePhase,
} from "../prompts/phases.js";
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
import { tryReconcileSchemaBlockedHandoff } from "../handoff/index.js";
import { advanceSlice, skillForPhase } from "./advance.js";

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export type RunLinearSliceOptions = {
  projectId: string;
  issue: number;
  branch: string;
  projectPath: string;
  stateRoot: string;
  /** Resume a slice after `/next` has already run `/tdd`, or mid-recovery `/babysit`. */
  fromPhase?: RunnablePhase;
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

/** Babysit (or other recovery) finished — host should re-run the merge gate. */
export type RunLinearSliceRecoveryComplete = {
  status: "recovery-complete";
  issue: number;
  branch: string;
  pr?: number;
};

export type RunLinearSliceResult =
  | RunLinearSliceSuccess
  | RunLinearSliceBlocked
  | RunLinearSliceAwaitingHuman
  | RunLinearSliceRecoveryComplete;

export type SliceReadyForMerge = Extract<
  RunLinearSliceResult,
  { status: "ready-for-next" }
>;

export function toSliceReadyForMerge(
  slice: RunLinearSliceResult,
): SliceReadyForMerge | null {
  if (slice.status === "recovery-complete") {
    return {
      status: "ready-for-next",
      issue: slice.issue,
      branch: slice.branch,
      pr: slice.pr,
      phasesCompleted: [],
    };
  }
  if (slice.status === "ready-for-next") {
    return slice;
  }
  return null;
}

export type RunLinearSliceDeps = {
  runPhase: (
    options: RunPhaseOptions,
  ) => Promise<RunPhaseResult>;
};

const defaultDeps = (): RunLinearSliceDeps => ({
  runPhase,
});

type RunRecoverySliceInput = {
  projectId: string;
  issue: number;
  branch: string;
  projectPath: string;
  stateRoot: string;
  phase: Extract<RunnablePhase, "babysit">;
  pr?: number;
  sliceStartedAt: string;
  runPhaseOptions?: RunLinearSliceOptions["runPhaseOptions"];
  deps: RunLinearSliceDeps;
};

async function runRecoverySlice(
  input: RunRecoverySliceInput,
): Promise<RunLinearSliceResult> {
  const {
    projectId,
    issue,
    branch,
    projectPath,
    stateRoot,
    phase,
    sliceStartedAt,
    runPhaseOptions,
    deps,
  } = input;
  let pr = input.pr;

  const activeBeforeRun: ActiveState = {
    issue,
    phase,
    branch,
    pr,
    status: "active",
    startedAt: sliceStartedAt,
  };
  await writeActive(projectId, activeBeforeRun, stateRoot);

  let result: RunPhaseResult;
  try {
    result = await deps.runPhase({
      phase,
      branch,
      projectPath,
      projectId,
      stateRoot,
      ...runPhaseOptions,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    const reason = error instanceof Error ? error.message : "Phase run failed";
    const blocked: ActiveState = {
      issue,
      phase,
      branch,
      pr,
      status: "blocked",
      reason,
      resumeSkill: skillForPhase(phase),
      startedAt: sliceStartedAt,
    };
    await writeActive(projectId, blocked, stateRoot);
    return { status: "blocked", active: blocked, phasesCompleted: [] };
  }

  const outcome = advanceSlice({
    issue,
    branch,
    pr,
    phase,
    result,
  });

  if (!outcome.ok) {
    await writeActive(
      projectId,
      { ...outcome.active, startedAt: sliceStartedAt },
      stateRoot,
    );
    return {
      status: "blocked",
      active: outcome.active,
      phasesCompleted: [],
    };
  }

  pr = outcome.active.pr;
  await writeActive(
    projectId,
    { ...outcome.active, startedAt: sliceStartedAt },
    stateRoot,
  );

  return {
    status: "recovery-complete",
    issue,
    branch,
    pr,
  };
}

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
    const reconciled = await tryReconcileSchemaBlockedHandoff({
      projectPath,
      branch,
      stateRoot,
      projectId,
      active: existing,
    });
    if (reconciled === null) {
      return { status: "blocked", active: existing, phasesCompleted };
    }
    await writeActive(projectId, reconciled, stateRoot);
  } else if (existing?.status === "awaiting-human") {
    return { status: "awaiting-human", active: existing, phasesCompleted };
  }

  if (fromPhase !== undefined && isRecoveryPhase(fromPhase)) {
    return runRecoverySlice({
      projectId,
      issue,
      branch,
      projectPath,
      stateRoot,
      phase: fromPhase,
      pr: existing?.pr,
      sliceStartedAt:
        existing?.issue === issue && existing.startedAt
          ? existing.startedAt
          : new Date().toISOString(),
      runPhaseOptions: options.runPhaseOptions,
      deps,
    });
  }

  const phaseStartIndex =
    fromPhase === undefined
      ? 0
      : CANONICAL_PHASES.indexOf(fromPhase);
  if (fromPhase !== undefined && phaseStartIndex === -1) {
    throw new Error(`Unknown fromPhase: ${fromPhase}`);
  }

  const sliceStartedAt =
    existing?.issue === issue && existing.startedAt
      ? existing.startedAt
      : new Date().toISOString();

  for (const phase of CANONICAL_PHASES.slice(phaseStartIndex)) {
    const activeBeforeRun: ActiveState = {
      issue,
      phase,
      branch,
      pr,
      status: "active",
      startedAt: sliceStartedAt,
    };
    await writeActive(projectId, activeBeforeRun, stateRoot);

    let result: RunPhaseResult;
    try {
      result = await deps.runPhase({
        phase,
        branch,
        projectPath,
        projectId,
        stateRoot,
        ...options.runPhaseOptions,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
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
        startedAt: sliceStartedAt,
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
      await writeActive(
        projectId,
        { ...outcome.active, startedAt: sliceStartedAt },
        stateRoot,
      );
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

    await writeActive(
      projectId,
      { ...outcome.active, startedAt: sliceStartedAt },
      stateRoot,
    );
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

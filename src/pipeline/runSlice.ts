import { appendFile, mkdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { join } from "node:path";
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
  DEFAULT_CURSOR_TRANSIENT_JITTER_RATIO,
  jitterDelayMs,
  transientCursorBackoffDelayMs,
} from "../runner/transientCursorError.js";
import {
  readActive,
  resolveActivePath,
  writeActive,
  type ActiveState,
} from "../state/index.js";
import {
  confirmsCreatePrNoDiffAtWorktree,
  isMergeDeferredToBabysit,
  normalizeCreatePrNoDiffHandoff,
  tryReconcileCreatePrNoDiffBlockedHandoff,
  tryReconcileMissingPhaseCompleteBlockedHandoff,
  tryReconcileReviewPrBlockedHandoff,
  tryReconcileReviewTddProceduralBlockedHandoff,
  tryReconcileSchemaBlockedHandoff,
  tryReconcileTransientCursorBlockedHandoff,
  isReviewTddProceduralOnlyBlockedHandoff,
  normalizeReviewTddProceduralDoneHandoff,
  writeHandoff,
  writeHostHandoff,
} from "../handoff/index.js";
import type { Project } from "../registry/index.js";
import {
  peekBabysitableMergeGateBlock,
  type GhRunner,
} from "../merge/index.js";
import type { GitRunner } from "../handoff/worktreeNoDiff.js";
import { PHASE_COMPLETE_SIGNAL } from "../runner/index.js";
import { advanceSlice, skillForPhase } from "./advance.js";
import { phasesCompletedThroughCreatePr } from "./phasesCompleted.js";
import { resolvePhaseLogPath } from "../phaseLogs/index.js";

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryablePhaseOutputError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message;
  return (
    message.includes("Invalid handoff schema:") ||
    message.includes("Invalid JSON in handoff:") ||
    message.includes("Handoff not found:") ||
    message.includes("Cannot read handoff:")
  );
}

async function appendPhaseRetryLog(
  logFilePath: string | undefined,
  message: string,
): Promise<void> {
  if (!logFilePath) {
    return;
  }
  await mkdir(dirname(logFilePath), { recursive: true });
  await appendFile(logFilePath, `${message.trimEnd()}\n`);
}

async function runPhaseWithCompletionRetry(
  deps: RunLinearSliceDeps,
  options: RunPhaseOptions,
  input: {
    /** Total attempts to get a PHASE_COMPLETE signal (1 = no retry). */
    maxAttempts: number;
    /** Base delay for exponential backoff between attempts. */
    baseDelayMs: number;
    /** Cap per retry wait (ms). */
    maxDelayMs: number;
    /** Jitter ratio applied to backoff delays (0.2 = ±20%). */
    jitterRatio: number;
    /** Total elapsed time cap for all attempts (ms). */
    maxElapsedMs: number;
  },
): Promise<RunPhaseResult> {
  const startedAtMs = Date.now();
  let last: RunPhaseResult | null = null;
  for (let attempt = 1; attempt <= input.maxAttempts; attempt++) {
    const elapsedMs = Date.now() - startedAtMs;
    if (elapsedMs >= input.maxElapsedMs) {
      break;
    }
    let result: RunPhaseResult;
    try {
      result = await deps.runPhase(options);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (!isRetryablePhaseOutputError(error) || attempt >= input.maxAttempts) {
        throw error;
      }
      const logPath = resolvePhaseLogPath({
        projectPath: options.projectPath,
        branch: options.branch,
        phase: options.phase,
      });
      const backoffMs = transientCursorBackoffDelayMs(
        attempt + 1,
        input.baseDelayMs,
        input.maxDelayMs,
      );
      const delayMs = jitterDelayMs(backoffMs, input.jitterRatio);
      await appendPhaseRetryLog(
        logPath,
        `\n--- Transient phase output error (attempt ${attempt}/${input.maxAttempts}): ${(error as Error).message.trim()} — retrying in ${delayMs}ms ---`,
      );
      await sleep(delayMs);
      continue;
    }
    last = result;
    if (result.completionSignal === PHASE_COMPLETE_SIGNAL) {
      return result;
    }
    if (attempt < input.maxAttempts) {
      const backoffMs = transientCursorBackoffDelayMs(
        // `transientCursorBackoffDelayMs` returns 0 for attempt<=1; shift by 1
        // so attempt 1 → baseDelayMs.
        attempt + 1,
        input.baseDelayMs,
        input.maxDelayMs,
      );
      const delayMs = jitterDelayMs(backoffMs, input.jitterRatio);
      await appendPhaseRetryLog(
        result.logFilePath,
        `\n--- Missing PHASE_COMPLETE (attempt ${attempt}/${input.maxAttempts}) — retrying in ${delayMs}ms ---`,
      );
      await sleep(delayMs);
    }
  }
  // If we get here, we exhausted retries; return last result so advanceSlice can
  // mark the phase blocked with the canonical "missing completion signal" reason.
  return last ?? (await deps.runPhase(options));
}

async function persistReviewTddProceduralHandoffIfNeeded(
  phase: RunnablePhase,
  result: RunPhaseResult,
  projectPath: string,
  stateRoot: string,
  projectId: string,
): Promise<RunPhaseResult> {
  if (phase !== "review-tdd" || !isReviewTddProceduralOnlyBlockedHandoff(result.handoff)) {
    return result;
  }
  const worktreePath = join(
    projectPath,
    ".sandcastle",
    "worktrees",
    result.branch,
  );
  const handoff = normalizeReviewTddProceduralDoneHandoff(result.handoff);
  await writeHandoff(handoff, worktreePath);
  await writeHostHandoff({ stateRoot, projectId, handoff });
  return { ...result, handoff };
}

async function persistCreatePrNoDiffHandoffIfNeeded(
  phase: RunnablePhase,
  result: RunPhaseResult,
  projectPath: string,
  stateRoot: string,
  projectId: string,
  git?: GitRunner,
): Promise<RunPhaseResult> {
  if (phase !== "create-pr") {
    return result;
  }
  const worktreePath = join(
    projectPath,
    ".sandcastle",
    "worktrees",
    result.branch,
  );
  if (!(await confirmsCreatePrNoDiffAtWorktree(result.handoff, worktreePath, git))) {
    return result;
  }
  const handoff = normalizeCreatePrNoDiffHandoff(result.handoff);
  await writeHandoff(handoff, worktreePath);
  await writeHostHandoff({ stateRoot, projectId, handoff });
  return { ...result, handoff };
}

export type RunLinearSliceOptions = {
  projectId: string;
  issue: number;
  branch: string;
  projectPath: string;
  stateRoot: string;
  /** Resume a slice after `/next` has already run `/tdd`, or mid-recovery `/babysit`. */
  fromPhase?: RunnablePhase;
  /** Injected for tests; verifies no-diff before normalizing create-pr handoffs. */
  git?: GitRunner;
  runPhaseOptions?: Omit<
    RunPhaseOptions,
    "phase" | "branch" | "projectPath"
  >;
  /** Total attempts to recover missing PHASE_COMPLETE before blocking. */
  completionSignalMaxAttempts?: number;
  /** Separate cap for `/tdd` completion-signal attempts (defaults smaller). */
  tddCompletionSignalMaxAttempts?: number;
  /** Base delay for exponential backoff between completion-signal attempts. */
  completionSignalBaseDelayMs?: number;
  /** Cap per completion-signal retry wait (ms). */
  completionSignalMaxDelayMs?: number;
  /** Jitter ratio applied to completion-signal retry delays. */
  completionSignalJitterRatio?: number;
  /** Total elapsed time cap for completion-signal retries per phase (ms). */
  completionSignalMaxElapsedMs?: number;
  /**
   * When set, after a successful `review-tdd` the host may run `/babysit` once
   * before the `merge` phase if required CI is still red (ADR 0009).
   */
  preMergeBabysit?: {
    project: Pick<Project, "autoMerge" | "remote">;
    gh: GhRunner;
  };
};

export type RunLinearSliceSuccess = {
  status: "ready-for-next";
  issue: number;
  branch: string;
  pr?: number;
  phasesCompleted: CanonicalPhase[];
  /** True when `/babysit` already ran after merge-agent defer (ADR 0006 cap). */
  mergeTailBabysitAttempted?: boolean;
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
  mergeTailBabysitAttempted?: boolean;
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
      mergeTailBabysitAttempted: slice.mergeTailBabysitAttempted,
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
  mergeTailBabysitAttempted?: boolean;
  runPhaseOptions?: RunLinearSliceOptions["runPhaseOptions"];
  git?: GitRunner;
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
    result = await runPhaseWithCompletionRetry(
      deps,
      {
        phase,
        branch,
        projectPath,
        projectId,
        stateRoot,
        ...runPhaseOptions,
      },
      {
        // Babysit already loops internally (maxIterations), so completion should be reliable.
        // Still give it one small retry in case the agent flakes out before emitting PHASE_COMPLETE.
        maxAttempts: 2,
        baseDelayMs: 1_000,
        maxDelayMs: 10_000,
        jitterRatio: DEFAULT_CURSOR_TRANSIENT_JITTER_RATIO,
        maxElapsedMs: 60_000,
      },
    );
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

  const phaseResult = await persistCreatePrNoDiffHandoffIfNeeded(
    phase,
    result,
    projectPath,
    stateRoot,
    projectId,
    input.git,
  );

  const outcome = advanceSlice({
    issue,
    branch,
    pr,
    phase,
    result: phaseResult,
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
    mergeTailBabysitAttempted: input.mergeTailBabysitAttempted,
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
  const { projectId, issue, branch, projectPath, stateRoot } = options;
  let fromPhase = options.fromPhase;
  const phasesCompleted: CanonicalPhase[] = [];
  let pr: number | undefined;

  const existing = await readActive(projectId, stateRoot);
  if (existing?.status === "blocked") {
    const createPrNoDiff = await tryReconcileCreatePrNoDiffBlockedHandoff({
      projectPath,
      branch,
      stateRoot,
      projectId,
      active: existing,
      git: options.git,
    });
    if (createPrNoDiff !== null) {
      return {
        status: "ready-for-next",
        issue: createPrNoDiff.issue,
        branch: createPrNoDiff.branch,
        pr: undefined,
        phasesCompleted: phasesCompletedThroughCreatePr(
          options.fromPhase !== undefined &&
            !isRecoveryPhase(options.fromPhase)
            ? options.fromPhase
            : undefined,
        ),
      };
    }

    const reconciled =
      (await tryReconcileSchemaBlockedHandoff({
        projectPath,
        branch,
        stateRoot,
        projectId,
        active: existing,
      })) ??
      (await tryReconcileReviewPrBlockedHandoff({
        projectPath,
        branch,
        stateRoot,
        projectId,
        active: existing,
      })) ??
      (await tryReconcileReviewTddProceduralBlockedHandoff({
        projectPath,
        branch,
        stateRoot,
        projectId,
        active: existing,
      })) ??
      tryReconcileMissingPhaseCompleteBlockedHandoff({ active: existing }) ??
      tryReconcileTransientCursorBlockedHandoff({ active: existing });
    if (reconciled === null) {
      return { status: "blocked", active: existing, phasesCompleted };
    }
    await writeActive(projectId, reconciled, stateRoot);
    if (fromPhase === undefined) {
      fromPhase = reconciled.phase;
    }
  } else if (existing?.status === "awaiting-human") {
    return { status: "awaiting-human", active: existing, phasesCompleted };
  } else if (existing?.status === "active" && fromPhase === undefined) {
    // If the UI presses Start while a slice is active, resume from its current phase.
    fromPhase = existing.phase;
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
      git: options.git,
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

  let mergeTailBabysitAttempted = false;

  const completionSignalBaseDelayMs = options.completionSignalBaseDelayMs ?? 1_000;
  const completionSignalMaxDelayMs = options.completionSignalMaxDelayMs ?? 30_000;
  const completionSignalJitterRatio =
    options.completionSignalJitterRatio ?? DEFAULT_CURSOR_TRANSIENT_JITTER_RATIO;
  const completionSignalMaxElapsedMs = options.completionSignalMaxElapsedMs ?? 15 * 60_000;
  const completionSignalMaxAttempts = options.completionSignalMaxAttempts ?? 5;
  const tddCompletionSignalMaxAttempts = options.tddCompletionSignalMaxAttempts ?? 3;

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
      const completionRetryMaxAttempts =
        phase === "tdd"
          ? tddCompletionSignalMaxAttempts
          : completionSignalMaxAttempts;
      result = await runPhaseWithCompletionRetry(
        deps,
        {
          phase,
          branch,
          projectPath,
          projectId,
          stateRoot,
          ...options.runPhaseOptions,
        },
        {
          // `tdd` is the only canonical phase that is intentionally multi-iteration.
          // Other phases default to maxIterations=1, so a missing completion signal
          // is often just a transient agent flake; retry once before blocking.
          maxAttempts: completionRetryMaxAttempts,
          baseDelayMs: completionSignalBaseDelayMs,
          maxDelayMs: completionSignalMaxDelayMs,
          jitterRatio: completionSignalJitterRatio,
          maxElapsedMs: completionSignalMaxElapsedMs,
        },
      );
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

    const phaseResult = await persistCreatePrNoDiffHandoffIfNeeded(
      phase,
      result,
      projectPath,
      stateRoot,
      projectId,
      options.git,
    );
    const phaseResultAfterReviewTdd = await persistReviewTddProceduralHandoffIfNeeded(
      phase,
      phaseResult,
      projectPath,
      stateRoot,
      projectId,
    );

    const outcome = advanceSlice({
      issue,
      branch,
      pr,
      phase,
      result: phaseResultAfterReviewTdd,
    });

    if (
      !outcome.ok &&
      phase === "merge" &&
      phaseResultAfterReviewTdd.completionSignal === PHASE_COMPLETE_SIGNAL &&
      isMergeDeferredToBabysit(phaseResultAfterReviewTdd.handoff)
    ) {
      if (mergeTailBabysitAttempted) {
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
      mergeTailBabysitAttempted = true;

      const recovery = await runRecoverySlice({
        projectId,
        issue,
        branch,
        projectPath,
        stateRoot,
        phase: "babysit",
        pr,
        sliceStartedAt,
        mergeTailBabysitAttempted: true,
        runPhaseOptions: options.runPhaseOptions,
        git: options.git,
        deps,
      });

      if (
        recovery.status === "blocked" ||
        recovery.status === "awaiting-human"
      ) {
        return { ...recovery, phasesCompleted };
      }

      pr = recovery.pr;

      let mergeRetryResult: RunPhaseResult;
      try {
        mergeRetryResult = await runPhaseWithCompletionRetry(
          deps,
          {
            phase: "merge",
            branch,
            projectPath,
            projectId,
            stateRoot,
            ...options.runPhaseOptions,
          },
          {
            maxAttempts: completionSignalMaxAttempts,
            baseDelayMs: completionSignalBaseDelayMs,
            maxDelayMs: completionSignalMaxDelayMs,
            jitterRatio: completionSignalJitterRatio,
            maxElapsedMs: completionSignalMaxElapsedMs,
          },
        );
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        const reason =
          error instanceof Error ? error.message : "Phase run failed";
        const blocked: ActiveState = {
          issue,
          phase: "merge",
          branch,
          pr,
          status: "blocked",
          reason,
          resumeSkill: skillForPhase("merge"),
          startedAt: sliceStartedAt,
        };
        await writeActive(projectId, blocked, stateRoot);
        return { status: "blocked", active: blocked, phasesCompleted };
      }

      const mergeRetryOutcome = advanceSlice({
        issue,
        branch,
        pr,
        phase: "merge",
        result: mergeRetryResult,
      });

      if (!mergeRetryOutcome.ok) {
        await writeActive(
          projectId,
          { ...mergeRetryOutcome.active, startedAt: sliceStartedAt },
          stateRoot,
        );
        return {
          status: "blocked",
          active: mergeRetryOutcome.active,
          phasesCompleted,
        };
      }

      phasesCompleted.push("merge");
      pr = mergeRetryOutcome.active.pr;

      if (mergeRetryOutcome.handoffToNext) {
        await clearActive(projectId, stateRoot);
        return {
          status: "ready-for-next",
          issue,
          branch,
          pr,
          phasesCompleted,
          mergeTailBabysitAttempted: true,
        };
      }

      await writeActive(
        projectId,
        { ...mergeRetryOutcome.active, startedAt: sliceStartedAt },
        stateRoot,
      );
      continue;
    }

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

    if (
      phase === "review-tdd" &&
      outcome.active.phase === "merge" &&
      pr !== undefined &&
      !mergeTailBabysitAttempted &&
      options.preMergeBabysit
    ) {
      const babysitBlock = await peekBabysitableMergeGateBlock(
        {
          handoff: phaseResultAfterReviewTdd.handoff,
          project: options.preMergeBabysit.project,
          pr,
        },
        { gh: options.preMergeBabysit.gh },
      );
      if (babysitBlock !== null) {
        mergeTailBabysitAttempted = true;
        const recovery = await runRecoverySlice({
          projectId,
          issue,
          branch,
          projectPath,
          stateRoot,
          phase: "babysit",
          pr,
          sliceStartedAt,
          mergeTailBabysitAttempted: true,
          runPhaseOptions: options.runPhaseOptions,
          git: options.git,
          deps,
        });
        if (
          recovery.status === "blocked" ||
          recovery.status === "awaiting-human"
        ) {
          return { ...recovery, phasesCompleted };
        }
        pr = recovery.pr;
      }
    }

    if (outcome.handoffToNext) {
      await clearActive(projectId, stateRoot);
      return {
        status: "ready-for-next",
        issue,
        branch,
        pr,
        phasesCompleted,
        ...(mergeTailBabysitAttempted
          ? { mergeTailBabysitAttempted: true }
          : {}),
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

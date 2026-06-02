import { join } from "node:path";
import {
  HandoffError,
  isCreatePrNoDiffBlockedHandoff,
  isCreatePrNoDiffDoneHandoff,
  normalizeCreatePrNoDiffHandoff,
  readHostHandoff,
  tryReconcileCreatePrNoDiffBlockedHandoff,
  tryReconcileMergeDeferredBabysitHandoff,
  tryReconcileMergeGateBlockedHandoff,
  tryReconcileMissingPhaseCompleteBlockedHandoff,
  tryReconcileReviewPrBlockedHandoff,
  tryReconcileSchemaBlockedHandoff,
  tryReconcileTransientCursorBlockedHandoff,
  type Handoff,
} from "../handoff/index.js";
import {
  activeStateFromMergeGate,
  classifyMergeTailBlock,
  normalizeHandoffForMergeGate,
  runMergeGate,
  type GhRunner,
  type RunMergeGateResult,
} from "../merge/index.js";
import {
  branchForIssue,
  QUEUE_EMPTY,
  runNext,
  seedTddHandoff,
  type RunNextInput,
  type RunNextResult,
} from "../next/index.js";
import { buildRunNextLoopDeps } from "./runNextLoopDeps.js";
import { defaultGitRunner, type GitRunner } from "../handoff/worktreeNoDiff.js";
import { selectNextIssue, parseGhIssueList, type GhIssue } from "../next/select.js";
import {
  loadRegistryFromRoot,
  type Project,
} from "../registry/index.js";
import {
  CANONICAL_PHASES,
  isRunnablePhase,
  type RunnablePhase,
} from "../prompts/phases.js";
import {
  runLinearSlice,
  toSliceReadyForMerge,
  type RunLinearSliceResult,
} from "../pipeline/index.js";
import {
  resolvePhaseLogPath,
  startTailPhaseLog,
  type TailPhaseLogHandle,
} from "../phaseLogs/index.js";
import {
  runPhase,
  type AgentStreamEvent,
  type RunPhaseOptions,
  type RunPhaseResult,
} from "../runner/index.js";
import { readActive, writeActive, type ActiveState } from "../state/index.js";
import { CliError } from "./errors.js";
import {
  createFileProjectMutex,
  type ProjectMutex,
} from "./mutex.js";

export type WorkerControl = {
  signal: AbortSignal;
  isPaused: () => boolean;
  waitIfPaused: () => Promise<void>;
};

export type RunProjectSliceInput = {
  projectId: string;
  issue: number;
  rootDir?: string;
  stateRoot?: string;
};

export type RunProjectSliceCompleted = {
  status: "completed";
  issue: number;
  pr?: number;
};

export type RunProjectSliceBlocked = {
  status: "blocked" | "awaiting-human";
  issue: number;
  reason: string;
};

export type RunProjectSliceResult =
  | RunProjectSliceCompleted
  | RunProjectSliceBlocked;

export type LoopProjectInput = {
  projectId: string;
  issue?: number;
  rootDir?: string;
  stateRoot?: string;
};

export type LoopProjectResult =
  | { status: "queue-empty"; slicesCompleted: number }
  | { status: "blocked" | "awaiting-human"; reason: string };

export type BootstrapFirstIssueResult =
  | { status: "started"; issue: number; branch: string }
  | { status: typeof QUEUE_EMPTY }
  | { status: "blocked"; reason: string };

export type AgentStreamEnvelope = {
  issue: number;
  phase: RunnablePhase;
  event: AgentStreamEvent;
};

export type RunProjectDeps = {
  loadRegistry?: (
    rootDir: string,
  ) => Promise<Project[]>;
  runLinearSlice?: typeof runLinearSlice;
  runPhase?: (options: RunPhaseOptions) => Promise<RunPhaseResult>;
  runMergeGate?: typeof runMergeGate;
  runNext?: typeof runNext;
  gh?: GhRunner;
  /** Injected for tests; used when reconciling create-pr no-diff handoffs. */
  git?: GitRunner;
  cleanupAfterMerge?: (input: {
    projectPath: string;
    branch: string;
  }) => Promise<void>;
  waitForMergedPr?: (input: {
    project: Project;
    pr: number;
  }) => Promise<void>;
  readLogFile?: (path: string) => Promise<string>;
  onPhaseLog?: (chunk: string) => void;
  /** When true, phase-log is forwarded live (e.g. dashboard stream); skip file tail. */
  livePhaseLog?: boolean;
  tailPhaseLogPollIntervalMs?: number;
  onAgentStream?: (envelope: AgentStreamEnvelope) => void;
  mutex?: ProjectMutex;
  readActive?: (projectId: string, stateRoot: string) => Promise<ActiveState | null>;
  readHostHandoff?: typeof readHostHandoff;
  bootstrapFirstIssue?: (
    input: {
      project: Project;
      projectPath: string;
      stateRoot: string;
    },
    gh: GhRunner,
  ) => Promise<BootstrapFirstIssueResult>;
  control?: WorkerControl;
};

async function cleanupLocalGitAfterMerge(
  input: { projectPath: string; branch: string },
  git: GitRunner = defaultGitRunner,
): Promise<void> {
  const worktreePath = join(
    input.projectPath,
    ".sandcastle",
    "worktrees",
    input.branch,
  );

  const errors: string[] = [];
  const safeGit = async (args: string[]): Promise<{ exitCode: number }> => {
    try {
      return await git(args, input.projectPath);
    } catch (error: unknown) {
      errors.push(
        `git ${args.join(" ")} threw: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { exitCode: 1 };
    }
  };

  const removeWorktree = await safeGit([
    "worktree",
    "remove",
    "--force",
    worktreePath,
  ]);
  if (removeWorktree.exitCode !== 0) {
    errors.push(
      `git worktree remove --force "${worktreePath}" (exit ${removeWorktree.exitCode})`,
    );
  }

  const deleteBranch = await safeGit(["branch", "-D", input.branch]);
  if (deleteBranch.exitCode !== 0) {
    errors.push(`git branch -D "${input.branch}" (exit ${deleteBranch.exitCode})`);
  }

  if (errors.length > 0) {
    console.warn(
      `[sandcastle] cleanup after merge for "${input.branch}" failed (best-effort): ${errors.join(
        "; ",
      )}`,
    );
  }
}

function resolvePaths(input: { rootDir?: string; stateRoot?: string }): {
  rootDir: string;
  stateRoot: string;
} {
  const rootDir = input.rootDir ?? process.cwd();
  return {
    rootDir,
    stateRoot: input.stateRoot ?? join(rootDir, "state"),
  };
}

export function findProjectById(
  projects: Project[],
  projectId: string,
): Project {
  const project = projects.find((entry) => entry.id === projectId);
  if (!project) {
    throw new CliError(`Unknown project: ${projectId}`);
  }
  return project;
}

function parseIssueList(raw: string): GhIssue[] | null {
  return parseGhIssueList(raw);
}

export async function bootstrapFirstIssue(
  input: {
    project: Project;
    projectPath: string;
    stateRoot: string;
  },
  gh: GhRunner,
  deps: {
    readSkips?: (projectId: string, stateRoot: string) => Promise<number[]>;
    writeActive?: typeof writeActive;
    startTdd?: (startInput: {
      project: Project;
      issue: number;
      branch: string;
      projectPath: string;
      stateRoot: string;
      handoff: Handoff;
    }) => Promise<void>;
    now?: () => Date;
  } = {},
): Promise<BootstrapFirstIssueResult> {
  const { project, projectPath, stateRoot } = input;
  const now = deps.now ?? (() => new Date());
  const readSkipsFn =
    deps.readSkips ??
    (async (projectId, skipsRoot) => {
      const { readSkips } = await import("../state/index.js");
      return readSkips(projectId, skipsRoot);
    });
  const writeActiveFn = deps.writeActive ?? writeActive;
  const startTddFn =
    deps.startTdd ??
    (async (startInput) => {
      const { startTddViaRunPhase } = await import("../next/index.js");
      await startTddViaRunPhase(startInput);
    });

  const issuesRaw = await gh([
    "issue",
    "list",
    "--repo",
    project.remote,
    "--state",
    "open",
    "--label",
    project.afkLabel,
    "--json",
    "number,labels,state",
  ]);
  const issues = parseIssueList(issuesRaw);
  if (!issues) {
    return { status: "blocked", reason: "Could not parse issues from gh" };
  }

  const skips = await readSkipsFn(project.remote, stateRoot);
  const nextIssue = selectNextIssue(issues, project, skips);
  if (nextIssue === null) {
    return { status: QUEUE_EMPTY };
  }

  const branch = branchForIssue(nextIssue);
  const handoff = seedTddHandoff(project, nextIssue, branch, now());

  await writeActiveFn(
    project.remote,
    {
      issue: nextIssue,
      phase: "tdd",
      branch,
      status: "active",
      startedAt: handoff.startedAt,
    },
    stateRoot,
  );
  await startTddFn({
    project,
    issue: nextIssue,
    branch,
    projectPath,
    stateRoot,
    handoff,
  });

  return { status: "started", issue: nextIssue, branch };
}

type ResolvedRunProjectDeps = Required<
  Pick<
    RunProjectDeps,
    | "loadRegistry"
    | "runLinearSlice"
    | "runPhase"
    | "runMergeGate"
    | "runNext"
    | "waitForMergedPr"
    | "readLogFile"
    | "mutex"
    | "gh"
  >
>;

function defaultDeps(stateRoot: string): ResolvedRunProjectDeps {
  const gh: GhRunner = async (args) => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync("gh", args);
    return stdout;
  };

  return {
    loadRegistry: (rootDir) => loadRegistryFromRoot(rootDir),
    runLinearSlice,
    runPhase,
    runMergeGate,
    runNext,
    gh,
    waitForMergedPr: async ({ project, pr }) => {
      for (;;) {
        const raw = await gh([
          "pr",
          "view",
          String(pr),
          "--repo",
          project.remote,
          "--json",
          "state",
        ]);
        const parsed = JSON.parse(raw) as { state?: string };
        if (parsed.state === "MERGED") {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    },
    readLogFile: async (path) => {
      const { readFile } = await import("node:fs/promises");
      return readFile(path, "utf8");
    },
    mutex: createFileProjectMutex(stateRoot),
  };
}

function startPhaseLogTail(
  options: RunPhaseOptions,
  deps: RunProjectDeps,
): TailPhaseLogHandle | undefined {
  if (!deps.onPhaseLog || !deps.readLogFile) {
    return undefined;
  }
  // Live dashboard runs forward text via phase-log during the phase.
  if (deps.livePhaseLog) {
    return undefined;
  }
  const logPath = resolvePhaseLogPath({
    projectPath: options.projectPath,
    branch: options.branch,
    phase: options.phase,
  });
  return startTailPhaseLog({
    logPath,
    onChunk: deps.onPhaseLog,
    readTextFile: deps.readLogFile,
    signal: options.signal ?? deps.control?.signal,
    pollIntervalMs: deps.tailPhaseLogPollIntervalMs,
  });
}

function createSliceRunner(
  deps: RunProjectDeps,
  issue: number,
): {
  runPhase: (options: RunPhaseOptions) => Promise<RunPhaseResult>;
  getReviewHandoff: () => Handoff | undefined;
} {
  let reviewHandoff: Handoff | undefined;
  let approvedVerdictHandoff: Handoff | undefined;
  const runPhaseFn = deps.runPhase ?? runPhase;

  return {
    async runPhase(options) {
      const tailHandle = startPhaseLogTail(options, deps);
      try {
        const result = await runPhaseFn({
          ...options,
          signal: options.signal ?? deps.control?.signal,
          // Dashboard streaming replaces any caller-provided callback.
          onAgentStreamEvent: deps.onAgentStream
            ? (event) => {
                deps.onAgentStream!({ issue, phase: options.phase, event });
              }
            : options.onAgentStreamEvent,
        });
        if (options.phase === "review-pr") {
          reviewHandoff = result.handoff;
        }
        if (result.handoff.verdict === "approve") {
          approvedVerdictHandoff = result.handoff;
        }
        return result;
      } finally {
        await tailHandle?.stop();
      }
    },
    getReviewHandoff: () => approvedVerdictHandoff ?? reviewHandoff,
  };
}

export async function resolveHandoffForMergeGate(
  project: Project,
  stateRoot: string,
  reviewHandoff: Handoff | undefined,
  readHostHandoffFn: typeof readHostHandoff = readHostHandoff,
): Promise<Handoff | undefined> {
  let hostHandoff: Handoff | undefined;
  try {
    hostHandoff = await readHostHandoffFn({
      stateRoot,
      projectId: project.remote,
    });
  } catch (error) {
    if (
      error instanceof HandoffError &&
      error.message.startsWith("Handoff not found:")
    ) {
      hostHandoff = undefined;
    } else {
      throw error;
    }
  }

  let resolved: Handoff | undefined;
  if (hostHandoff !== undefined && hostHandoff.phase !== "review-pr") {
    resolved = hostHandoff;
  } else if (reviewHandoff !== undefined) {
    resolved = reviewHandoff;
  } else {
    resolved = hostHandoff;
  }

  if (resolved === undefined) {
    return undefined;
  }

  return normalizeHandoffForMergeGate(resolved, reviewHandoff);
}

type ApplyMergeGateResult =
  | { source: "merge-gate"; result: RunMergeGateResult }
  | {
      source: "recovery-slice";
      result: Extract<
        RunLinearSliceResult,
        { status: "blocked" | "awaiting-human" }
      >;
    };

type ApplyMergeGateContext = {
  project: Project;
  slice: Extract<RunLinearSliceResult, { status: "ready-for-next" }>;
  reviewHandoff: Handoff | undefined;
  stateRoot: string;
  deps: RunProjectDeps;
  gh: GhRunner;
  runLinearSliceFn: typeof runLinearSlice;
  sliceRunner: ReturnType<typeof createSliceRunner>;
  babysitAttempted: boolean;
};

async function applyMergeGate(
  ctx: ApplyMergeGateContext,
): Promise<ApplyMergeGateResult> {
  const { project, slice, stateRoot, deps, gh } = ctx;
  const gateHandoff = await resolveHandoffForMergeGate(
    project,
    stateRoot,
    ctx.reviewHandoff,
    deps.readHostHandoff,
  );

  if (!gateHandoff || slice.pr === undefined) {
    const reason = "Missing review handoff or PR for merge gate";
    await writeActive(
      project.remote,
      {
        issue: slice.issue,
        phase: "merge",
        branch: slice.branch,
        pr: slice.pr,
        status: "blocked",
        reason,
        resumeSkill: "/merge",
      },
      stateRoot,
    );
    return {
      source: "merge-gate",
      result: {
        status: "blocked",
        kind: "missing-merge-prerequisites",
        reason,
        resumeSkill: "/merge",
      },
    };
  }

  const mergeResult = await (deps.runMergeGate ?? runMergeGate)(
    {
      handoff: gateHandoff,
      project,
      pr: slice.pr,
    },
    { gh },
  );

  const active = activeStateFromMergeGate(
    {
      issue: slice.issue,
      branch: slice.branch,
      pr: slice.pr,
    },
    mergeResult,
  );

  const shouldAttemptBabysit =
    mergeResult.status === "blocked" &&
    !ctx.babysitAttempted &&
    classifyMergeTailBlock(mergeResult, gateHandoff) === "babysit-able";

  if (active && !shouldAttemptBabysit) {
    await writeActive(project.remote, active, stateRoot);
  }

  if (shouldAttemptBabysit) {
    const recovery = await ctx.runLinearSliceFn(
      {
        projectId: project.remote,
        issue: slice.issue,
        branch: slice.branch,
        projectPath: project.path,
        stateRoot,
        fromPhase: "babysit",
      },
      { runPhase: ctx.sliceRunner.runPhase },
    );

    if (
      recovery.status === "blocked" ||
      recovery.status === "awaiting-human"
    ) {
      return { source: "recovery-slice", result: recovery };
    }

    const refreshedHandoff = await resolveHandoffForMergeGate(
      project,
      stateRoot,
      ctx.sliceRunner.getReviewHandoff(),
      deps.readHostHandoff,
    );

    return applyMergeGate({
      ...ctx,
      reviewHandoff: refreshedHandoff,
      babysitAttempted: true,
    });
  }

  return { source: "merge-gate", result: mergeResult };
}

function sliceBlockedResult(
  slice: Extract<
    RunLinearSliceResult,
    { status: "blocked" | "awaiting-human" }
  >,
): RunProjectSliceBlocked {
  return {
    status: slice.status,
    issue: slice.active.issue,
    reason: slice.active.reason ?? slice.status,
  };
}

export async function runProjectSlice(
  input: RunProjectSliceInput,
  deps: RunProjectDeps = {},
): Promise<RunProjectSliceResult> {
  const { rootDir, stateRoot } = resolvePaths(input);
  const resolved = defaultDeps(stateRoot);
  const loadRegistry = deps.loadRegistry ?? resolved.loadRegistry;
  const runLinearSliceFn = deps.runLinearSlice ?? resolved.runLinearSlice;
  const mutex = deps.mutex ?? resolved.mutex;
  const waitForMergedPr = deps.waitForMergedPr ?? resolved.waitForMergedPr;

  const project = findProjectById(await loadRegistry(rootDir), input.projectId);
  await mutex.acquire(project.remote);

  try {
    const sliceRunner = createSliceRunner(deps, input.issue);
    const slice = await runLinearSliceFn(
      {
        projectId: project.remote,
        issue: input.issue,
        branch: branchForIssue(input.issue),
        projectPath: project.path,
        stateRoot,
      },
      { runPhase: sliceRunner.runPhase },
    );

    if (slice.status === "blocked" || slice.status === "awaiting-human") {
      return sliceBlockedResult(slice);
    }

    const sliceForMerge = toSliceReadyForMerge(slice);
    if (sliceForMerge === null) {
      throw new Error(`Unexpected slice status: ${slice.status}`);
    }

    if (sliceForMerge.pr === undefined) {
      let hostHandoff: Handoff | undefined;
      try {
        hostHandoff = await (deps.readHostHandoff ?? readHostHandoff)({
          stateRoot,
          projectId: project.remote,
        });
      } catch (error) {
        if (!(error instanceof HandoffError)) {
          throw error;
        }
      }
      if (
        hostHandoff !== undefined &&
        isCreatePrNoDiffDoneHandoff(hostHandoff)
      ) {
        await mutex.release(project.remote);
        return {
          status: "completed",
          issue: sliceForMerge.issue,
        };
      }
      return {
        status: "blocked",
        issue: sliceForMerge.issue,
        reason: "Slice completed without a PR number",
      };
    }

    const mergeHandoff = await resolveHandoffForMergeGate(
      project,
      stateRoot,
      sliceRunner.getReviewHandoff(),
      deps.readHostHandoff,
    );

    const mergeOutcome = await applyMergeGate({
      project,
      slice: sliceForMerge,
      reviewHandoff: mergeHandoff,
      stateRoot,
      deps,
      gh: deps.gh ?? resolved.gh,
      runLinearSliceFn,
      sliceRunner,
      babysitAttempted: sliceForMerge.mergeTailBabysitAttempted ?? false,
    });

    if (mergeOutcome.source === "recovery-slice") {
      return sliceBlockedResult(mergeOutcome.result);
    }

    const mergeResult = mergeOutcome.result;
    if (mergeResult.status === "blocked") {
      return {
        status: "blocked",
        issue: slice.issue,
        reason: mergeResult.reason,
      };
    }
    if (mergeResult.status === "awaiting-human") {
      return {
        status: "awaiting-human",
        issue: slice.issue,
        reason: mergeResult.reason,
      };
    }

    await waitForMergedPr({ project, pr: sliceForMerge.pr });
    await (deps.cleanupAfterMerge ?? cleanupLocalGitAfterMerge)({
      projectPath: project.path,
      branch: sliceForMerge.branch,
    });
    await mutex.release(project.remote);
    return {
      status: "completed",
      issue: sliceForMerge.issue,
      pr: sliceForMerge.pr,
    };
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    throw error;
  }
}

function mergeBlocked(
  mergeResult: Extract<
    RunMergeGateResult,
    { status: "blocked" | "awaiting-human" }
  >,
): LoopProjectResult {
  return {
    status: mergeResult.status,
    reason: mergeResult.reason,
  };
}

function nextBlocked(
  nextResult: Extract<RunNextResult, { status: "blocked" }>,
): LoopProjectResult {
  return {
    status: "blocked",
    reason: nextResult.reason,
  };
}

async function invokeRunNext(
  project: Project,
  stateRoot: string,
  runNextFn: typeof runNext,
  gh: GhRunner,
  input: Pick<RunNextInput, "pr" | "emptySliceIssue">,
): Promise<RunNextResult> {
  return runNextFn(
    {
      project,
      projectPath: project.path,
      stateRoot,
      ...input,
    },
    buildRunNextLoopDeps({ project, stateRoot, gh }),
  );
}

type LoopStartReady = {
  kind: "ready";
  issue: number;
  fromPhase?: RunPhaseOptions["phase"];
  /** Host merge gate + `/next` only — slice already merged on GitHub. */
  mergeGateOnly?: { pr: number };
  /** create-pr had no diff; advance queue without merge gate. */
  createPrNoDiffReady?: { issue: number; branch: string };
};

type LoopStart = LoopStartReady | LoopProjectResult;

function isLoopStartReady(start: LoopStart): start is LoopStartReady {
  return "kind" in start && start.kind === "ready";
}

async function resolveLoopStart(
  project: Project,
  projectPath: string,
  stateRoot: string,
  issue: number | undefined,
  deps: RunProjectDeps,
  resolved: ResolvedRunProjectDeps,
): Promise<LoopStart> {
  const readActiveFn = deps.readActive ?? readActive;
  const active = await readActiveFn(project.remote, stateRoot);
  if (active?.status === "blocked") {
    if (issue !== undefined && active.issue !== issue) {
      return {
        status: "blocked",
        reason: active.reason ?? "Slice is blocked",
      };
    }
    const createPrNoDiff = await tryReconcileCreatePrNoDiffBlockedHandoff({
      projectPath,
      branch: branchForIssue(active.issue),
      stateRoot,
      projectId: project.remote,
      active,
      git: deps.git,
    });
    if (createPrNoDiff !== null) {
      return {
        kind: "ready",
        issue: createPrNoDiff.issue,
        createPrNoDiffReady: createPrNoDiff,
      };
    }

    const reconciled =
      (await tryReconcileSchemaBlockedHandoff({
        projectPath,
        branch: branchForIssue(active.issue),
        stateRoot,
        projectId: project.remote,
        active,
      })) ??
      (await tryReconcileReviewPrBlockedHandoff({
        projectPath,
        branch: branchForIssue(active.issue),
        stateRoot,
        projectId: project.remote,
        active,
      })) ??
      tryReconcileMissingPhaseCompleteBlockedHandoff({ active }) ??
      tryReconcileTransientCursorBlockedHandoff({ active });
    if (reconciled !== null) {
      await writeActive(project.remote, reconciled, stateRoot);
      if (!isRunnablePhase(reconciled.phase)) {
        return {
          status: "blocked",
          reason: `Cannot resume unknown phase: ${reconciled.phase}`,
        };
      }
      return {
        kind: "ready",
        issue: reconciled.issue,
        fromPhase: reconciled.phase,
      };
    }

    const mergeBabysit = await tryReconcileMergeDeferredBabysitHandoff({
      projectPath,
      branch: branchForIssue(active.issue),
      stateRoot,
      projectId: project.remote,
      active,
    });
    if (mergeBabysit !== null) {
      await writeActive(project.remote, mergeBabysit, stateRoot);
      return {
        kind: "ready",
        issue: mergeBabysit.issue,
        fromPhase: "babysit",
      };
    }

    const mergeGateOnly = await tryReconcileMergeGateBlockedHandoff({
      project,
      stateRoot,
      projectId: project.remote,
      active,
      gh: deps.gh ?? resolved.gh,
    });
    if (mergeGateOnly !== null) {
      return {
        kind: "ready",
        issue: mergeGateOnly.issue,
        mergeGateOnly: { pr: mergeGateOnly.pr },
      };
    }

    return {
      status: "blocked",
      reason: active.reason ?? "Slice is blocked",
    };
  }

  if (issue !== undefined) {
    if (
      active?.status === "active" &&
      active.issue === issue &&
      isRunnablePhase(active.phase)
    ) {
      return {
        kind: "ready",
        issue,
        fromPhase: active.phase,
      };
    }
    return { kind: "ready", issue };
  }

  if (active?.status === "awaiting-human") {
    return {
      status: "awaiting-human",
      reason: active.reason ?? "Slice is awaiting human",
    };
  }
  if (active?.status === "active") {
    if (!isRunnablePhase(active.phase)) {
      return {
        status: "blocked",
        reason: `Cannot resume unknown phase: ${active.phase}`,
      };
    }
    return {
      kind: "ready",
      issue: active.issue,
      fromPhase: active.phase,
    };
  }

  const bootstrapFn =
    deps.bootstrapFirstIssue ??
    ((input, gh) => bootstrapFirstIssue(input, gh));
  const bootstrap = await bootstrapFn(
    { project, projectPath, stateRoot },
    deps.gh ?? resolved.gh,
  );
  if (bootstrap.status === QUEUE_EMPTY) {
    return { status: "queue-empty", slicesCompleted: 0 };
  }
  if (bootstrap.status === "blocked") {
    return { status: "blocked", reason: bootstrap.reason };
  }

  return {
    kind: "ready",
    issue: bootstrap.issue,
    fromPhase: "create-pr",
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function loopProject(
  input: LoopProjectInput,
  deps: RunProjectDeps = {},
): Promise<LoopProjectResult> {
  const { rootDir, stateRoot } = resolvePaths(input);
  const resolved = defaultDeps(stateRoot);
  const loadRegistry = deps.loadRegistry ?? resolved.loadRegistry;
  const mutex = deps.mutex ?? resolved.mutex;
  const waitForMergedPr = deps.waitForMergedPr ?? resolved.waitForMergedPr;
  const runNextFn = deps.runNext ?? resolved.runNext;

  const project = findProjectById(await loadRegistry(rootDir), input.projectId);
  await mutex.acquire(project.remote);
  let released = false;
  const releaseOnce = async (): Promise<void> => {
    if (released) {
      return;
    }
    released = true;
    await mutex.release(project.remote);
  };

  try {
    const loopStart = await resolveLoopStart(
      project,
      project.path,
      stateRoot,
      input.issue,
      deps,
      resolved,
    );
    if (!isLoopStartReady(loopStart)) {
      if (loopStart.status === "queue-empty") {
        await releaseOnce();
      }
      return loopStart;
    }

    let slicesCompleted = 0;
    let currentIssue = loopStart.issue;
    let fromPhase = loopStart.fromPhase;
    let mergeGateOnly = isLoopStartReady(loopStart)
      ? loopStart.mergeGateOnly
      : undefined;
    let createPrNoDiffReady = isLoopStartReady(loopStart)
      ? loopStart.createPrNoDiffReady
      : undefined;

    for (;;) {
      if (deps.control) {
        await deps.control.waitIfPaused();
        if (deps.control.signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
      }

      if (createPrNoDiffReady !== undefined) {
        const emptySliceIssue = createPrNoDiffReady.issue;
        createPrNoDiffReady = undefined;
        slicesCompleted += 1;
        const nextResult = await invokeRunNext(
          project,
          stateRoot,
          runNextFn,
          deps.gh ?? resolved.gh,
          { emptySliceIssue },
        );
        if (nextResult.status === "blocked") {
          return nextBlocked(nextResult);
        }
        if (nextResult.status === QUEUE_EMPTY) {
          await releaseOnce();
          return { status: "queue-empty", slicesCompleted };
        }
        currentIssue = nextResult.issue;
        fromPhase = "create-pr";
        continue;
      }

      const sliceRunner = createSliceRunner(deps, currentIssue);
      const runLinearSliceFn = deps.runLinearSlice ?? resolved.runLinearSlice;
      const slice =
        mergeGateOnly !== undefined
          ? {
              status: "ready-for-next" as const,
              issue: currentIssue,
              branch: branchForIssue(currentIssue),
              pr: mergeGateOnly.pr,
              phasesCompleted: [...CANONICAL_PHASES],
            }
          : await runLinearSliceFn(
              {
                projectId: project.remote,
                issue: currentIssue,
                branch: branchForIssue(currentIssue),
                projectPath: project.path,
                stateRoot,
                fromPhase,
                git: deps.git,
              },
              { runPhase: sliceRunner.runPhase },
            );
      mergeGateOnly = undefined;

      if (slice.status === "blocked" || slice.status === "awaiting-human") {
        return {
          status: slice.status,
          reason: slice.active.reason ?? slice.status,
        };
      }

      const sliceForMerge = toSliceReadyForMerge(slice);
      if (sliceForMerge === null) {
        throw new Error(`Unexpected slice status: ${slice.status}`);
      }

      if (slice.status === "ready-for-next") {
        slicesCompleted += 1;
      }

      if (sliceForMerge.pr === undefined) {
        let hostHandoff: Handoff | undefined;
        try {
          hostHandoff = await (deps.readHostHandoff ?? readHostHandoff)({
            stateRoot,
            projectId: project.remote,
          });
        } catch (error) {
          if (!(error instanceof HandoffError)) {
            throw error;
          }
        }
        if (
          hostHandoff !== undefined &&
          isCreatePrNoDiffDoneHandoff(hostHandoff)
        ) {
          const nextResult = await invokeRunNext(
            project,
            stateRoot,
            runNextFn,
            deps.gh ?? resolved.gh,
            { emptySliceIssue: hostHandoff.issue },
          );
          if (nextResult.status === "blocked") {
            return nextBlocked(nextResult);
          }
          if (nextResult.status === QUEUE_EMPTY) {
            await releaseOnce();
            return { status: "queue-empty", slicesCompleted };
          }
          currentIssue = nextResult.issue;
          fromPhase = "create-pr";
          continue;
        }
        if (
          hostHandoff !== undefined &&
          isCreatePrNoDiffBlockedHandoff(hostHandoff)
        ) {
          // Defensive: if create-pr no-diff normalization didn't persist,
          // still treat this as an empty slice and move the queue forward.
          const fixed = normalizeCreatePrNoDiffHandoff(hostHandoff);
          const nextResult = await invokeRunNext(
            project,
            stateRoot,
            runNextFn,
            deps.gh ?? resolved.gh,
            { emptySliceIssue: fixed.issue },
          );
          if (nextResult.status === "blocked") {
            return nextBlocked(nextResult);
          }
          if (nextResult.status === QUEUE_EMPTY) {
            await releaseOnce();
            return { status: "queue-empty", slicesCompleted };
          }
          currentIssue = nextResult.issue;
          fromPhase = "create-pr";
          continue;
        }
        return {
          status: "blocked",
          reason: "Slice completed without a PR number",
        };
      }

      const mergeHandoff = await resolveHandoffForMergeGate(
        project,
        stateRoot,
        sliceRunner.getReviewHandoff(),
        deps.readHostHandoff,
      );

      const mergeOutcome = await applyMergeGate({
        project,
        slice: sliceForMerge,
        reviewHandoff: mergeHandoff,
        stateRoot,
        deps,
        gh: deps.gh ?? resolved.gh,
        runLinearSliceFn,
        sliceRunner,
        babysitAttempted: sliceForMerge.mergeTailBabysitAttempted ?? false,
      });

      if (mergeOutcome.source === "recovery-slice") {
        return {
          status: mergeOutcome.result.status,
          reason:
            mergeOutcome.result.active.reason ?? mergeOutcome.result.status,
        };
      }

      const mergeResult = mergeOutcome.result;
      if (mergeResult.status === "blocked") {
        return mergeBlocked(mergeResult);
      }
      if (mergeResult.status === "awaiting-human") {
        return mergeBlocked(mergeResult);
      }

      await waitForMergedPr({ project, pr: sliceForMerge.pr });
      await (deps.cleanupAfterMerge ?? cleanupLocalGitAfterMerge)({
        projectPath: project.path,
        branch: sliceForMerge.branch,
      });

      const nextResult = await invokeRunNext(
        project,
        stateRoot,
        runNextFn,
        deps.gh ?? resolved.gh,
        { pr: sliceForMerge.pr },
      );

      if (nextResult.status === "blocked") {
        return nextBlocked(nextResult);
      }
      if (nextResult.status === QUEUE_EMPTY) {
        await releaseOnce();
        return { status: "queue-empty", slicesCompleted };
      }

      currentIssue = nextResult.issue;
      fromPhase = "create-pr";
    }
  } catch (error) {
    if (isAbortError(error)) {
      await releaseOnce();
    }
    throw error;
  } finally {
    await releaseOnce();
  }
}

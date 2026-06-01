import { join } from "node:path";
import {
  HandoffError,
  readHostHandoff,
  type Handoff,
} from "../handoff/index.js";
import {
  activeStateFromMergeGate,
  runMergeGate,
  type GhRunner,
  type RunMergeGateResult,
} from "../merge/index.js";
import {
  branchForIssue,
  QUEUE_EMPTY,
  runNext,
  seedTddHandoff,
  type RunNextResult,
} from "../next/index.js";
import { selectNextIssue, parseGhIssueList, type GhIssue } from "../next/select.js";
import {
  loadRegistryFromRoot,
  type Project,
} from "../registry/index.js";
import { isRunnablePhase, type RunnablePhase } from "../prompts/phases.js";
import {
  runLinearSlice,
  toSliceReadyForMerge,
  type RunLinearSliceResult,
} from "../pipeline/index.js";
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
  waitForMergedPr?: (input: {
    project: Project;
    pr: number;
  }) => Promise<void>;
  readLogFile?: (path: string) => Promise<string>;
  onPhaseLog?: (chunk: string) => void;
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

async function streamPhaseLog(
  logFilePath: string | undefined,
  deps: RunProjectDeps,
): Promise<void> {
  if (!logFilePath || !deps.onPhaseLog || !deps.readLogFile) {
    return;
  }
  deps.onPhaseLog(await deps.readLogFile(logFilePath));
}

function createSliceRunner(
  deps: RunProjectDeps,
  issue: number,
): {
  runPhase: (options: RunPhaseOptions) => Promise<RunPhaseResult>;
  getReviewHandoff: () => Handoff | undefined;
} {
  let reviewHandoff: Handoff | undefined;
  const runPhaseFn = deps.runPhase ?? runPhase;

  return {
    async runPhase(options) {
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
      await streamPhaseLog(result.logFilePath, deps);
      return result;
    },
    getReviewHandoff: () => reviewHandoff,
  };
}

export async function resolveHandoffForMergeGate(
  project: Project,
  stateRoot: string,
  reviewHandoff: Handoff | undefined,
  readHostHandoffFn: typeof readHostHandoff = readHostHandoff,
): Promise<Handoff | undefined> {
  if (reviewHandoff !== undefined) {
    return reviewHandoff;
  }
  try {
    return await readHostHandoffFn({
      stateRoot,
      projectId: project.remote,
    });
  } catch (error) {
    if (
      error instanceof HandoffError &&
      error.message.startsWith("Handoff not found:")
    ) {
      return undefined;
    }
    throw error;
  }
}

async function applyMergeGate(
  project: Project,
  slice: Extract<RunLinearSliceResult, { status: "ready-for-next" }>,
  reviewHandoff: Handoff | undefined,
  stateRoot: string,
  deps: RunProjectDeps,
  gh: GhRunner,
): Promise<RunMergeGateResult> {
  if (!reviewHandoff || slice.pr === undefined) {
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
      status: "blocked",
      kind: "missing-merge-prerequisites",
      reason,
      resumeSkill: "/merge",
    };
  }

  const mergeResult = await (deps.runMergeGate ?? runMergeGate)(
    {
      handoff: reviewHandoff,
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
  if (active) {
    await writeActive(project.remote, active, stateRoot);
  }

  return mergeResult;
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

    const mergeHandoff = await resolveHandoffForMergeGate(
      project,
      stateRoot,
      sliceRunner.getReviewHandoff(),
      deps.readHostHandoff,
    );

    const mergeResult = await applyMergeGate(
      project,
      sliceForMerge,
      mergeHandoff,
      stateRoot,
      deps,
      deps.gh ?? resolved.gh,
    );

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
    if (sliceForMerge.pr === undefined) {
      return {
        status: "blocked",
        issue: sliceForMerge.issue,
        reason: "Slice completed without a PR number",
      };
    }

    await waitForMergedPr({ project, pr: sliceForMerge.pr });
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

type LoopStartReady = {
  kind: "ready";
  issue: number;
  fromPhase?: RunPhaseOptions["phase"];
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
  if (issue !== undefined) {
    return { kind: "ready", issue };
  }

  const readActiveFn = deps.readActive ?? readActive;
  const active = await readActiveFn(project.remote, stateRoot);
  if (active?.status === "blocked") {
    return {
      status: "blocked",
      reason: active.reason ?? "Slice is blocked",
    };
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
      await mutex.release(project.remote);
    }
    return loopStart;
  }

  let slicesCompleted = 0;
  let currentIssue = loopStart.issue;
  let fromPhase = loopStart.fromPhase;

  try {
    for (;;) {
      if (deps.control) {
        await deps.control.waitIfPaused();
        if (deps.control.signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
      }

      const sliceRunner = createSliceRunner(deps, currentIssue);
      const runLinearSliceFn = deps.runLinearSlice ?? resolved.runLinearSlice;
      const slice = await runLinearSliceFn(
        {
          projectId: project.remote,
          issue: currentIssue,
          branch: branchForIssue(currentIssue),
          projectPath: project.path,
          stateRoot,
          fromPhase,
        },
        { runPhase: sliceRunner.runPhase },
      );

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

      const mergeHandoff = await resolveHandoffForMergeGate(
        project,
        stateRoot,
        sliceRunner.getReviewHandoff(),
        deps.readHostHandoff,
      );

      const mergeResult = await applyMergeGate(
        project,
        sliceForMerge,
        mergeHandoff,
        stateRoot,
        deps,
        deps.gh ?? resolved.gh,
      );

      if (mergeResult.status === "blocked") {
        return mergeBlocked(mergeResult);
      }
      if (mergeResult.status === "awaiting-human") {
        return mergeBlocked(mergeResult);
      }
      if (sliceForMerge.pr === undefined) {
        return {
          status: "blocked",
          reason: "Slice completed without a PR number",
        };
      }

      await waitForMergedPr({ project, pr: sliceForMerge.pr });

      const nextResult = await runNextFn(
        {
          project,
          projectPath: project.path,
          stateRoot,
          pr: sliceForMerge.pr,
        },
        {
          gh: deps.gh ?? resolved.gh,
          readSkips: async (projectId, skipsRoot) => {
            const { readSkips } = await import("../state/index.js");
            return readSkips(projectId, skipsRoot);
          },
          archiveHandoff: async (projectId) => {
            const { archiveHostHandoff } = await import("../handoff/index.js");
            return archiveHostHandoff({ stateRoot, projectId });
          },
          writeActive,
          startTdd: async (startInput) => {
            const { startTddViaRunPhase } = await import("../next/index.js");
            await startTddViaRunPhase(startInput);
          },
        },
      );

      if (nextResult.status === "blocked") {
        return nextBlocked(nextResult);
      }
      if (nextResult.status === QUEUE_EMPTY) {
        await mutex.release(project.remote);
        return { status: "queue-empty", slicesCompleted };
      }

      currentIssue = nextResult.issue;
      fromPhase = "create-pr";
    }
  } catch (error) {
    if (isAbortError(error)) {
      await mutex.release(project.remote);
    }
    throw error;
  }
}

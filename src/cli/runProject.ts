import { join } from "node:path";
import { type Handoff } from "../handoff/index.js";
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
  type RunNextResult,
} from "../next/index.js";
import {
  loadRegistryFromRoot,
  type Project,
} from "../registry/index.js";
import {
  runLinearSlice,
  type RunLinearSliceResult,
} from "../pipeline/index.js";
import {
  runPhase,
  type RunPhaseOptions,
  type RunPhaseResult,
} from "../runner/index.js";
import { writeActive } from "../state/index.js";
import { CliError } from "./errors.js";
import {
  createFileProjectMutex,
  type ProjectMutex,
} from "./mutex.js";

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
  issue: number;
  rootDir?: string;
  stateRoot?: string;
};

export type LoopProjectResult =
  | { status: "queue-empty"; slicesCompleted: number }
  | { status: "blocked" | "awaiting-human"; reason: string }
  | { status: "completed"; slicesCompleted: number };

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
  mutex?: ProjectMutex;
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
): {
  runPhase: (options: RunPhaseOptions) => Promise<RunPhaseResult>;
  getReviewHandoff: () => Handoff | undefined;
} {
  let reviewHandoff: Handoff | undefined;
  const runPhaseFn = deps.runPhase ?? runPhase;

  return {
    async runPhase(options) {
      const result = await runPhaseFn(options);
      if (options.phase === "review-pr") {
        reviewHandoff = result.handoff;
      }
      await streamPhaseLog(result.logFilePath, deps);
      return result;
    },
    getReviewHandoff: () => reviewHandoff,
  };
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
    return { status: "blocked", reason, resumeSkill: "/merge" };
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

  const project = findProjectById(await loadRegistry(rootDir), input.projectId);
  await mutex.acquire(project.remote);

  try {
    const sliceRunner = createSliceRunner(deps);
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

    const mergeResult = await applyMergeGate(
      project,
      slice,
      sliceRunner.getReviewHandoff(),
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

    await mutex.release(project.remote);
    return {
      status: "completed",
      issue: slice.issue,
      pr: slice.pr,
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

  let slicesCompleted = 0;
  let currentIssue = input.issue;
  let fromPhase: RunPhaseOptions["phase"] | undefined;

  try {
    for (;;) {
      const sliceRunner = createSliceRunner(deps);
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

      slicesCompleted += 1;

      const mergeResult = await applyMergeGate(
        project,
        slice,
        sliceRunner.getReviewHandoff(),
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
      if (slice.pr === undefined) {
        return {
          status: "blocked",
          reason: "Slice completed without a PR number",
        };
      }

      await waitForMergedPr({ project, pr: slice.pr });

      const nextResult = await runNextFn(
        {
          project,
          projectPath: project.path,
          stateRoot,
          pr: slice.pr,
        },
        {
          gh: deps.gh ?? resolved.gh,
          readSkips: async (projectId, skipsRoot) => {
            const { readSkips } = await import("../state/index.js");
            return readSkips(projectId, skipsRoot);
          },
          archiveHandoff: async (handoffRoot) => {
            const { archiveHandoff } = await import("../handoff/index.js");
            return archiveHandoff(handoffRoot);
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
    if (error instanceof CliError) {
      throw error;
    }
    throw error;
  }
}

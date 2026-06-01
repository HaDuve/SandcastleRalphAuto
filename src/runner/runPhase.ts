import {
  createSandbox,
  cursor,
  type AgentStreamEvent,
  type CreateSandboxOptions,
  type Sandbox,
  type SandboxRunOptions,
  type SandboxRunResult,
} from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readHostHandoff,
  writeHostHandoff,
  readHandoff,
  writeHandoff,
  type Handoff,
  HandoffError,
} from "../handoff/index.js";
import { resolvePhaseLogPath } from "../phaseLogs/index.js";
import { type RunnablePhase } from "../prompts/phases.js";

export const PHASE_COMPLETE_SIGNAL = "<promise>PHASE_COMPLETE</promise>";

/** Default Ralph loop cap for `/tdd` until registry config exists (PRD §4). */
export const DEFAULT_TDD_MAX_ITERATIONS = 10;

/** Default loop cap for `/babysit` CI/comment recovery (ADR 0006). */
export const DEFAULT_BABYSIT_MAX_ITERATIONS = 10;

/**
 * Sandcastle 0.7.0 cursor provider emits `--print --force` via `Sandbox.run()`
 * but not `--trust`. Operator must trust the project once before AFK use.
 */
export const CURSOR_TRUST_SETUP =
  "Run `cursor-agent --trust` in the project directory once before AFK pipeline use.";

export type SandcastleCreateSandboxOptions = CreateSandboxOptions;
export type SandcastleSandboxRunOptions = SandboxRunOptions;
export type SandcastleSandboxRunResult = SandboxRunResult;

export type RunPhaseOptions = {
  phase: RunnablePhase;
  branch: string;
  projectPath: string;
  projectId: string;
  stateRoot: string;
  promptFile?: string;
  orchestratorRoot?: string;
  tddMaxIterations?: number;
  babysitMaxIterations?: number;
  signal?: AbortSignal;
  sandbox?: CreateSandboxOptions["sandbox"];
  name?: string;
  /** Written to `sandbox.worktreePath` before the agent runs (e.g. `/next` tdd seed). */
  seedHandoff?: Handoff;
  /** Live agent stream events (text/toolCall) forwarded from Sandcastle file logging. */
  onAgentStreamEvent?: (event: AgentStreamEvent) => void;
};

export type RunPhaseResult = {
  commits: { sha: string }[];
  branch: string;
  completionSignal?: string;
  logFilePath?: string;
  handoff: Handoff;
};

export type SandcastleSandboxHandle = Pick<
  Sandbox,
  "branch" | "worktreePath" | "run" | "close"
>;

export type RunPhaseDeps = {
  createSandbox: (
    options: SandcastleCreateSandboxOptions,
  ) => Promise<SandcastleSandboxHandle>;
  cursor: typeof cursor;
  noSandbox: typeof noSandbox;
  readHandoff: typeof readHandoff;
};

export function resolveOrchestratorRoot(fromModule = import.meta.url): string {
  return join(fileURLToPath(new URL(".", fromModule)), "../..");
}

function resolvePromptFile(
  phase: RunnablePhase,
  orchestratorRoot: string,
  promptFile?: string,
): string {
  return promptFile ?? join(orchestratorRoot, "prompts", `${phase}.md`);
}

function resolveMaxIterations(
  phase: RunnablePhase,
  tddMaxIterations: number,
  babysitMaxIterations: number,
): number {
  if (phase === "tdd") {
    return tddMaxIterations;
  }
  if (phase === "babysit") {
    return babysitMaxIterations;
  }
  return 1;
}

function resolveLogPath(
  projectPath: string,
  branch: string,
  phase: RunnablePhase,
): string {
  return resolvePhaseLogPath({ projectPath, branch, phase });
}

const defaultDeps = (): RunPhaseDeps => ({
  createSandbox,
  cursor,
  noSandbox,
  readHandoff,
});

export async function runPhase(
  options: RunPhaseOptions,
  deps: RunPhaseDeps = defaultDeps(),
): Promise<RunPhaseResult> {
  const orchestratorRoot =
    options.orchestratorRoot ?? resolveOrchestratorRoot();
  const promptFile = resolvePromptFile(
    options.phase,
    orchestratorRoot,
    options.promptFile,
  );
  const sandboxProvider = options.sandbox ?? deps.noSandbox();

  const sandbox = await deps.createSandbox({
    branch: options.branch,
    cwd: options.projectPath,
    sandbox: sandboxProvider,
  });

  try {
    // Seed the agent-facing worktree handoff from host store, unless explicitly overridden.
    let hostHandoff: Handoff | undefined;
    try {
      hostHandoff = await readHostHandoff({
        stateRoot: options.stateRoot,
        projectId: options.projectId,
      });
    } catch (error) {
      if (!(error instanceof HandoffError)) {
        throw error;
      }
    }
    const seed = options.seedHandoff ?? hostHandoff;
    if (seed !== undefined) {
      await writeHandoff(seed, sandbox.worktreePath);
      await writeHostHandoff({
        stateRoot: options.stateRoot,
        projectId: options.projectId,
        handoff: seed,
      });
    }

    const baseRunOptions = {
      agent: deps.cursor("auto"),
      promptFile,
      maxIterations: resolveMaxIterations(
        options.phase,
        options.tddMaxIterations ?? DEFAULT_TDD_MAX_ITERATIONS,
        options.babysitMaxIterations ?? DEFAULT_BABYSIT_MAX_ITERATIONS,
      ),
      completionSignal: PHASE_COMPLETE_SIGNAL,
      signal: options.signal,
      name: options.name,
    } satisfies SandboxRunOptions;

    const runResult = await sandbox.run(
      options.onAgentStreamEvent
        ? {
            ...baseRunOptions,
            logging: {
              type: "file",
              path: resolveLogPath(
                options.projectPath,
                options.branch,
                options.phase,
              ),
              onAgentStreamEvent: options.onAgentStreamEvent,
            },
          }
        : baseRunOptions,
    );

    // Prefer the handoff written by the phase; if none was written, carry over host-owned handoff.
    let handoff: Handoff;
    try {
      handoff = await deps.readHandoff(sandbox.worktreePath);
    } catch (error) {
      if (
        error instanceof HandoffError &&
        error.message.startsWith("Handoff not found:")
      ) {
        const carried =
          options.seedHandoff ??
          hostHandoff ??
          (await readHostHandoff({
            stateRoot: options.stateRoot,
            projectId: options.projectId,
          }));
        handoff = carried;
      } else {
        throw error;
      }
    }

    await writeHostHandoff({
      stateRoot: options.stateRoot,
      projectId: options.projectId,
      handoff,
    });

    return {
      commits: runResult.commits,
      branch: sandbox.branch,
      completionSignal: runResult.completionSignal,
      logFilePath: runResult.logFilePath,
      handoff,
    };
  } finally {
    await sandbox.close();
  }
}

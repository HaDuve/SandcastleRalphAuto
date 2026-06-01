import {
  createSandbox,
  cursor,
  type CreateSandboxOptions,
  type Sandbox,
  type SandboxRunOptions,
  type SandboxRunResult,
} from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readHandoff, type Handoff } from "../handoff/index.js";
import { type CanonicalPhase } from "../prompts/phases.js";

export const PHASE_COMPLETE_SIGNAL = "<promise>PHASE_COMPLETE</promise>";

/** Default Ralph loop cap for `/tdd` until registry config exists (PRD §4). */
export const DEFAULT_TDD_MAX_ITERATIONS = 10;

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
  phase: CanonicalPhase;
  branch: string;
  projectPath: string;
  promptFile?: string;
  orchestratorRoot?: string;
  tddMaxIterations?: number;
  signal?: AbortSignal;
  sandbox?: CreateSandboxOptions["sandbox"];
  name?: string;
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
  phase: CanonicalPhase,
  orchestratorRoot: string,
  promptFile?: string,
): string {
  return promptFile ?? join(orchestratorRoot, "prompts", `${phase}.md`);
}

function resolveMaxIterations(
  phase: CanonicalPhase,
  tddMaxIterations: number,
): number {
  return phase === "tdd" ? tddMaxIterations : 1;
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
    const runResult = await sandbox.run({
      agent: deps.cursor("auto"),
      promptFile,
      maxIterations: resolveMaxIterations(
        options.phase,
        options.tddMaxIterations ?? DEFAULT_TDD_MAX_ITERATIONS,
      ),
      completionSignal: PHASE_COMPLETE_SIGNAL,
      signal: options.signal,
      name: options.name,
    });

    const handoff = await deps.readHandoff(sandbox.worktreePath);

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

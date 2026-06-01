import { run, cursor, type RunOptions, type RunResult } from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readHandoff, type Handoff } from "../handoff/index.js";
import { type CanonicalPhase } from "../prompts/phases.js";

export const PHASE_COMPLETE_SIGNAL = "<promise>PHASE_COMPLETE</promise>";
export const DEFAULT_TDD_MAX_ITERATIONS = 10;

export type SandcastleRunOptions = RunOptions;
export type SandcastleRunResult = RunResult;

export type RunPhaseOptions = {
  phase: CanonicalPhase;
  branch: string;
  projectPath: string;
  promptFile?: string;
  orchestratorRoot?: string;
  tddMaxIterations?: number;
  signal?: AbortSignal;
  sandbox?: RunOptions["sandbox"];
  name?: string;
};

export type RunPhaseResult = {
  commits: { sha: string }[];
  branch: string;
  completionSignal?: string;
  logFilePath?: string;
  handoff: Handoff;
};

export type RunPhaseDeps = {
  run: (options: SandcastleRunOptions) => Promise<SandcastleRunResult>;
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

function resolveHandoffRoot(
  projectPath: string,
  runResult: SandcastleRunResult,
): string {
  return runResult.preservedWorktreePath ?? projectPath;
}

const defaultDeps = (): RunPhaseDeps => ({
  run,
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
  const sandbox = options.sandbox ?? deps.noSandbox();

  const runResult = await deps.run({
    agent: deps.cursor("auto"),
    sandbox,
    cwd: options.projectPath,
    promptFile,
    branchStrategy: { type: "branch", branch: options.branch },
    maxIterations: resolveMaxIterations(
      options.phase,
      options.tddMaxIterations ?? DEFAULT_TDD_MAX_ITERATIONS,
    ),
    completionSignal: PHASE_COMPLETE_SIGNAL,
    signal: options.signal,
    name: options.name,
  });

  const handoff = await deps.readHandoff(
    resolveHandoffRoot(options.projectPath, runResult),
  );

  return {
    commits: runResult.commits,
    branch: runResult.branch,
    completionSignal: runResult.completionSignal,
    logFilePath: runResult.logFilePath,
    handoff,
  };
}

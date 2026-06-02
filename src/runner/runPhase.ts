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
import { appendFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
import { INLINE_HANDOFF_JSON_PLACEHOLDER } from "../prompts/harness.js";
import {
  DEFAULT_CURSOR_TRANSIENT_BASE_DELAY_MS,
  DEFAULT_CURSOR_TRANSIENT_JITTER_RATIO,
  DEFAULT_CURSOR_TRANSIENT_MAX_ATTEMPTS,
  DEFAULT_CURSOR_TRANSIENT_MAX_DELAY_MS,
  formatTransientCursorExhaustedMessage,
  isTransientCursorError,
  jitterDelayMs,
  sleep,
  transientCursorBackoffDelayMs,
} from "./transientCursorError.js";
import { ensureCursorignoreAllowsHandoff } from "./cursorignore.js";

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
  /** Retries for transient Cursor `resource_exhausted` failures (exponential backoff). */
  cursorTransientMaxAttempts?: number;
  cursorTransientBaseDelayMs?: number;
  cursorTransientMaxDelayMs?: number;
  cursorTransientJitterRatio?: number;
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function runSandboxWithTransientRetry(
  run: () => Promise<SandcastleSandboxRunResult>,
  input: {
    logPath: string;
    signal?: AbortSignal;
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    jitterRatio: number;
  },
): Promise<SandcastleSandboxRunResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= input.maxAttempts; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      lastError = error;
      const canRetry =
        isTransientCursorError(error) && attempt < input.maxAttempts;
      if (!canRetry) {
        if (
          isTransientCursorError(error) &&
          error instanceof Error &&
          attempt >= input.maxAttempts
        ) {
          throw new Error(
            formatTransientCursorExhaustedMessage(
              error.message,
              input.maxAttempts,
            ),
            { cause: error },
          );
        }
        throw error;
      }
      const delayMs = transientCursorBackoffDelayMs(
        attempt + 1,
        input.baseDelayMs,
        input.maxDelayMs,
      );
      const jitteredDelayMs = jitterDelayMs(delayMs, input.jitterRatio);
      const message =
        error instanceof Error ? error.message : "Transient Cursor error";
      await mkdir(dirname(input.logPath), { recursive: true });
      await appendFile(
        input.logPath,
        `\n--- Transient Cursor error (attempt ${attempt}/${input.maxAttempts}): ${message.trim()} — retrying in ${jitteredDelayMs}ms ---\n`,
      );
      await sleep(jitteredDelayMs, input.signal);
    }
  }
  throw lastError;
}

async function writeInlineHandoffPromptFile(input: {
  basePromptFile: string;
  handoff: Handoff;
}): Promise<string> {
  const content = await readFile(input.basePromptFile, "utf8");
  const renderedHandoff = JSON.stringify(input.handoff, null, 2);
  const next = content.replace(INLINE_HANDOFF_JSON_PLACEHOLDER, renderedHandoff);
  const dir = await mkdtemp(join(tmpdir(), "sandcastle-ralph-prompt-"));
  const out = join(dir, "prompt.md");
  await writeFile(out, next, "utf8");
  return out;
}

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
    // Defense-in-depth: ensure Cursor can read the handoff dir in this worktree.
    await ensureCursorignoreAllowsHandoff(sandbox.worktreePath);

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

    const effectivePromptFile =
      seed !== undefined
        ? await writeInlineHandoffPromptFile({
            basePromptFile: promptFile,
            handoff: seed,
          })
        : promptFile;

    const baseRunOptions = {
      agent: deps.cursor("auto"),
      promptFile: effectivePromptFile,
      maxIterations: resolveMaxIterations(
        options.phase,
        options.tddMaxIterations ?? DEFAULT_TDD_MAX_ITERATIONS,
        options.babysitMaxIterations ?? DEFAULT_BABYSIT_MAX_ITERATIONS,
      ),
      completionSignal: PHASE_COMPLETE_SIGNAL,
      signal: options.signal,
      name: options.name,
    } satisfies SandboxRunOptions;

    const logPath = resolveLogPath(
      options.projectPath,
      options.branch,
      options.phase,
    );

    const maxAttempts =
      options.cursorTransientMaxAttempts ?? DEFAULT_CURSOR_TRANSIENT_MAX_ATTEMPTS;
    const baseDelayMs =
      options.cursorTransientBaseDelayMs ?? DEFAULT_CURSOR_TRANSIENT_BASE_DELAY_MS;
    const maxDelayMs =
      options.cursorTransientMaxDelayMs ?? DEFAULT_CURSOR_TRANSIENT_MAX_DELAY_MS;
    const jitterRatio =
      options.cursorTransientJitterRatio ?? DEFAULT_CURSOR_TRANSIENT_JITTER_RATIO;

    const runResult = await runSandboxWithTransientRetry(
      () =>
        sandbox.run({
          ...baseRunOptions,
          logging: {
            type: "file",
            path: logPath,
            ...(options.onAgentStreamEvent
              ? { onAgentStreamEvent: options.onAgentStreamEvent }
              : {}),
          },
        }),
      {
        logPath,
        signal: options.signal,
        maxAttempts,
        baseDelayMs,
        maxDelayMs,
        jitterRatio,
      },
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

import { type LoopProjectResult } from "../cli/index.js";
import { resolvePhaseLogPath } from "../phaseLogs/index.js";
import { type Project } from "../registry/index.js";
import { readActive, writeRunOutcome, type RunOutcome } from "./index.js";

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function workerStopReason(error: unknown): string {
  return error instanceof Error ? error.message : "worker error";
}

function logRefForActive(
  project: Project,
  active: Awaited<ReturnType<typeof readActive>>,
): string | undefined {
  if (!active) {
    return undefined;
  }
  return resolvePhaseLogPath({
    projectPath: project.path,
    branch: active.branch,
    phase: active.phase,
  });
}

export async function runOutcomeFromLoopResult(
  result: LoopProjectResult,
  input: {
    project: Project;
    stateRoot: string;
    stoppedAt: string;
    readActiveFn?: typeof readActive;
  },
): Promise<RunOutcome> {
  const readActiveFn = input.readActiveFn ?? readActive;

  if (result.status === "queue-empty") {
    return {
      outcome: "queue-empty",
      stoppedAt: input.stoppedAt,
    };
  }

  const active = await readActiveFn(input.project.remote, input.stateRoot);
  const logRef = logRefForActive(input.project, active);

  return {
    outcome: result.status,
    reason: result.reason,
    phase: active?.phase,
    stoppedAt: input.stoppedAt,
    ...(logRef !== undefined ? { logRef } : {}),
  };
}

export async function runOutcomeFromWorkerError(
  error: unknown,
  input: {
    project: Project;
    stateRoot: string;
    stoppedAt: string;
    readActiveFn?: typeof readActive;
  },
): Promise<RunOutcome> {
  if (isAbortError(error)) {
    return {
      outcome: "killed",
      stoppedAt: input.stoppedAt,
    };
  }

  const readActiveFn = input.readActiveFn ?? readActive;
  const active = await readActiveFn(input.project.remote, input.stateRoot);
  const logRef = logRefForActive(input.project, active);

  return {
    outcome: "error",
    reason: workerStopReason(error),
    phase: active?.phase,
    stoppedAt: input.stoppedAt,
    ...(logRef !== undefined ? { logRef } : {}),
  };
}

export async function persistRunOutcomeFromLoopResult(
  result: LoopProjectResult,
  input: {
    project: Project;
    stateRoot: string;
    stoppedAt: string;
    readActiveFn?: typeof readActive;
    writeRunOutcomeFn?: typeof writeRunOutcome;
  },
): Promise<void> {
  const writeRunOutcomeFn = input.writeRunOutcomeFn ?? writeRunOutcome;
  const outcome = await runOutcomeFromLoopResult(result, input);
  await writeRunOutcomeFn(input.project.remote, outcome, input.stateRoot);
}

export async function persistRunOutcomeFromWorkerError(
  error: unknown,
  input: {
    project: Project;
    stateRoot: string;
    stoppedAt: string;
    readActiveFn?: typeof readActive;
    writeRunOutcomeFn?: typeof writeRunOutcome;
  },
): Promise<void> {
  const writeRunOutcomeFn = input.writeRunOutcomeFn ?? writeRunOutcome;
  const outcome = await runOutcomeFromWorkerError(error, input);
  await writeRunOutcomeFn(input.project.remote, outcome, input.stateRoot);
}

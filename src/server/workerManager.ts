import {
  loopProject,
  type AgentStreamEnvelope,
  type LoopProjectResult,
  type RunProjectDeps,
  type WorkerControl,
} from "../cli/index.js";
import { type Project } from "../registry/index.js";
import {
  persistRunOutcomeFromLoopResult,
  persistRunOutcomeFromWorkerError,
} from "../state/runOutcomeFromWorker.js";
import { type EventBus } from "./eventBus.js";

export type WorkerManagerDeps = {
  loopProject?: typeof loopProject;
  eventBus: EventBus;
  now?: () => Date;
};

export type WorkerManager = {
  start: (
    project: Project,
    input: { rootDir: string; stateRoot: string; deps?: RunProjectDeps },
  ) => Promise<{ status: "started" } | { status: "already-running" }>;
  pause: (projectId: string) => { status: "paused" } | { status: "not-running" };
  resume: (projectId: string) => { status: "resumed" } | { status: "not-running" };
  kill: (projectId: string) => { status: "killed" } | { status: "not-running" };
  isRunning: (projectId: string) => boolean;
  isPaused: (projectId: string) => boolean;
};

type WorkerEntry = {
  projectId: string;
  abortController: AbortController;
  paused: boolean;
  promise: Promise<LoopProjectResult | undefined>;
};

function createWorkerControl(entry: WorkerEntry): WorkerControl {
  return {
    signal: entry.abortController.signal,
    isPaused: () => entry.paused,
    waitIfPaused: async () => {
      while (entry.paused) {
        if (entry.abortController.signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
  };
}

function workerStopReason(error: unknown): string {
  return error instanceof Error ? error.message : "worker error";
}

export function createWorkerManager(deps: WorkerManagerDeps): WorkerManager {
  const loopProjectFn = deps.loopProject ?? loopProject;
  const now = deps.now ?? (() => new Date());
  const workers = new Map<string, WorkerEntry>();

  return {
    async start(project, input) {
      if (workers.has(project.id)) {
        return { status: "already-running" };
      }

      const abortController = new AbortController();
      const entry: WorkerEntry = {
        projectId: project.id,
        abortController,
        paused: false,
        promise: Promise.resolve(undefined),
      };
      workers.set(project.id, entry);

      const control = createWorkerControl(entry);
      const runDeps: RunProjectDeps = {
        ...input.deps,
        control,
        onPhaseLog: (chunk) => {
          deps.eventBus.emit({ type: "phase-log", projectId: project.id, chunk });
          input.deps?.onPhaseLog?.(chunk);
        },
        onAgentStream: (envelope: AgentStreamEnvelope) => {
          deps.eventBus.emit({
            type: "stream",
            projectId: project.id,
            issue: envelope.issue,
            phase: envelope.phase,
            event: envelope.event,
          });
          input.deps?.onAgentStream?.(envelope);
        },
        runPhase: async (options) => {
          const runPhaseFn =
            input.deps?.runPhase ??
            (await import("../runner/index.js")).runPhase;
          return runPhaseFn({ ...options, signal: control.signal });
        },
      };

      deps.eventBus.emit({ type: "worker-started", projectId: project.id });

      entry.promise = loopProjectFn(
        { projectId: project.id, rootDir: input.rootDir, stateRoot: input.stateRoot },
        runDeps,
      )
        .then(async (result) => {
          await persistRunOutcomeFromLoopResult(result, {
            project,
            stateRoot: input.stateRoot,
            stoppedAt: now().toISOString(),
          });
          deps.eventBus.emit({
            type: "worker-stopped",
            projectId: project.id,
            reason: result.status,
          });
          return result;
        })
        .catch(async (error: unknown) => {
          await persistRunOutcomeFromWorkerError(error, {
            project,
            stateRoot: input.stateRoot,
            stoppedAt: now().toISOString(),
          });
          deps.eventBus.emit({
            type: "worker-stopped",
            projectId: project.id,
            reason: workerStopReason(error),
          });
          return undefined;
        })
        .finally(() => {
          workers.delete(project.id);
        });

      return { status: "started" };
    },

    pause(projectId) {
      const entry = workers.get(projectId);
      if (!entry) {
        return { status: "not-running" };
      }
      entry.paused = true;
      deps.eventBus.emit({ type: "worker-paused", projectId });
      return { status: "paused" };
    },

    resume(projectId) {
      const entry = workers.get(projectId);
      if (!entry) {
        return { status: "not-running" };
      }
      entry.paused = false;
      deps.eventBus.emit({ type: "worker-resumed", projectId });
      return { status: "resumed" };
    },

    kill(projectId) {
      const entry = workers.get(projectId);
      if (!entry) {
        return { status: "not-running" };
      }
      entry.abortController.abort();
      return { status: "killed" };
    },

    isRunning(projectId) {
      return workers.has(projectId);
    },

    isPaused(projectId) {
      return workers.get(projectId)?.paused ?? false;
    },
  };
}

import { resolve } from "node:path";
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
import { reapProcessTree } from "./reapProcessTree.js";
import { installServerConsoleCapture } from "./serverLog.js";

export type WorkerManagerDeps = {
  loopProject?: typeof loopProject;
  eventBus: EventBus;
  now?: () => Date;
  /**
   * Terminate the orchestrator's descendant subtree on kill. Defaults to a
   * SIGTERM→SIGKILL sweep of `process.pid`'s descendants, which reaps agent
   * grandchildren (e.g. `vitest` fork-pool workers) that Sandcastle's
   * best-effort SIGTERM leaves orphaned. Injectable for tests.
   */
  reapProcessTree?: (rootPid: number) => Promise<number[]>;
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
  streamedPhaseKeys: Set<string>;
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

export function createWorkerManager(deps: WorkerManagerDeps): WorkerManager {
  const loopProjectFn = deps.loopProject ?? loopProject;
  const now = deps.now ?? (() => new Date());
  const reapProcessTreeFn =
    deps.reapProcessTree ?? ((rootPid: number) => reapProcessTree(rootPid));
  const serverLog = installServerConsoleCapture({ eventBus: deps.eventBus });
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
        streamedPhaseKeys: new Set(),
      };
      workers.set(project.id, entry);

      const resolvedProjectPath = resolve(project.path);
      const resolvedRootDir = resolve(input.rootDir);
      const run = async () => {
        if (resolvedProjectPath === resolvedRootDir) {
          console.warn(
            `[sandcastle] AFK project "${project.id}" runs on the open workspace (${resolvedProjectPath}). ` +
              "Cursor extension-host memory often grows when agent CLI and IDE share the same folder. " +
              "Prefer a separate git clone in projects.json, or close this workspace during long AFK runs.",
          );
        }

        const control = createWorkerControl(entry);
        const runDeps: RunProjectDeps = {
          ...input.deps,
          control,
          livePhaseLog: true,
          onPhaseLog: (chunk) => {
            deps.eventBus.emit({ type: "phase-log", projectId: project.id, chunk });
            input.deps?.onPhaseLog?.(chunk);
          },
          onAgentStream: (envelope: AgentStreamEnvelope) => {
            if (envelope.event.type === "text" && envelope.event.message) {
              const chunk = envelope.event.message.endsWith("\n")
                ? envelope.event.message
                : `${envelope.event.message}\n`;
              deps.eventBus.emit({ type: "phase-log", projectId: project.id, chunk });
            }
            const streamKey = `${envelope.issue}:${envelope.phase}`;
            if (!entry.streamedPhaseKeys.has(streamKey)) {
              entry.streamedPhaseKeys.add(streamKey);
              deps.eventBus.emit({
                type: "stream",
                projectId: project.id,
                issue: envelope.issue,
                phase: envelope.phase,
              });
            }
            input.deps?.onAgentStream?.(envelope);
          },
          runPhase: async (options) => {
            const runPhaseFn =
              input.deps?.runPhase ??
              (await import("../runner/index.js")).runPhase;
            return serverLog.runWithBranch(options.branch, async () =>
              runPhaseFn({ ...options, signal: control.signal }),
            );
          },
        };

        deps.eventBus.emit({ type: "worker-started", projectId: project.id });

        return loopProjectFn(
          { projectId: project.id, rootDir: input.rootDir, stateRoot: input.stateRoot },
          runDeps,
        )
          .then(async (result) => {
            const lastRunOutcome = await persistRunOutcomeFromLoopResult(result, {
              project,
              stateRoot: input.stateRoot,
              stoppedAt: now().toISOString(),
            });
            deps.eventBus.emit({
              type: "worker-stopped",
              projectId: project.id,
              lastRunOutcome,
            });
            return result;
          })
          .catch(async (error: unknown) => {
            const lastRunOutcome = await persistRunOutcomeFromWorkerError(error, {
              project,
              stateRoot: input.stateRoot,
              stoppedAt: now().toISOString(),
            });
            deps.eventBus.emit({
              type: "worker-stopped",
              projectId: project.id,
              lastRunOutcome,
            });
            return undefined;
          })
          .finally(() => {
            workers.delete(project.id);
          });
      };

      entry.promise = serverLog.runWithProject(
        { projectId: project.id, projectPath: project.path },
        async () => run(),
      );

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
      // Abort only signals Sandcastle to SIGTERM the agent process group.
      // Sweep descendant survivors (orphaned vitest workers, etc.) out of band.
      void Promise.resolve()
        .then(() => reapProcessTreeFn(process.pid))
        .catch((error: unknown) => {
          console.warn(
            `[sandcastle] reap after kill of "${projectId}" failed:`,
            error,
          );
        });
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

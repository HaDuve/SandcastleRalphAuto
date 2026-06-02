import { type RunnablePhase } from "../prompts/phases.js";
import { type RunOutcome } from "../state/index.js";

export type DashboardEvent =
  | { type: "worker-started"; projectId: string }
  | { type: "worker-stopped"; projectId: string; lastRunOutcome: RunOutcome }
  | { type: "worker-paused"; projectId: string }
  | { type: "worker-resumed"; projectId: string }
  | { type: "phase-log"; projectId: string; chunk: string }
  | {
      type: "stream";
      projectId: string;
      issue: number;
      phase: RunnablePhase;
    };

export type EventListener = (event: DashboardEvent) => void;

export type EventBus = {
  emit: (event: DashboardEvent) => void;
  subscribe: (projectId: string, listener: EventListener) => () => void;
};

export function createEventBus(): EventBus {
  const listeners = new Map<string, Set<EventListener>>();

  return {
    emit(event) {
      const projectListeners = listeners.get(event.projectId);
      if (!projectListeners) {
        return;
      }
      for (const listener of projectListeners) {
        // Async dispatch keeps publishers (Sandcastle stream callbacks) off the hot path.
        queueMicrotask(() => {
          try {
            listener(event);
          } catch {
            // A broken subscriber must not kill the publisher or other listeners.
          }
        });
      }
    },
    subscribe(projectId, listener) {
      let projectListeners = listeners.get(projectId);
      if (!projectListeners) {
        projectListeners = new Set();
        listeners.set(projectId, projectListeners);
      }
      projectListeners.add(listener);
      return () => {
        projectListeners!.delete(listener);
        if (projectListeners!.size === 0) {
          listeners.delete(projectId);
        }
      };
    },
  };
}

export type DashboardEvent =
  | { type: "worker-started"; projectId: string }
  | { type: "worker-stopped"; projectId: string; reason: string }
  | { type: "worker-paused"; projectId: string }
  | { type: "worker-resumed"; projectId: string }
  | { type: "phase-log"; projectId: string; chunk: string }
  | { type: "stream"; projectId: string; payload: unknown };

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
        listener(event);
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

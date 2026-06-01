import { vi } from "vitest";

export type StoppableEventSourceHandle = {
  sources: Array<{
    emit: (type: string, data: unknown) => void;
  }>;
};

export function installStoppableEventSource(input?: {
  connected?: { projectId: string; workerStatus: "idle" | "running" | "paused" };
}): StoppableEventSourceHandle {
  const sources: StoppableEventSourceHandle["sources"] = [];

  class StoppableEventSource {
    private listeners = new Map<string, Set<(event: Event) => void>>();

    constructor(url: string) {
      void url;
      sources.push(this);
      if (input?.connected) {
        queueMicrotask(() => {
          this.emit("connected", {
            type: "connected",
            projectId: input.connected!.projectId,
            workerStatus: input.connected!.workerStatus,
          });
        });
      }
    }

    addEventListener(type: string, handler: (event: Event) => void) {
      let typeListeners = this.listeners.get(type);
      if (!typeListeners) {
        typeListeners = new Set();
        this.listeners.set(type, typeListeners);
      }
      typeListeners.add(handler);
    }

    removeEventListener(type: string, handler: (event: Event) => void) {
      this.listeners.get(type)?.delete(handler);
    }

    close() {}

    emit(type: string, data: unknown) {
      const handlers = this.listeners.get(type);
      if (!handlers) {
        return;
      }
      for (const handler of handlers) {
        handler({ data: JSON.stringify(data) } as unknown as Event);
      }
    }
  }

  vi.stubGlobal("EventSource", StoppableEventSource as unknown as typeof EventSource);
  return { sources };
}

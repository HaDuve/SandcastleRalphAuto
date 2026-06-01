import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

class MockEventSource {
  url: string;
  private listeners = new Map<string, Set<(event: Event) => void>>();

  constructor(url: string) {
    this.url = url;
    queueMicrotask(() => {
      this.dispatch("connected", {
        type: "connected",
        projectId: this.projectIdFromUrl(url),
        workerStatus: "idle",
      });
    });
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

  private projectIdFromUrl(url: string): string {
    const match = url.match(/\/api\/projects\/([^/]+)\/events$/);
    return match?.[1] ? decodeURIComponent(match[1]) : "";
  }

  private dispatch(type: string, data: unknown) {
    const handlers = this.listeners.get(type);
    if (!handlers) {
      return;
    }
    for (const handler of handlers) {
      handler({ data: JSON.stringify(data) } as unknown as Event);
    }
  }
}

function installEventSourceMock(): void {
  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
}

installEventSourceMock();

afterEach(() => {
  cleanup();
  installEventSourceMock();
});

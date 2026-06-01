import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

class MockEventSource {
  url: string;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

function installEventSourceMock(): void {
  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
}

installEventSourceMock();

afterEach(() => {
  cleanup();
  installEventSourceMock();
});

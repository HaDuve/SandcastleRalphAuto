import { describe, expect, it } from "vitest";
import { createEventBus, type DashboardEvent } from "../src/server/eventBus.js";

describe("createEventBus", () => {
  it("does not propagate listener errors to the publisher", () => {
    const eventBus = createEventBus();
    eventBus.subscribe("portfolio", () => {
      throw new Error("broken listener");
    });

    const received: DashboardEvent[] = [];
    eventBus.subscribe("portfolio", (event) => {
      received.push(event);
    });

    expect(() => {
      eventBus.emit({
        type: "stream",
        projectId: "portfolio",
        issue: 12,
        phase: "tdd",
        event: {
          type: "text",
          message: "still delivered",
          iteration: 1,
          timestamp: new Date("2026-06-01T12:00:00.000Z"),
        },
      });
    }).not.toThrow();

    return new Promise<void>((resolve, reject) => {
      queueMicrotask(() => {
        try {
          expect(received).toHaveLength(1);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  });

  it("returns immediately without waiting for listeners", () => {
    const eventBus = createEventBus();
    let listenerStarted = false;

    eventBus.subscribe("portfolio", () => {
      listenerStarted = true;
    });

    eventBus.emit({
      type: "phase-log",
      projectId: "portfolio",
      chunk: "line",
    });

    expect(listenerStarted).toBe(false);
  });
});

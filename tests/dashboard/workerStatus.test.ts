import { describe, expect, it } from "vitest";
import { applyWorkerEvent } from "../../dashboard/src/workerStatus.js";

describe("applyWorkerEvent", () => {
  it("marks a project worker as running when it starts", () => {
    expect(applyWorkerEvent("idle", { type: "worker-started" })).toBe("running");
  });

  it("marks a running worker as paused", () => {
    expect(applyWorkerEvent("running", { type: "worker-paused" })).toBe("paused");
  });

  it("marks a paused worker as running again on resume", () => {
    expect(applyWorkerEvent("paused", { type: "worker-resumed" })).toBe("running");
  });

  it("returns the worker to idle when it stops", () => {
    expect(applyWorkerEvent("running", { type: "worker-stopped" })).toBe("idle");
    expect(applyWorkerEvent("paused", { type: "worker-stopped" })).toBe("idle");
  });

  it("applies connected events that carry orchestrator status", () => {
    expect(applyWorkerEvent(undefined, { type: "connected", workerStatus: "idle" })).toBe(
      "idle",
    );
    expect(applyWorkerEvent("running", { type: "connected", workerStatus: "idle" })).toBe(
      "idle",
    );
    expect(applyWorkerEvent(undefined, { type: "connected", workerStatus: "running" })).toBe(
      "running",
    );
    expect(applyWorkerEvent("idle", { type: "connected", workerStatus: "paused" })).toBe(
      "paused",
    );
  });

  it("ignores unrelated dashboard events", () => {
    expect(applyWorkerEvent("running", { type: "phase-log" })).toBe("running");
  });
});

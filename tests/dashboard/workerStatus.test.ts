import { describe, expect, it } from "vitest";
import {
  applyWorkerEvent,
  canHideProject,
  stoppedRunOutcome,
  workerStateFromSnapshot,
} from "../../dashboard/src/workerStatus.js";

describe("applyWorkerEvent", () => {
  it("marks a project worker as running when it starts", () => {
    expect(applyWorkerEvent({ status: "idle", lastOutcome: null }, { type: "worker-started" })).toEqual({
      status: "running",
      lastOutcome: null,
    });
  });

  it("marks a running worker as paused", () => {
    expect(applyWorkerEvent({ status: "running", lastOutcome: null }, { type: "worker-paused" }).status).toBe(
      "paused",
    );
  });

  it("marks a paused worker as running again on resume", () => {
    expect(applyWorkerEvent({ status: "paused", lastOutcome: null }, { type: "worker-resumed" }).status).toBe(
      "running",
    );
  });

  it("returns the worker to idle when it stops", () => {
    expect(applyWorkerEvent({ status: "running", lastOutcome: null }, { type: "worker-stopped" }).status).toBe(
      "idle",
    );
    expect(applyWorkerEvent({ status: "paused", lastOutcome: null }, { type: "worker-stopped" }).status).toBe(
      "idle",
    );
  });

  it("carries lastOutcome from worker-stopped reason", () => {
    const next = applyWorkerEvent({ status: "running", lastOutcome: null }, {
      type: "worker-stopped",
      reason: "queue-empty",
    });

    expect(next.status).toBe("idle");
    expect(next.lastOutcome).toEqual({
      outcome: "queue-empty",
      stoppedAt: expect.any(String),
    });
  });

  it("applies connected events that carry orchestrator status", () => {
    expect(applyWorkerEvent(undefined, { type: "connected", workerStatus: "idle" }).status).toBe(
      "idle",
    );
    expect(
      applyWorkerEvent({ status: "running", lastOutcome: null }, { type: "connected", workerStatus: "idle" })
        .status,
    ).toBe("idle");
    expect(applyWorkerEvent(undefined, { type: "connected", workerStatus: "running" }).status).toBe(
      "running",
    );
    expect(
      applyWorkerEvent({ status: "idle", lastOutcome: null }, { type: "connected", workerStatus: "paused" })
        .status,
    ).toBe("paused");
  });

  it("ignores unrelated dashboard events", () => {
    expect(applyWorkerEvent({ status: "running", lastOutcome: null }, { type: "phase-log" }).status).toBe(
      "running",
    );
    expect(applyWorkerEvent(undefined, { type: "phase-log" }).status).toBe("unknown");
  });
});

describe("workerStateFromSnapshot", () => {
  it("maps enriched project fields into worker state when idle", () => {
    expect(
      workerStateFromSnapshot({
        workerStatus: "idle",
        lastRunOutcome: {
          outcome: "blocked",
          reason: "CI failed",
          stoppedAt: "2026-06-01T12:00:00.000Z",
        },
      }),
    ).toEqual({
      status: "idle",
      lastOutcome: {
        outcome: "blocked",
        reason: "CI failed",
        stoppedAt: "2026-06-01T12:00:00.000Z",
      },
    });
  });

  it("drops stale lastRunOutcome while the worker is running", () => {
    expect(
      workerStateFromSnapshot({
        workerStatus: "running",
        lastRunOutcome: {
          outcome: "blocked",
          reason: "CI failed",
          stoppedAt: "2026-06-01T12:00:00.000Z",
        },
      }),
    ).toEqual({
      status: "running",
      lastOutcome: null,
    });
  });
});

describe("stoppedRunOutcome", () => {
  it("returns null while the worker is running", () => {
    expect(
      stoppedRunOutcome({
        status: "running",
        lastOutcome: {
          outcome: "blocked",
          reason: "CI failed",
          stoppedAt: "2026-06-01T12:00:00.000Z",
        },
      }),
    ).toBeNull();
  });

  it("returns the last outcome when the worker is idle", () => {
    expect(
      stoppedRunOutcome({
        status: "idle",
        lastOutcome: {
          outcome: "blocked",
          reason: "CI failed",
          stoppedAt: "2026-06-01T12:00:00.000Z",
        },
      }),
    ).toEqual({
      outcome: "blocked",
      reason: "CI failed",
      stoppedAt: "2026-06-01T12:00:00.000Z",
    });
  });
});

describe("canHideProject", () => {
  it("blocks hide only while the worker is running", () => {
    expect(canHideProject("running")).toBe(false);
    expect(canHideProject("unknown")).toBe(true);
    expect(canHideProject("idle")).toBe(true);
    expect(canHideProject("paused")).toBe(true);
  });
});

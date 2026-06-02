import { describe, expect, it } from "vitest";
import {
  formatFleetLine,
  summarizeFleet,
} from "../../dashboard/src/fleetSummary.js";
import type { Project, ProjectActiveSummary } from "../../dashboard/src/types.js";
import type { WorkerState } from "../../dashboard/src/workerStatus.js";

const baseProject = (id: string, overrides: Partial<Project> = {}): Project => ({
  id,
  path: `/tmp/${id}`,
  remote: `HaDuve/${id}`,
  defaultBase: "main",
  afkLabel: "ready-for-agent",
  blockedLabels: [],
  autoMerge: true,
  concurrency: "single",
  sandbox: "none",
  ...overrides,
});

describe("summarizeFleet", () => {
  it("counts only visible projects into posture buckets", () => {
    const visible = [
      baseProject("a", { workerStatus: "running" }),
      baseProject("b", { workerStatus: "paused" }),
      baseProject("c"),
    ];
    const workerStates: Record<string, WorkerState> = {
      a: { status: "running", lastOutcome: null },
      b: { status: "paused", lastOutcome: null },
      c: { status: "idle", lastOutcome: null },
    };

    expect(
      summarizeFleet(visible, workerStates, {}, 2),
    ).toEqual({
      running: 1,
      paused: 1,
      blocked: 0,
      idle: 1,
      hidden: 2,
    });
  });

  it("counts a running worker as running when its slice is blocked", () => {
    const visible = [baseProject("portfolio", { workerStatus: "running" })];
    const workerStates: Record<string, WorkerState> = {
      portfolio: { status: "running", lastOutcome: null },
    };
    const activeSummaries: Record<string, ProjectActiveSummary | null> = {
      portfolio: { issue: 11, phase: "merge", status: "blocked" },
    };

    expect(summarizeFleet(visible, workerStates, activeSummaries, 0)).toEqual({
      running: 1,
      paused: 0,
      blocked: 0,
      idle: 0,
      hidden: 0,
    });
  });

  it("counts blocked from active slice when worker is not running", () => {
    const visible = [baseProject("portfolio")];
    const activeSummaries: Record<string, ProjectActiveSummary | null> = {
      portfolio: { issue: 11, phase: "merge", status: "awaiting-human" },
    };

    expect(summarizeFleet(visible, {}, activeSummaries, 0)).toEqual({
      running: 0,
      paused: 0,
      blocked: 1,
      idle: 0,
      hidden: 0,
    });
  });

  it("counts blocked from last run outcome when idle", () => {
    const visible = [
      baseProject("portfolio", {
        lastRunOutcome: {
          outcome: "error",
          reason: "crash",
          stoppedAt: "2026-06-01T00:00:00.000Z",
        },
      }),
    ];
    const workerStates: Record<string, WorkerState> = {
      portfolio: {
        status: "idle",
        lastOutcome: {
          outcome: "blocked",
          reason: "CI failed",
          stoppedAt: "2026-06-01T01:00:00.000Z",
        },
      },
    };

    expect(summarizeFleet(visible, workerStates, {}, 0)).toEqual({
      running: 0,
      paused: 0,
      blocked: 1,
      idle: 0,
      hidden: 0,
    });
  });

  it("counts queue-empty last outcome as idle", () => {
    const visible = [baseProject("portfolio")];
    const workerStates: Record<string, WorkerState> = {
      portfolio: {
        status: "idle",
        lastOutcome: {
          outcome: "queue-empty",
          stoppedAt: "2026-06-01T00:00:00.000Z",
        },
      },
    };

    expect(summarizeFleet(visible, workerStates, {}, 0)).toEqual({
      running: 0,
      paused: 0,
      blocked: 0,
      idle: 1,
      hidden: 0,
    });
  });
});

describe("formatFleetLine", () => {
  it("renders posture counts separated by middle dots", () => {
    expect(
      formatFleetLine({
        running: 2,
        paused: 1,
        blocked: 2,
        idle: 8,
        hidden: 0,
      }),
    ).toBe("2 running · 1 paused · 2 blocked · 8 idle");
  });

  it("appends hidden suffix only when hidden count is positive", () => {
    expect(
      formatFleetLine({
        running: 0,
        paused: 0,
        blocked: 0,
        idle: 1,
        hidden: 3,
      }),
    ).toBe("0 running · 0 paused · 0 blocked · 1 idle · 3 hidden");
  });
});

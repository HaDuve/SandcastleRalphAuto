import { describe, expect, it } from "vitest";
import {
  formatProjectStatusIndicator,
  resolveActiveSummaryForCard,
  resolveWorkerStatusForCard,
} from "../../dashboard/src/projectStatus.js";
import type { Project, ProjectActiveSummary } from "../../dashboard/src/types.js";
import type { WorkerStatus } from "../../dashboard/src/workerStatus.js";

const active: ProjectActiveSummary = {
  issue: 11,
  phase: "review-pr",
  status: "active",
};

describe("formatProjectStatusIndicator", () => {
  it("shows idle when the worker is idle and there is no blocked slice", () => {
    expect(formatProjectStatusIndicator("idle", null)).toBe("idle");
  });

  it("shows running with the current phase when the worker is running", () => {
    expect(formatProjectStatusIndicator("running", active)).toBe("running · review-pr");
  });

  it("shows paused when the worker is paused", () => {
    expect(formatProjectStatusIndicator("paused", active)).toBe("paused");
  });

  it("shows blocked when the active slice is blocked", () => {
    expect(
      formatProjectStatusIndicator("idle", { ...active, status: "blocked" }),
    ).toBe("blocked");
  });

  it("shows running with babysit when the recovery phase is active", () => {
    expect(
      formatProjectStatusIndicator("running", { ...active, phase: "babysit" }),
    ).toBe("running · babysit");
  });
});

const portfolio: Project = {
  id: "portfolio",
  path: "/tmp/portfolio",
  remote: "HaDuve/Portfolio",
  defaultBase: "main",
  afkLabel: "ready-for-agent",
  blockedLabels: [],
  autoMerge: true,
  concurrency: "single",
  sandbox: "none",
};

describe("resolveWorkerStatusForCard", () => {
  it("falls back to the projects snapshot when live worker state is unknown", () => {
    expect(
      resolveWorkerStatusForCard({ ...portfolio, workerStatus: "running" }, undefined),
    ).toBe("running");
  });

  it("prefers live worker state over the projects snapshot", () => {
    expect(
      resolveWorkerStatusForCard(
        { ...portfolio, workerStatus: "idle" },
        { status: "running", lastOutcome: null },
      ),
    ).toBe("running");
  });
});

describe("resolveActiveSummaryForCard", () => {
  it("falls back to the projects snapshot when no live summary exists", () => {
    const snapshot: ProjectActiveSummary = {
      issue: 11,
      phase: "merge",
      status: "active",
    };
    expect(
      resolveActiveSummaryForCard({ ...portfolio, active: snapshot }, undefined),
    ).toEqual(snapshot);
  });
});

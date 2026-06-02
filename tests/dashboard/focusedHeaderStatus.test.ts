import { describe, expect, it } from "vitest";
import { buildFocusedStatus } from "../../dashboard/src/focusedHeaderStatus.js";
import type { ActiveSlice, Project, ProjectActiveSummary } from "../../dashboard/src/types.js";
import type { WorkerState } from "../../dashboard/src/workerStatus.js";

const now = "2026-06-01T01:00:00.000Z";

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

const runningWorker: WorkerState = { status: "running", lastOutcome: null };

const activeSlice: ActiveSlice = {
  issue: 11,
  phase: "review-pr",
  branch: "issue-11",
  pr: 42,
  status: "active",
  startedAt: "2026-06-01T00:30:00.000Z",
};

const activeSummary: ProjectActiveSummary = {
  issue: 11,
  phase: "review-pr",
  status: "active",
};

describe("buildFocusedStatus", () => {
  it("maps null project to the empty state", () => {
    expect(buildFocusedStatus(null, undefined, null, null, now)).toEqual({
      message: "No project selected",
      id: null,
      remote: null,
      path: null,
      worker: null,
      phase: null,
      issue: null,
      pr: null,
      outcome: null,
      reason: null,
      sinceStop: null,
      phaseElapsed: null,
    });
  });

  it("maps unknown worker state to connecting", () => {
    expect(
      buildFocusedStatus(portfolio, { status: "unknown", lastOutcome: null }, null, null, now),
    ).toMatchObject({
      message: "Connecting…",
      id: "portfolio",
      remote: "HaDuve/Portfolio",
      path: "/tmp/portfolio",
    });
  });

  it("shows phase and in-progress elapsed when the worker is running", () => {
    expect(
      buildFocusedStatus(portfolio, runningWorker, activeSummary, activeSlice, now),
    ).toMatchObject({
      message: null,
      id: "portfolio",
      remote: "HaDuve/Portfolio",
      worker: "running",
      phase: "review-pr",
      issue: 11,
      pr: 42,
      phaseElapsed: "30m",
      outcome: null,
      reason: null,
      sinceStop: null,
    });
  });

  it("prefers a running worker over a blocked active slice", () => {
    const blockedSlice: ActiveSlice = {
      ...activeSlice,
      status: "blocked",
      phase: "babysit",
      reason: "merge conflicts",
    };
    const blockedSummary: ProjectActiveSummary = {
      issue: 11,
      phase: "babysit",
      status: "blocked",
    };

    expect(
      buildFocusedStatus(portfolio, runningWorker, blockedSummary, blockedSlice, now),
    ).toMatchObject({
      worker: "running",
      phase: "babysit",
      phaseElapsed: "30m",
      outcome: null,
      reason: null,
    });
  });

  it("shows outcome, reason, and stopped duration when idle with a last run outcome", () => {
    const idleWorker: WorkerState = {
      status: "idle",
      lastOutcome: {
        outcome: "blocked",
        reason: "CI failing",
        stoppedAt: "2026-06-01T00:45:00.000Z",
        phase: "merge",
      },
    };

    expect(
      buildFocusedStatus(portfolio, idleWorker, null, null, now),
    ).toMatchObject({
      worker: "idle",
      outcome: "Blocked",
      reason: "CI failing",
      sinceStop: "15m ago",
      phaseElapsed: null,
    });
  });

  it("reports blocked when idle with a blocked active slice and no running worker", () => {
    const idleWorker: WorkerState = { status: "idle", lastOutcome: null };
    const blockedSummary: ProjectActiveSummary = {
      issue: 9,
      phase: "merge",
      status: "blocked",
    };

    expect(
      buildFocusedStatus(portfolio, idleWorker, blockedSummary, null, now),
    ).toMatchObject({
      worker: "blocked",
      phase: "merge",
      issue: 9,
      outcome: null,
    });
  });
});

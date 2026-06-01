import { describe, expect, it } from "vitest";
import { type Project } from "../src/registry/index.js";
import {
  runOutcomeFromLoopResult,
  runOutcomeFromWorkerError,
} from "../src/state/runOutcomeFromWorker.js";
import { type ActiveState } from "../src/state/index.js";

const project: Project = {
  id: "portfolio",
  path: "/tmp/portfolio",
  remote: "HaDuve/Portfolio",
  defaultBase: "main",
  afkLabel: "ready-for-agent",
  blockedLabels: ["needs-info"],
  autoMerge: true,
  concurrency: "single",
  sandbox: "none",
};

const stoppedAt = "2026-06-01T12:00:00.000Z";

describe("runOutcomeFromWorkerError", () => {
  it("maps AbortError to killed", async () => {
    await expect(
      runOutcomeFromWorkerError(new DOMException("Aborted", "AbortError"), {
        project,
        stateRoot: "/tmp/state",
        stoppedAt,
        readActiveFn: async () => null,
      }),
    ).resolves.toEqual({
      outcome: "killed",
      stoppedAt,
    });
  });

  it("maps crashes to error with reason and phase logRef from active state", async () => {
    const active: ActiveState = {
      issue: 7,
      phase: "tdd",
      branch: "issue-7",
      status: "active",
    };

    await expect(
      runOutcomeFromWorkerError(new Error("agent crashed"), {
        project,
        stateRoot: "/tmp/state",
        stoppedAt,
        readActiveFn: async () => active,
      }),
    ).resolves.toEqual({
      outcome: "error",
      reason: "agent crashed",
      phase: "tdd",
      stoppedAt,
      logRef: "/tmp/portfolio/.sandcastle/logs/issue-7-tdd.log",
    });
  });
});

describe("runOutcomeFromLoopResult", () => {
  it("maps blocked loop results using active state for phase and logRef", async () => {
    const active: ActiveState = {
      issue: 7,
      phase: "review-tdd",
      branch: "issue-7",
      status: "blocked",
      reason: "Required check ci failed",
      resumeSkill: "/review-tdd",
    };

    await expect(
      runOutcomeFromLoopResult(
        { status: "blocked", reason: "Required check ci failed" },
        {
          project,
          stateRoot: "/tmp/state",
          stoppedAt,
          readActiveFn: async () => active,
        },
      ),
    ).resolves.toEqual({
      outcome: "blocked",
      reason: "Required check ci failed",
      phase: "review-tdd",
      stoppedAt,
      logRef: "/tmp/portfolio/.sandcastle/logs/issue-7-review-tdd.log",
    });
  });
});

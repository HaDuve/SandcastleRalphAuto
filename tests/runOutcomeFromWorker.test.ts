import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Handoff } from "../src/handoff/index.js";
import { type Project } from "../src/registry/index.js";
import { readRunOutcome } from "../src/state/index.js";
import {
  persistRunOutcomeFromLoopResult,
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

  it("uses host handoff for logRef when active slice was cleared", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "run-outcome-handoff-"));
    const handoffDir = join(stateRoot, project.remote, "handoff");
    await mkdir(handoffDir, { recursive: true });
    const handoff: Handoff = {
      project: project.remote,
      issue: 30,
      branch: "issue-30",
      pr: 42,
      phase: "merge",
      acceptanceState: "done",
      blockers: [],
      mergeReady: true,
      nextSkill: "/next",
      startedAt: stoppedAt,
      endedAt: stoppedAt,
    };
    await writeFile(
      join(handoffDir, "current.json"),
      JSON.stringify(handoff, null, 2) + "\n",
    );

    await expect(
      runOutcomeFromWorkerError(new Error("gh failed"), {
        project,
        stateRoot,
        stoppedAt,
        readActiveFn: async () => null,
      }),
    ).resolves.toEqual({
      outcome: "error",
      reason: "gh failed",
      phase: "merge",
      stoppedAt,
      logRef: "/tmp/portfolio/.sandcastle/logs/issue-30-merge.log",
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

  it("maps host-level blocked without active slice (no phase or logRef)", async () => {
    await expect(
      runOutcomeFromLoopResult(
        { status: "blocked", reason: "Could not parse issues from gh" },
        {
          project,
          stateRoot: "/tmp/state",
          stoppedAt,
          readActiveFn: async () => null,
        },
      ),
    ).resolves.toEqual({
      outcome: "blocked",
      reason: "Could not parse issues from gh",
      stoppedAt,
    });
  });

  it("persists host-level blocked to run.json", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "run-outcome-worker-"));

    await persistRunOutcomeFromLoopResult(
      { status: "blocked", reason: "Could not parse issues from gh" },
      {
        project,
        stateRoot,
        stoppedAt,
        readActiveFn: async () => null,
      },
    );

    await expect(readRunOutcome(project.remote, stateRoot)).resolves.toEqual({
      outcome: "blocked",
      reason: "Could not parse issues from gh",
      stoppedAt,
    });
  });
});

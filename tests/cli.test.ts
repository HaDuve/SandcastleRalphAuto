import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Handoff } from "../src/handoff/index.js";
import {
  CliError,
  loopProject,
  runProjectSlice,
} from "../src/cli/index.js";
import { QUEUE_EMPTY } from "../src/next/index.js";
import {
  runLinearSlice,
  type RunLinearSliceOptions,
  type RunLinearSliceResult,
} from "../src/pipeline/index.js";
import { type Project } from "../src/registry/index.js";
import {
  PHASE_COMPLETE_SIGNAL,
  type RunPhaseOptions,
  type RunPhaseResult,
} from "../src/runner/index.js";

const portfolio: Project = {
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

function reviewHandoff(pr = 42): Handoff {
  return {
    project: "HaDuve/Portfolio",
    issue: 10,
    branch: "issue-10",
    pr,
    phase: "review-pr",
    acceptanceState: "done",
    verdict: "approve",
    blockers: [],
    mergeReady: false,
    nextSkill: "/review-tdd",
    startedAt: "2026-06-01T00:00:00.000Z",
    endedAt: "2026-06-01T01:00:00.000Z",
  };
}

function sliceSuccess(issue = 10, pr = 42): Extract<
  RunLinearSliceResult,
  { status: "ready-for-next" }
> {
  return {
    status: "ready-for-next",
    issue,
    branch: `issue-${issue}`,
    pr,
    phasesCompleted: [
      "tdd",
      "create-pr",
      "review-pr",
      "review-tdd",
      "merge",
    ],
  };
}

describe("runProjectSlice", () => {
  it("loads registry and runs linear slice for the project", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "cli-root-"));
    const stateRoot = join(rootDir, "state");
    await writeFile(
      join(rootDir, "projects.json"),
      JSON.stringify({ projects: [portfolio] }, null, 2),
    );

    let sliceOptions: RunLinearSliceOptions | undefined;

    const result = await runProjectSlice(
      { projectId: "portfolio", issue: 10, rootDir, stateRoot },
      {
        loadRegistry: async () => [portfolio],
        runLinearSlice: async (options, sliceDeps) => {
          sliceOptions = options;
          await sliceDeps!.runPhase({
            phase: "review-pr",
            branch: "issue-10",
            projectPath: "/tmp/portfolio",
          });
          return sliceSuccess();
        },
        runPhase: async (options) =>
          ({
            commits: [],
            branch: options.branch,
            completionSignal: PHASE_COMPLETE_SIGNAL,
            handoff: reviewHandoff(),
          }) satisfies RunPhaseResult,
        runMergeGate: async () => ({ status: "auto-merge-queued" as const }),
        waitForMergedPr: async () => {},
        mutex: {
          acquire: async () => {},
          release: async () => {},
        },
      },
    );

    expect(sliceOptions).toEqual({
      projectId: "HaDuve/Portfolio",
      issue: 10,
      branch: "issue-10",
      projectPath: "/tmp/portfolio",
      stateRoot,
    });
    expect(result).toEqual({
      status: "completed",
      issue: 10,
      pr: 42,
    });
  });

  it("rejects unknown project ids", async () => {
    await expect(
      runProjectSlice(
        { projectId: "missing", issue: 10 },
        {
          loadRegistry: async () => [portfolio],
          runLinearSlice: async () => sliceSuccess(),
          runMergeGate: async () => ({ status: "auto-merge-queued" as const }),
          mutex: {
            acquire: async () => {},
            release: async () => {},
          },
        },
      ),
    ).rejects.toThrow(CliError);
  });

  it("runs merge gate with the review-pr handoff after a successful slice", async () => {
    const review = reviewHandoff();
    let mergeInput: { handoff: Handoff; pr: number } | undefined;

    const result = await runProjectSlice(
      { projectId: "portfolio", issue: 10 },
      {
        loadRegistry: async () => [portfolio],
        runLinearSlice: async (_options, deps) => {
          await deps!.runPhase({
            phase: "review-pr",
            branch: "issue-10",
            projectPath: "/tmp/portfolio",
          });
          return sliceSuccess();
        },
        runPhase: async (options) =>
          ({
            commits: [],
            branch: options.branch,
            completionSignal: PHASE_COMPLETE_SIGNAL,
            handoff:
              options.phase === "review-pr"
                ? review
                : {
                    ...review,
                    phase: options.phase,
                    nextSkill: "/next",
                  },
          }) satisfies RunPhaseResult,
        runMergeGate: async (input) => {
          mergeInput = input;
          return { status: "auto-merge-queued" };
        },
        waitForMergedPr: async () => {},
        mutex: {
          acquire: async () => {},
          release: async () => {},
        },
      },
    );

    expect(mergeInput).toEqual({
      handoff: review,
      project: portfolio,
      pr: 42,
    });
    expect(result.status).toBe("completed");
  });

  it("streams phase log files to the log sink", async () => {
    const logs: string[] = [];

    await runProjectSlice(
      { projectId: "portfolio", issue: 10 },
      {
        loadRegistry: async () => [portfolio],
        runLinearSlice: async (_options, deps) => {
          await deps!.runPhase({
            phase: "tdd",
            branch: "issue-10",
            projectPath: "/tmp/portfolio",
          });
          return sliceSuccess();
        },
        runPhase: async (options) => ({
          commits: [],
          branch: options.branch,
          completionSignal: PHASE_COMPLETE_SIGNAL,
          logFilePath: "/tmp/tdd.log",
          handoff: reviewHandoff(),
        }),
        readLogFile: async () => "phase log line\n",
        onPhaseLog: (line) => {
          logs.push(line);
        },
        runMergeGate: async () => ({ status: "auto-merge-queued" }),
        waitForMergedPr: async () => {},
        mutex: {
          acquire: async () => {},
          release: async () => {},
        },
      },
    );

    expect(logs).toEqual(["phase log line\n"]);
  });

  it("forwards live agent stream events tagged with issue and phase", async () => {
    const envelopes: Array<{ issue: number; phase: string; event: { type: string } }> =
      [];
    let capturedRunPhaseOptions: RunPhaseOptions | undefined;

    await runProjectSlice(
      { projectId: "portfolio", issue: 12 },
      {
        loadRegistry: async () => [portfolio],
        runLinearSlice: async (_options, sliceDeps) => {
          await sliceDeps!.runPhase({
            phase: "tdd",
            branch: "issue-12",
            projectPath: "/tmp/portfolio",
          });
          return sliceSuccess();
        },
        runPhase: async (options) => {
          capturedRunPhaseOptions = options;
          options.onAgentStreamEvent?.({
            type: "text",
            message: "writing tests",
            iteration: 1,
            timestamp: new Date("2026-06-01T12:00:00.000Z"),
          });
          return {
            commits: [],
            branch: options.branch,
            completionSignal: PHASE_COMPLETE_SIGNAL,
            handoff: reviewHandoff(),
          };
        },
        onAgentStream: (envelope) => {
          envelopes.push(envelope);
        },
        runMergeGate: async () => ({ status: "auto-merge-queued" }),
        waitForMergedPr: async () => {},
        mutex: {
          acquire: async () => {},
          release: async () => {},
        },
      },
    );

    expect(capturedRunPhaseOptions?.onAgentStreamEvent).toEqual(
      expect.any(Function),
    );
    expect(envelopes).toEqual([
      {
        issue: 12,
        phase: "tdd",
        event: {
          type: "text",
          message: "writing tests",
          iteration: 1,
          timestamp: new Date("2026-06-01T12:00:00.000Z"),
        },
      },
    ]);
  });

  it("waits for the PR to merge before releasing the mutex", async () => {
    const events: string[] = [];

    await runProjectSlice(
      { projectId: "portfolio", issue: 10 },
      {
        loadRegistry: async () => [portfolio],
        runLinearSlice: async (_options, deps) => {
          await deps!.runPhase({
            phase: "review-pr",
            branch: "issue-10",
            projectPath: "/tmp/portfolio",
          });
          return sliceSuccess();
        },
        runPhase: async (options) =>
          ({
            commits: [],
            branch: options.branch,
            completionSignal: PHASE_COMPLETE_SIGNAL,
            handoff: reviewHandoff(),
          }) satisfies RunPhaseResult,
        runMergeGate: async () => ({ status: "auto-merge-queued" }),
        waitForMergedPr: async () => {
          events.push("waited-for-merge");
        },
        mutex: {
          acquire: async () => {
            events.push("acquire");
          },
          release: async () => {
            events.push("release");
          },
        },
      },
    );

    expect(events).toEqual(["acquire", "waited-for-merge", "release"]);
  });

  it("refuses to start when the project mutex is already held", async () => {
    await expect(
      runProjectSlice(
        { projectId: "portfolio", issue: 10 },
        {
          loadRegistry: async () => [portfolio],
          runLinearSlice: async () => sliceSuccess(),
          runMergeGate: async () => ({ status: "auto-merge-queued" }),
          mutex: {
            acquire: async () => {
              throw new CliError("Project HaDuve/Portfolio is already running");
            },
            release: async () => {},
          },
        },
      ),
    ).rejects.toThrow(/already running/);
  });
});

describe("loopProject", () => {
  it("runs /next until the queue is empty", async () => {
    const nextCalls: number[] = [];
    let sliceCount = 0;

    const result = await loopProject(
      { projectId: "portfolio", issue: 10, rootDir: "/tmp/root" },
      {
        loadRegistry: async () => [portfolio],
        runLinearSlice: async (_options, sliceDeps) => {
          await sliceDeps!.runPhase({
            phase: "review-pr",
            branch: _options.branch,
            projectPath: _options.projectPath,
          });
          sliceCount += 1;
          return sliceSuccess(10 + sliceCount - 1, 40 + sliceCount);
        },
        runPhase: async (options) =>
          ({
            commits: [],
            branch: options.branch,
            completionSignal: PHASE_COMPLETE_SIGNAL,
            handoff: reviewHandoff(40 + sliceCount + 1),
          }) satisfies RunPhaseResult,
        runMergeGate: async () => ({ status: "auto-merge-queued" }),
        waitForMergedPr: async () => {},
        runNext: async (input) => {
          nextCalls.push(input.pr);
          if (nextCalls.length === 1) {
            return { status: "started", issue: 11, branch: "issue-11" };
          }
          return { status: QUEUE_EMPTY };
        },
        mutex: {
          acquire: async () => {},
          release: async () => {},
        },
      },
    );

    expect(sliceCount).toBe(2);
    expect(nextCalls).toEqual([41, 42]);
    expect(result).toEqual({ status: "queue-empty", slicesCompleted: 2 });
  });

  it("passes fromPhase create-pr on the second loop iteration", async () => {
    const sliceOptions: RunLinearSliceOptions[] = [];

    await loopProject(
      { projectId: "portfolio", issue: 10 },
      {
        loadRegistry: async () => [portfolio],
        runLinearSlice: async (options, sliceDeps) => {
          sliceOptions.push(options);
          await sliceDeps!.runPhase({
            phase: "review-pr",
            branch: options.branch,
            projectPath: options.projectPath,
          });
          return sliceSuccess(
            options.issue,
            options.issue === 10 ? 41 : 42,
          );
        },
        runPhase: async (options) =>
          ({
            commits: [],
            branch: options.branch,
            completionSignal: PHASE_COMPLETE_SIGNAL,
            handoff: reviewHandoff(),
          }) satisfies RunPhaseResult,
        runMergeGate: async () => ({ status: "auto-merge-queued" }),
        waitForMergedPr: async () => {},
        runNext: async (input) =>
          input.pr === 41
            ? { status: "started", issue: 11, branch: "issue-11" }
            : { status: QUEUE_EMPTY },
        mutex: {
          acquire: async () => {},
          release: async () => {},
        },
      },
    );

    expect(sliceOptions[0]?.fromPhase).toBeUndefined();
    expect(sliceOptions[1]).toMatchObject({
      issue: 11,
      fromPhase: "create-pr",
    });
  });

  it("cold-starts the lowest eligible issue when loop has no seed issue", async () => {
    let bootstrapCalled = false;

    const result = await loopProject(
      { projectId: "portfolio" },
      {
        loadRegistry: async () => [portfolio],
        readActive: async () => null,
        bootstrapFirstIssue: async () => {
          bootstrapCalled = true;
          return { status: "started", issue: 9, branch: "issue-9" };
        },
        runLinearSlice: async (options, sliceDeps) => {
          await sliceDeps!.runPhase({
            phase: "review-pr",
            branch: options.branch,
            projectPath: options.projectPath,
          });
          return sliceSuccess(9, 41);
        },
        runPhase: async (options) =>
          ({
            commits: [],
            branch: options.branch,
            completionSignal: PHASE_COMPLETE_SIGNAL,
            handoff: reviewHandoff(41),
          }) satisfies RunPhaseResult,
        runMergeGate: async () => ({ status: "auto-merge-queued" }),
        waitForMergedPr: async () => {},
        runNext: async () => ({ status: QUEUE_EMPTY }),
        mutex: {
          acquire: async () => {},
          release: async () => {},
        },
      },
    );

    expect(bootstrapCalled).toBe(true);
    expect(result).toEqual({ status: "queue-empty", slicesCompleted: 1 });
  });

  it("releases the mutex when the worker is aborted", async () => {
    const events: string[] = [];
    const abortController = new AbortController();

    await expect(
      loopProject(
        { projectId: "portfolio", issue: 10 },
        {
          loadRegistry: async () => [portfolio],
          control: {
            signal: abortController.signal,
            isPaused: () => false,
            waitIfPaused: async () => {},
          },
          runLinearSlice: async () => {
            abortController.abort();
            throw new DOMException("Aborted", "AbortError");
          },
          mutex: {
            acquire: async () => {
              events.push("acquire");
            },
            release: async () => {
              events.push("release");
            },
          },
        },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(events).toEqual(["acquire", "release"]);
  });

  it("keeps the mutex when the slice is blocked", async () => {
    const events: string[] = [];

    const result = await loopProject(
      { projectId: "portfolio", issue: 10 },
      {
        loadRegistry: async () => [portfolio],
        runLinearSlice: async () => ({
          status: "blocked" as const,
          phasesCompleted: [],
          active: {
            issue: 10,
            phase: "tdd" as const,
            branch: "issue-10",
            status: "blocked" as const,
            reason: "tests failing",
          },
        }),
        mutex: {
          acquire: async () => {
            events.push("acquire");
          },
          release: async () => {
            events.push("release");
          },
        },
      },
    );

    expect(result).toEqual({ status: "blocked", reason: "tests failing" });
    expect(events).toEqual(["acquire"]);
  });
});

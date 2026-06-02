import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Handoff, writeHostHandoff } from "../src/handoff/index.js";
import { readActive } from "../src/state/index.js";
import {
  loopProject,
  runProjectSlice,
  type RunProjectDeps,
} from "../src/cli/index.js";
import { type RunMergeGateResult } from "../src/merge/index.js";
import { QUEUE_EMPTY } from "../src/next/index.js";
import {
  runLinearSlice,
  type RunLinearSliceOptions,
  type RunLinearSliceResult,
} from "../src/pipeline/index.js";
import { type Project } from "../src/registry/index.js";
import { type RunnablePhase } from "../src/prompts/phases.js";
import {
  PHASE_COMPLETE_SIGNAL,
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

function mergeReadyHandoff(pr = 42): Handoff {
  return {
    project: "HaDuve/Portfolio",
    issue: 10,
    branch: "issue-10",
    pr,
    phase: "merge",
    acceptanceState: "done",
    verdict: "approve",
    blockers: [],
    mergeReady: true,
    nextSkill: "/merge",
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

function mergeTailDeps(overrides: {
  runLinearSlice?: typeof runLinearSlice;
  runMergeGate?: () => Promise<RunMergeGateResult>;
  runPhase?: (options: {
    phase: RunnablePhase;
    branch: string;
  }) => Promise<RunPhaseResult>;
}): { deps: RunProjectDeps; mergeGateCalls: { count: number } } {
  const mergeGateCalls: { count: number } = { count: 0 };
  let mergeGateImpl = overrides.runMergeGate;

  return {
    deps: {
      loadRegistry: async () => [portfolio],
      runLinearSlice:
        overrides.runLinearSlice ??
        (async (options, sliceDeps) => {
          if (options.fromPhase === "babysit") {
            return {
              status: "recovery-complete" as const,
              issue: options.issue,
              branch: options.branch,
              pr: 42,
            };
          }
          await sliceDeps!.runPhase({
            phase: "review-pr",
            branch: options.branch,
            projectPath: options.projectPath,
            projectId: options.projectId,
            stateRoot: options.stateRoot,
          });
          return sliceSuccess(options.issue, 42);
        }),
      runPhase:
        overrides.runPhase ??
        (async () => ({
          commits: [],
          branch: "issue-10",
          completionSignal: PHASE_COMPLETE_SIGNAL,
          handoff: mergeReadyHandoff(),
        })),
      runMergeGate: async () => {
        mergeGateCalls.count += 1;
        if (mergeGateImpl) {
          return mergeGateImpl();
        }
        if (mergeGateCalls.count === 1) {
          return {
            status: "blocked" as const,
            kind: "required-checks-failed",
            reason: "Required checks not green: ci",
            resumeSkill: "/merge" as const,
          };
        }
        return { status: "auto-merge-queued" as const };
      },
      waitForMergedPr: async () => {},
      mutex: {
        acquire: async () => {},
        release: async () => {},
      },
    },
    mergeGateCalls,
  };
}

describe("merge-tail recovery", () => {
  it("runs babysit then re-runs the merge gate on a babysit-able block", async () => {
    const linearCalls: RunLinearSliceOptions[] = [];
    const { deps, mergeGateCalls } = mergeTailDeps({
      runLinearSlice: async (options, sliceDeps) => {
        linearCalls.push(options);
        if (options.fromPhase === "babysit") {
          await sliceDeps!.runPhase({
            phase: "babysit",
            branch: options.branch,
            projectPath: options.projectPath,
            projectId: options.projectId,
            stateRoot: options.stateRoot,
          });
          return {
            status: "recovery-complete",
            issue: options.issue,
            branch: options.branch,
            pr: 42,
          };
        }
        await sliceDeps!.runPhase({
          phase: "review-pr",
          branch: options.branch,
          projectPath: options.projectPath,
          projectId: options.projectId,
          stateRoot: options.stateRoot,
        });
        return sliceSuccess();
      },
      runPhase: async (options) => {
        if (options.phase === "babysit") {
          return {
            commits: [],
            branch: "issue-10",
            completionSignal: PHASE_COMPLETE_SIGNAL,
            handoff: mergeReadyHandoff(),
          };
        }
        return {
          commits: [],
          branch: "issue-10",
          completionSignal: PHASE_COMPLETE_SIGNAL,
          handoff: mergeReadyHandoff(),
        };
      },
    });

    const result = await runProjectSlice(
      { projectId: "portfolio", issue: 10 },
      deps,
    );

    expect(linearCalls.some((o) => o.fromPhase === "babysit")).toBe(true);
    expect(mergeGateCalls.count).toBe(2);
    expect(result).toEqual({ status: "completed", issue: 10, pr: 42 });
  });

  it("uses real runLinearSlice for babysit when merge gate is babysit-able", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "merge-tail-real-slice-"));
    let babysitPhaseRan = false;
    let activeDuringBabysit: Awaited<ReturnType<typeof readActive>> = null;

    await writeHostHandoff({
      stateRoot,
      projectId: portfolio.remote,
      handoff: mergeReadyHandoff(),
    });

    const result = await runProjectSlice(
      { projectId: "portfolio", issue: 10, stateRoot },
      {
        loadRegistry: async () => [portfolio],
        runLinearSlice: async (options, sliceDeps) => {
          if (options.fromPhase === "babysit") {
            return runLinearSlice(options, sliceDeps!);
          }
          await sliceDeps!.runPhase({
            phase: "review-pr",
            branch: options.branch,
            projectPath: options.projectPath,
            projectId: options.projectId,
            stateRoot: options.stateRoot,
          });
          return sliceSuccess();
        },
        runPhase: async (options) => {
          if (options.phase === "babysit") {
            babysitPhaseRan = true;
            activeDuringBabysit = await readActive(
              portfolio.remote,
              stateRoot,
            );
          }
          return {
            commits: [],
            branch: options.branch,
            completionSignal: PHASE_COMPLETE_SIGNAL,
            handoff: {
              ...mergeReadyHandoff(),
              phase: options.phase,
              nextSkill: "/merge",
            },
          };
        },
        runMergeGate: async () => ({
          status: "blocked",
          kind: "required-checks-failed",
          reason: "Required checks not green: ci",
          resumeSkill: "/merge",
        }),
        waitForMergedPr: async () => {},
        mutex: {
          acquire: async () => {},
          release: async () => {},
        },
      },
    );

    expect(babysitPhaseRan).toBe(true);
    expect(activeDuringBabysit).toMatchObject({
      phase: "babysit",
      status: "active",
    });
    expect(result).toEqual({
      status: "blocked",
      issue: 10,
      reason: "Required checks not green: ci",
    });
  });

  it("proceeds to /next when the merge gate passes after babysit", async () => {
    let nextCalled = false;

    const result = await loopProject(
      { projectId: "portfolio", issue: 10 },
      {
        ...mergeTailDeps({}).deps,
        readActive: async () => null,
        runLinearSlice: async (options, sliceDeps) => {
          if (options.fromPhase === "babysit") {
            return {
              status: "recovery-complete",
              issue: options.issue,
              branch: options.branch,
              pr: 42,
            };
          }
          await sliceDeps!.runPhase({
            phase: "review-pr",
            branch: options.branch,
            projectPath: options.projectPath,
            projectId: options.projectId,
            stateRoot: options.stateRoot,
          });
          return sliceSuccess();
        },
        runNext: async () => {
          nextCalled = true;
          return { status: QUEUE_EMPTY };
        },
      },
    );

    expect(nextCalled).toBe(true);
    expect(result).toEqual({ status: "queue-empty", slicesCompleted: 1 });
  });

  it("blocks with merge-gate reason when still blocked after babysit retry", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "merge-tail-blocked-retry-"));
    const { deps } = mergeTailDeps({
      runMergeGate: async () => ({
        status: "blocked",
        kind: "required-checks-failed",
        reason: "Required checks not green: ci",
        resumeSkill: "/merge",
      }),
    });

    const result = await runProjectSlice(
      { projectId: "portfolio", issue: 10, stateRoot },
      deps,
    );

    const active = await readActive(portfolio.remote, stateRoot);

    expect(result).toEqual({
      status: "blocked",
      issue: 10,
      reason: "Required checks not green: ci",
    });
    expect(active).toMatchObject({
      phase: "merge",
      status: "blocked",
      resumeSkill: "/merge",
      reason: "Required checks not green: ci",
    });
  });

  it("returns recovery-slice blocked when babysit phase fails", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "merge-tail-babysit-fail-"));

    const result = await runProjectSlice(
      { projectId: "portfolio", issue: 10, stateRoot },
      {
        loadRegistry: async () => [portfolio],
        runLinearSlice: async (options, sliceDeps) => {
          if (options.fromPhase === "babysit") {
            return runLinearSlice(options, sliceDeps!);
          }
          await sliceDeps!.runPhase({
            phase: "review-pr",
            branch: options.branch,
            projectPath: options.projectPath,
            projectId: options.projectId,
            stateRoot: options.stateRoot,
          });
          return sliceSuccess();
        },
        runPhase: async (options) => {
          if (options.phase === "babysit") {
            throw new Error("babysit agent failed");
          }
          return {
            commits: [],
            branch: options.branch,
            completionSignal: PHASE_COMPLETE_SIGNAL,
            handoff: mergeReadyHandoff(),
          };
        },
        runMergeGate: async () => ({
          status: "blocked",
          kind: "required-checks-failed",
          reason: "Required checks not green: ci",
          resumeSkill: "/merge",
        }),
        waitForMergedPr: async () => {},
        mutex: {
          acquire: async () => {},
          release: async () => {},
        },
      },
    );

    const active = await readActive(portfolio.remote, stateRoot);

    expect(result).toEqual({
      status: "blocked",
      issue: 10,
      reason: "babysit agent failed",
    });
    expect(active).toMatchObject({
      phase: "babysit",
      status: "blocked",
      resumeSkill: "/babysit",
    });
  });

  it("does not run babysit when merge gate blocks with a human kind", async () => {
    const linearCalls: RunLinearSliceOptions[] = [];
    const { deps } = mergeTailDeps({
      runLinearSlice: async (options, sliceDeps) => {
        linearCalls.push(options);
        await sliceDeps!.runPhase({
          phase: "review-pr",
          branch: options.branch,
          projectPath: options.projectPath,
          projectId: options.projectId,
          stateRoot: options.stateRoot,
        });
        return sliceSuccess();
      },
      runPhase: async () => ({
        commits: [],
        branch: "issue-10",
        completionSignal: PHASE_COMPLETE_SIGNAL,
        handoff: mergeReadyHandoff(),
      }),
      runMergeGate: async () => ({
        status: "blocked",
        kind: "no-approve-verdict",
        reason: "Merge gate requires a clean Approve verdict",
        resumeSkill: "/merge",
      }),
    });

    const result = await runProjectSlice(
      { projectId: "portfolio", issue: 10 },
      deps,
    );

    expect(linearCalls.some((o) => o.fromPhase === "babysit")).toBe(false);
    expect(result.status).toBe("blocked");
  });

  it("does not run babysit when merge gate handoff is still on review-pr → review-tdd", async () => {
    const linearCalls: RunLinearSliceOptions[] = [];
    const { deps } = mergeTailDeps({
      runLinearSlice: async (options, sliceDeps) => {
        linearCalls.push(options);
        await sliceDeps!.runPhase({
          phase: "review-pr",
          branch: options.branch,
          projectPath: options.projectPath,
          projectId: options.projectId,
          stateRoot: options.stateRoot,
        });
        return sliceSuccess();
      },
      runPhase: async () => ({
        commits: [],
        branch: "issue-10",
        completionSignal: PHASE_COMPLETE_SIGNAL,
        handoff: {
          project: "HaDuve/Portfolio",
          issue: 10,
          branch: "issue-10",
          pr: 42,
          phase: "review-pr",
          acceptanceState: "done",
          verdict: "request-changes",
          blockers: ["ci still red"],
          mergeReady: false,
          nextSkill: "/review-tdd",
          startedAt: "2026-06-01T00:00:00.000Z",
          endedAt: "2026-06-01T01:00:00.000Z",
        },
      }),
      runMergeGate: async () => ({
        status: "blocked",
        kind: "required-checks-failed",
        reason: "Required checks not green: ci",
        resumeSkill: "/merge",
      }),
    });

    const result = await runProjectSlice(
      { projectId: "portfolio", issue: 10 },
      deps,
    );

    expect(linearCalls.some((o) => o.fromPhase === "babysit")).toBe(false);
    expect(result.status).toBe("blocked");
  });

  it("never attempts babysit twice in one slice", async () => {
    let mergeGateCalls = 0;
    const babysitCalls: RunLinearSliceOptions[] = [];

    const { deps } = mergeTailDeps({
      runLinearSlice: async (options, sliceDeps) => {
        if (options.fromPhase === "babysit") {
          babysitCalls.push(options);
          return {
            status: "recovery-complete",
            issue: options.issue,
            branch: options.branch,
            pr: 42,
          };
        }
        await sliceDeps!.runPhase({
          phase: "review-pr",
          branch: options.branch,
          projectPath: options.projectPath,
          projectId: options.projectId,
          stateRoot: options.stateRoot,
        });
        return sliceSuccess();
      },
      runMergeGate: async () => {
        mergeGateCalls += 1;
        return {
          status: "blocked",
          kind: "pr-not-mergeable",
          reason: "PR is not mergeable",
          resumeSkill: "/merge",
        };
      },
    });

    await runProjectSlice({ projectId: "portfolio", issue: 10 }, deps);

    expect(babysitCalls).toHaveLength(1);
    expect(mergeGateCalls).toBe(2);
  });

  it("streams babysit phase logs through the phase log sink", async () => {
    const logs: string[] = [];

    await runProjectSlice(
      { projectId: "portfolio", issue: 10 },
      {
        ...mergeTailDeps({}).deps,
        runLinearSlice: async (options, sliceDeps) => {
          if (options.fromPhase === "babysit") {
            await sliceDeps!.runPhase({
              phase: "babysit",
              branch: options.branch,
              projectPath: options.projectPath,
              projectId: options.projectId,
              stateRoot: options.stateRoot,
            });
            return {
              status: "recovery-complete",
              issue: options.issue,
              branch: options.branch,
              pr: 42,
            };
          }
          await sliceDeps!.runPhase({
            phase: "review-pr",
            branch: options.branch,
            projectPath: options.projectPath,
            projectId: options.projectId,
            stateRoot: options.stateRoot,
          });
          return sliceSuccess();
        },
        runPhase: async (options) => ({
          commits: [],
          branch: options.branch,
          completionSignal: PHASE_COMPLETE_SIGNAL,
          logFilePath:
            options.phase === "babysit" ? "/tmp/babysit.log" : undefined,
          handoff: mergeReadyHandoff(),
        }),
        readLogFile: async (path) =>
          path.includes("babysit") ? "babysit log\n" : "",
        onPhaseLog: (line) => {
          logs.push(line);
        },
      },
    );

    expect(logs).toEqual(["babysit log\n"]);
  });
});

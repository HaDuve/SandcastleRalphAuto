import { access } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Handoff } from "../src/handoff/index.js";
import {
  CANONICAL_PHASES,
  RECOVERY_PHASES,
  type CanonicalPhase,
} from "../src/prompts/phases.js";
import {
  advanceSlice,
  getNextOrchestratorPhase,
  ORCHESTRATOR_PHASES,
  runLinearSlice,
} from "../src/pipeline/index.js";
import {
  PHASE_COMPLETE_SIGNAL,
  type RunPhaseOptions,
  type RunPhaseResult,
} from "../src/runner/index.js";
import { readActive, resolveActivePath, writeActive } from "../src/state/index.js";

describe("orchestrator phase sequence", () => {
  it("follows idle → tdd → create-pr → review-pr → review-tdd → merge → next", () => {
    expect(ORCHESTRATOR_PHASES).toEqual([
      "idle",
      "tdd",
      "create-pr",
      "review-pr",
      "review-tdd",
      "merge",
      "next",
    ]);
    expect(getNextOrchestratorPhase("idle")).toBe("tdd");
    expect(getNextOrchestratorPhase("tdd")).toBe("create-pr");
    expect(getNextOrchestratorPhase("create-pr")).toBe("review-pr");
    expect(getNextOrchestratorPhase("review-pr")).toBe("review-tdd");
    expect(getNextOrchestratorPhase("review-tdd")).toBe("merge");
    expect(getNextOrchestratorPhase("merge")).toBe("next");
    expect(getNextOrchestratorPhase("next")).toBeNull();
  });
});

function phaseResult(
  phase: Handoff["phase"],
  nextSkill: string,
  overrides: Partial<Handoff> = {},
): RunPhaseResult {
  return {
    commits: [],
    branch: "issue-7-pipeline",
    completionSignal: PHASE_COMPLETE_SIGNAL,
    handoff: {
      project: "HaDuve/SandcastleRalphAuto",
      issue: 7,
      branch: "issue-7-pipeline",
      phase,
      acceptanceState: "done",
      blockers: [],
      mergeReady: phase === "merge",
      nextSkill,
      startedAt: "2026-06-01T00:00:00.000Z",
      endedAt: "2026-06-01T01:00:00.000Z",
      ...overrides,
    },
  };
}

describe("advanceSlice", () => {
  const base = {
    issue: 7,
    branch: "issue-7-pipeline",
  };

  it("short-circuits after create-pr when there is no diff and no PR to review", () => {
    const outcome = advanceSlice({
      ...base,
      phase: "create-pr",
      result: phaseResult("create-pr", "/next", {
        pr: undefined,
        blockers: [],
        mergeReady: false,
      }),
    });

    expect(outcome).toEqual({
      ok: true,
      handoffToNext: true,
      active: {
        issue: 7,
        phase: "merge",
        branch: "issue-7-pipeline",
        pr: undefined,
        status: "active",
      },
    });
  });

  it("advances review-pr to review-tdd when verdict omitted but nextSkill routes", () => {
    const outcome = advanceSlice({
      ...base,
      phase: "review-pr",
      result: phaseResult("review-pr", "/review-tdd", {
        pr: 99,
        blockers: ["CI failing on lint"],
      }),
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.active.phase).toBe("review-tdd");
    }
  });

  it("blocks when review-pr approves but blockers remain", () => {
    const outcome = advanceSlice({
      ...base,
      phase: "review-pr",
      result: phaseResult("review-pr", "/review-tdd", {
        pr: 99,
        verdict: "approve",
        blockers: ["should not bypass"],
      }),
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toMatch(/blockers/);
    }
  });

  it("advances review-pr to review-tdd when request-changes lists findings in blockers", () => {
    const outcome = advanceSlice({
      ...base,
      phase: "review-pr",
      result: phaseResult("review-pr", "/review-tdd", {
        pr: 99,
        verdict: "request-changes",
        blockers: ["CI failing on lint"],
      }),
    });

    expect(outcome).toEqual({
      ok: true,
      handoffToNext: false,
      active: {
        issue: 7,
        phase: "review-tdd",
        branch: "issue-7-pipeline",
        pr: 99,
        status: "active",
      },
    });
  });

  it("advances review-pr to review-tdd (never babysit)", () => {
    const outcome = advanceSlice({
      ...base,
      phase: "review-pr",
      result: phaseResult("review-pr", "/review-tdd", { pr: 99 }),
    });

    expect(outcome).toEqual({
      ok: true,
      handoffToNext: false,
      active: {
        issue: 7,
        phase: "review-tdd",
        branch: "issue-7-pipeline",
        pr: 99,
        status: "active",
      },
    });
  });

  it("blocks when handoff routes to /babysit instead of review-tdd", () => {
    const outcome = advanceSlice({
      ...base,
      phase: "review-pr",
      pr: 99,
      result: phaseResult("review-pr", "/babysit", { pr: 99 }),
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toMatch(/linear pipeline/);
      expect(outcome.active).toEqual({
        issue: 7,
        phase: "review-pr",
        branch: "issue-7-pipeline",
        pr: 99,
        status: "blocked",
        reason: expect.stringMatching(/linear pipeline/),
        resumeSkill: "/review-pr",
      });
    }
  });

  it("blocks without advancing when completion signal is missing", () => {
    const outcome = advanceSlice({
      ...base,
      phase: "tdd",
      result: {
        ...phaseResult("tdd", "/create-pr"),
        completionSignal: undefined,
      },
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.active.phase).toBe("tdd");
      expect(outcome.active.status).toBe("blocked");
      expect(outcome.active.resumeSkill).toBe("/tdd");
    }
  });

  it("blocks with current-phase resumeSkill when acceptanceState is blocked", () => {
    const outcome = advanceSlice({
      ...base,
      phase: "merge",
      result: phaseResult("merge", "/next", {
        acceptanceState: "blocked",
        blockers: ["ci failed"],
      }),
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.active.resumeSkill).toBe("/merge");
    }
  });

  it("advances babysit to merge when handoff routes to /merge", () => {
    const outcome = advanceSlice({
      ...base,
      phase: "babysit",
      pr: 99,
      result: phaseResult("babysit", "/merge", { pr: 99 }),
    });

    expect(outcome).toEqual({
      ok: true,
      handoffToNext: false,
      active: {
        issue: 7,
        phase: "merge",
        branch: "issue-7-pipeline",
        pr: 99,
        status: "active",
      },
    });
  });

  it("blocks babysit when handoff nextSkill is not /merge", () => {
    const outcome = advanceSlice({
      ...base,
      phase: "babysit",
      pr: 99,
      result: phaseResult("babysit", "/review-tdd", { pr: 99 }),
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toMatch(/expected \/merge/);
      expect(outcome.active.resumeSkill).toBe("/babysit");
    }
  });
});

const NEXT_SKILL_BY_PHASE: Record<(typeof CANONICAL_PHASES)[number], string> =
  {
    tdd: "/create-pr",
    "create-pr": "/review-pr",
    "review-pr": "/review-tdd",
    "review-tdd": "/merge",
    merge: "/next",
  };

describe("runLinearSlice merge → babysit recovery", () => {
  const mergeConflictBlockers = [
    "PR #87 not mergeable: mergeStateStatus DIRTY — merge conflict with main",
  ];

  const mergeBlockedHandoff = (
    nextSkill: string,
    acceptanceState: Handoff["acceptanceState"] = "blocked",
    overrides: Partial<Handoff> = {},
  ): RunPhaseResult =>
    phaseResult("merge", nextSkill, {
      pr: 87,
      acceptanceState,
      verdict: "approve",
      mergeReady: false,
      blockers: mergeConflictBlockers,
      ...overrides,
    });

  it("runs babysit and retries merge when merge agent defers to /babysit", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "pipeline-merge-babysit-"));
    const projectId = "HaDuve/SandcastleRalphAuto";
    const phaseCalls: RunPhaseOptions["phase"][] = [];

    const result = await runLinearSlice(
      {
        projectId,
        issue: 80,
        branch: "issue-80",
        projectPath: "/tmp/project",
        stateRoot,
        fromPhase: "merge",
      },
      {
        runPhase: async (options) => {
          phaseCalls.push(options.phase);
          if (options.phase === "merge" && phaseCalls.filter((p) => p === "merge").length === 1) {
            return mergeBlockedHandoff("/babysit");
          }
          if (options.phase === "babysit") {
            return phaseResult("babysit", "/merge", { pr: 87 });
          }
          return phaseResult("merge", "/next", {
            pr: 87,
            acceptanceState: "done",
            mergeReady: true,
          });
        },
      },
    );

    expect(phaseCalls).toEqual(["merge", "babysit", "merge"]);
    expect(result).toMatchObject({
      status: "ready-for-next",
      issue: 80,
      pr: 87,
      mergeTailBabysitAttempted: true,
      phasesCompleted: ["merge"],
    });
    await expect(readActive(projectId, stateRoot)).resolves.toBeNull();
  });

  it("blocks when merge still defers to babysit after one recovery attempt", async () => {
    const stateRoot = await mkdtemp(
      join(tmpdir(), "pipeline-merge-babysit-twice-"),
    );
    const projectId = "HaDuve/SandcastleRalphAuto";

    const result = await runLinearSlice(
      {
        projectId,
        issue: 80,
        branch: "issue-80",
        projectPath: "/tmp/project",
        stateRoot,
        fromPhase: "merge",
      },
      {
        runPhase: async (options) => {
          if (options.phase === "babysit") {
            return phaseResult("babysit", "/merge", { pr: 87 });
          }
          return mergeBlockedHandoff("/babysit");
        },
      },
    );

    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.active).toMatchObject({
        phase: "merge",
        status: "blocked",
        resumeSkill: "/merge",
      });
      expect(result.phasesCompleted).toEqual([]);
    }
  });

  it("runs babysit when merge is blocked with /next but conflict blockers", async () => {
    const stateRoot = await mkdtemp(
      join(tmpdir(), "pipeline-merge-blocked-next-skill-"),
    );
    const projectId = "HaDuve/SandcastleRalphAuto";
    const phaseCalls: RunPhaseOptions["phase"][] = [];
    let mergeRuns = 0;

    const result = await runLinearSlice(
      {
        projectId,
        issue: 80,
        branch: "issue-80",
        projectPath: "/tmp/project",
        stateRoot,
        fromPhase: "merge",
      },
      {
        runPhase: async (options) => {
          phaseCalls.push(options.phase);
          if (options.phase === "babysit") {
            return phaseResult("babysit", "/merge", { pr: 87 });
          }
          mergeRuns += 1;
          if (mergeRuns === 1) {
            return mergeBlockedHandoff("/next");
          }
          return phaseResult("merge", "/next", {
            pr: 87,
            acceptanceState: "done",
            mergeReady: true,
            blockers: [],
          });
        },
      },
    );

    expect(phaseCalls).toEqual(["merge", "babysit", "merge"]);
    expect(result.status).toBe("ready-for-next");
  });

  it("blocks merge when blocked /next handoff has no babysit-able blockers", async () => {
    const stateRoot = await mkdtemp(
      join(tmpdir(), "pipeline-merge-blocked-human-"),
    );
    const projectId = "HaDuve/SandcastleRalphAuto";

    const result = await runLinearSlice(
      {
        projectId,
        issue: 80,
        branch: "issue-80",
        projectPath: "/tmp/project",
        stateRoot,
        fromPhase: "merge",
      },
      {
        runPhase: async () =>
          mergeBlockedHandoff("/next", "blocked", {
            blockers: ["Requires explicit human sign-off"],
          }),
      },
    );

    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.active.reason).toMatch(/acceptanceState is blocked/);
      expect(result.phasesCompleted).toEqual([]);
    }
  });
});

describe("runLinearSlice recovery resume", () => {
  it("runs babysit from fromPhase and returns recovery-complete", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "pipeline-recovery-"));
    const projectId = "HaDuve/SandcastleRalphAuto";
    let runPhasePhase: string | undefined;

    const result = await runLinearSlice(
      {
        projectId,
        issue: 7,
        branch: "issue-7-pipeline",
        projectPath: "/tmp/project",
        stateRoot,
        fromPhase: "babysit",
      },
      {
        runPhase: async (options) => {
          runPhasePhase = options.phase;
          return phaseResult("babysit", "/merge", { pr: 99 });
        },
      },
    );

    expect(runPhasePhase).toBe("babysit");
    expect(result).toEqual({
      status: "recovery-complete",
      issue: 7,
      branch: "issue-7-pipeline",
      pr: 99,
    });

    const active = await readActive(projectId, stateRoot);
    expect(active).toMatchObject({
      phase: "merge",
      status: "active",
      pr: 99,
    });
  });
});

describe("recovery phases", () => {
  it("keeps babysit out of the canonical linear loop", () => {
    expect(RECOVERY_PHASES).toEqual(["babysit"]);
    expect(CANONICAL_PHASES).not.toContain("babysit");
  });
});

describe("runLinearSlice", () => {
  it("runs the full linear sequence with a stubbed runner and hands off to /next", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "pipeline-state-"));
    const projectPath = await mkdtemp(join(tmpdir(), "pipeline-project-"));
    const projectId = "HaDuve/SandcastleRalphAuto";
    const phaseCalls: RunPhaseOptions["phase"][] = [];

    const result = await runLinearSlice(
      {
        projectId,
        issue: 7,
        branch: "issue-7-pipeline",
        projectPath,
        stateRoot,
      },
      {
        runPhase: async (options) => {
          phaseCalls.push(options.phase);
          const phase = options.phase as CanonicalPhase;
          return phaseResult(
            phase,
            NEXT_SKILL_BY_PHASE[phase],
            {
              pr: options.phase === "create-pr" ? 42 : 42,
            },
          );
        },
      },
    );

    expect(phaseCalls).toEqual([...CANONICAL_PHASES]);
    expect(result).toEqual({
      status: "ready-for-next",
      issue: 7,
      branch: "issue-7-pipeline",
      pr: 42,
      phasesCompleted: [...CANONICAL_PHASES],
    });
    await expect(readActive(projectId, stateRoot)).resolves.toBeNull();
    await expect(
      access(resolveActivePath(stateRoot, projectId)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("persists blocked state and stops after a failed phase", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "pipeline-state-"));
    const projectPath = await mkdtemp(join(tmpdir(), "pipeline-project-"));
    const projectId = "HaDuve/SandcastleRalphAuto";
    const phaseCalls: RunPhaseOptions["phase"][] = [];

    const result = await runLinearSlice(
      {
        projectId,
        issue: 7,
        branch: "issue-7-pipeline",
        projectPath,
        stateRoot,
      },
      {
        runPhase: async (options) => {
          phaseCalls.push(options.phase);
          if (options.phase === "create-pr") {
            return phaseResult("create-pr", "/babysit");
          }
          const phase = options.phase as CanonicalPhase;
          return phaseResult(phase, NEXT_SKILL_BY_PHASE[phase]);
        },
      },
    );

    expect(phaseCalls).toEqual(["tdd", "create-pr"]);
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.phasesCompleted).toEqual(["tdd"]);
      expect(result.active).toMatchObject({
        issue: 7,
        phase: "create-pr",
        status: "blocked",
        resumeSkill: "/create-pr",
      });
    }
    await expect(readActive(projectId, stateRoot)).resolves.toMatchObject({
      status: "blocked",
      phase: "create-pr",
    });
  });

  it("persists blocked state with current-phase resumeSkill when runPhase throws", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "pipeline-state-"));
    const projectPath = await mkdtemp(join(tmpdir(), "pipeline-project-"));
    const projectId = "HaDuve/SandcastleRalphAuto";

    const result = await runLinearSlice(
      {
        projectId,
        issue: 7,
        branch: "issue-7-pipeline",
        projectPath,
        stateRoot,
      },
      {
        runPhase: async (options) => {
          if (options.phase === "review-tdd") {
            throw new Error("sandbox run failed");
          }
          const phase = options.phase as CanonicalPhase;
          return phaseResult(phase, NEXT_SKILL_BY_PHASE[phase], { pr: 42 });
        },
      },
    );

    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.phasesCompleted).toEqual([
        "tdd",
        "create-pr",
        "review-pr",
      ]);
      expect(result.active).toMatchObject({
        phase: "review-tdd",
        status: "blocked",
        resumeSkill: "/review-tdd",
        reason: "sandbox run failed",
      });
    }
  });

  it("rethrows abort errors instead of marking the slice blocked", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "pipeline-state-"));
    const projectPath = await mkdtemp(join(tmpdir(), "pipeline-project-"));
    const projectId = "HaDuve/SandcastleRalphAuto";

    await expect(
      runLinearSlice(
        {
          projectId,
          issue: 7,
          branch: "issue-7-pipeline",
          projectPath,
          stateRoot,
        },
        {
          runPhase: async () => {
            throw new DOMException("Aborted", "AbortError");
          },
        },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("stops without re-running phases when active slice is awaiting-human", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "pipeline-state-"));
    const projectPath = await mkdtemp(join(tmpdir(), "pipeline-project-"));
    const projectId = "HaDuve/SandcastleRalphAuto";
    const awaitingHuman = {
      issue: 7,
      phase: "merge" as const,
      branch: "issue-7-pipeline",
      pr: 42,
      status: "awaiting-human" as const,
      reason: "autoMerge is disabled for this project",
    };
    await writeActive(projectId, awaitingHuman, stateRoot);
    const phaseCalls: RunPhaseOptions["phase"][] = [];

    const result = await runLinearSlice(
      {
        projectId,
        issue: 7,
        branch: "issue-7-pipeline",
        projectPath,
        stateRoot,
      },
      {
        runPhase: async (options) => {
          phaseCalls.push(options.phase);
          const phase = options.phase as CanonicalPhase;
          return phaseResult(
            phase,
            NEXT_SKILL_BY_PHASE[phase],
            { pr: 42 },
          );
        },
      },
    );

    expect(phaseCalls).toEqual([]);
    expect(result).toEqual({
      status: "awaiting-human",
      active: awaitingHuman,
      phasesCompleted: [],
    });
  });
});

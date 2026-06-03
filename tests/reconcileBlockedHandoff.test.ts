import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isHandoffSchemaBlockReason,
  tryReconcileCreatePrNoDiffBlockedHandoff,
  tryReconcileMergeDeferredBabysitHandoff,
  tryReconcileMergeDeferredReviewLoopHandoff,
  tryReconcileMergeGateBlockedHandoff,
  tryReconcileMissingPhaseCompleteBlockedHandoff,
  tryReconcileMergedTailBlockedHandoff,
  tryReconcileReviewPrBlockedHandoff,
  tryReconcileReviewPrProceduralBlockedHandoff,
  tryReconcileReviewTddProceduralBlockedHandoff,
  tryReconcileSchemaBlockedHandoff,
  tryReconcileTransientCursorBlockedHandoff,
  isTransientCursorBlockReason,
} from "../src/handoff/reconcileBlockedHandoff.js";
import { readHostHandoff, writeHostHandoff } from "../src/handoff/hostStore.js";
import { readHandoff } from "../src/handoff/io.js";
import type { Handoff } from "../src/handoff/schema.js";
import type { GitRunner } from "../src/handoff/worktreeNoDiff.js";

const noDiffGit: GitRunner = async (args) => {
  if (args[0] === "rev-list") {
    return { stdout: "0\n", exitCode: 0 };
  }
  if (args[0] === "diff" && args.includes("--quiet")) {
    return { stdout: "", exitCode: 0 };
  }
  return { stdout: "", exitCode: 1 };
};
import { MERGE_GATE_NO_APPROVE_REASON } from "../src/merge/index.js";
import {
  resolveActivePath,
  writeActive,
  type ActiveState,
} from "../src/state/index.js";
import { access } from "node:fs/promises";

describe("reconcileBlockedHandoff", () => {
  let rootDir = "";

  afterEach(() => {
    rootDir = "";
  });

  async function setupWorktreeHandoff(
    acceptanceState: string,
  ): Promise<{ projectPath: string; stateRoot: string; active: ActiveState }> {
    rootDir = await mkdtemp(join(tmpdir(), "reconcile-"));
    const projectPath = join(rootDir, "repo");
    const branch = "issue-29";
    const handoffDir = join(
      projectPath,
      ".sandcastle",
      "worktrees",
      branch,
      ".sandcastle-ralph",
      "handoff",
    );
    await mkdir(handoffDir, { recursive: true });
    await writeFile(
      join(handoffDir, "current.json"),
      JSON.stringify(
        {
          project: "HaDuve/FantasyEconomySim",
          issue: 29,
          branch,
          phase: "tdd",
          acceptanceState,
          blockers: [],
          mergeReady: true,
          nextSkill: "/create-pr",
          startedAt: "2026-06-01T00:00:00.000Z",
          endedAt: "2026-06-01T00:00:00.000Z",
        },
        null,
        2,
      ) + "\n",
    );

    const stateRoot = join(rootDir, "state");
    const active: ActiveState = {
      issue: 29,
      phase: "tdd",
      branch,
      status: "blocked",
      reason: 'Invalid handoff schema: acceptanceState "complete"',
      resumeSkill: "/tdd",
      startedAt: "2026-06-01T00:00:00.000Z",
    };
    await writeActive("proj", active, stateRoot);

    return { projectPath, stateRoot, active };
  }

  it("detects handoff schema block reasons", () => {
    expect(isHandoffSchemaBlockReason("Invalid handoff schema: x")).toBe(true);
    expect(isHandoffSchemaBlockReason("Phase failed")).toBe(false);
  });

  it("detects transient Cursor block reasons", () => {
    expect(
      isTransientCursorBlockReason(
        "cursor exited with code 1:\nT: [resource_exhausted] Error\n",
      ),
    ).toBe(true);
    expect(
      isTransientCursorBlockReason(
        "cursor exited with code 1:\nT: [resource_exhausted] Error\n (exhausted 5 Sandcastle attempts with exponential backoff)",
      ),
    ).toBe(false);
    expect(isTransientCursorBlockReason("Phase did not emit PHASE_COMPLETE")).toBe(
      false,
    );
  });

  it("resumes the same phase after transient Cursor block", async () => {
    const active: ActiveState = {
      issue: 95,
      phase: "create-pr",
      branch: "issue-95",
      status: "blocked",
      reason: "cursor exited with code 1:\nT: [resource_exhausted] Error\n",
      resumeSkill: "/create-pr",
      startedAt: "2026-06-02T05:56:48.422Z",
    };

    const reconciled = tryReconcileTransientCursorBlockedHandoff({ active });

    expect(reconciled).toEqual({
      issue: 95,
      phase: "create-pr",
      branch: "issue-95",
      status: "active",
      startedAt: active.startedAt,
    });
  });

  it("resumes the same phase after missing PHASE_COMPLETE block", async () => {
    const active: ActiveState = {
      issue: 97,
      phase: "review-pr",
      branch: "issue-97",
      pr: 108,
      status: "blocked",
      reason: "Phase did not emit PHASE_COMPLETE completion signal",
      resumeSkill: "/review-pr",
      startedAt: "2026-06-02T10:50:08.165Z",
    };

    const reconciled = tryReconcileMissingPhaseCompleteBlockedHandoff({ active });

    expect(reconciled).toEqual({
      issue: 97,
      phase: "review-pr",
      branch: "issue-97",
      pr: 108,
      status: "active",
      startedAt: active.startedAt,
    });
  });

  it("clears blocked create-pr when handoff documents zero commits vs main", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "reconcile-create-pr-nodiff-"));
    const projectPath = join(rootDir, "repo");
    const branch = "issue-95";
    const handoffDir = join(
      projectPath,
      ".sandcastle",
      "worktrees",
      branch,
      ".sandcastle-ralph",
      "handoff",
    );
    await mkdir(handoffDir, { recursive: true });
    await writeFile(
      join(handoffDir, "current.json"),
      JSON.stringify(
        {
          project: "HaDuve/SandcastleRalphAuto",
          issue: 95,
          branch,
          phase: "create-pr",
          acceptanceState: "blocked",
          blockers: [
            "No PR was created: branch issue-95 has 0 commits vs origin/main",
          ],
          mergeReady: false,
          nextSkill: "/review-pr",
          startedAt: "2026-06-02T06:53:30.322Z",
          endedAt: "2026-06-02T06:54:00.000Z",
        },
        null,
        2,
      ) + "\n",
    );

    const stateRoot = join(rootDir, "state");
    const active: ActiveState = {
      issue: 95,
      phase: "create-pr",
      branch,
      status: "blocked",
      reason: "Handoff acceptanceState is blocked, expected done",
      resumeSkill: "/create-pr",
      startedAt: "2026-06-02T06:53:30.322Z",
    };
    await writeActive("proj", active, stateRoot);

    const resumed = await tryReconcileCreatePrNoDiffBlockedHandoff({
      projectPath,
      branch,
      stateRoot,
      projectId: "proj",
      active,
      git: noDiffGit,
    });

    expect(resumed).toEqual({ issue: 95, branch });
    await expect(access(resolveActivePath(stateRoot, "proj"))).rejects.toThrow();

    const worktreeHandoff = await readHandoff(
      join(projectPath, ".sandcastle", "worktrees", branch),
    );
    expect(worktreeHandoff).toMatchObject({
      acceptanceState: "done",
      nextSkill: "/next",
      blockers: [],
    });
  });

  it("clears blocked create-pr on no-diff even when blockers are empty", async () => {
    rootDir = await mkdtemp(
      join(tmpdir(), "reconcile-create-pr-nodiff-empty-blockers-"),
    );
    const projectPath = join(rootDir, "repo");
    const branch = "issue-95";
    const handoffDir = join(
      projectPath,
      ".sandcastle",
      "worktrees",
      branch,
      ".sandcastle-ralph",
      "handoff",
    );
    await mkdir(handoffDir, { recursive: true });
    await writeFile(
      join(handoffDir, "current.json"),
      JSON.stringify(
        {
          project: "HaDuve/SandcastleRalphAuto",
          issue: 95,
          branch,
          phase: "create-pr",
          acceptanceState: "blocked",
          blockers: [],
          mergeReady: false,
          nextSkill: "/review-pr",
          startedAt: "2026-06-02T06:53:30.322Z",
          endedAt: "2026-06-02T06:54:00.000Z",
        },
        null,
        2,
      ) + "\n",
    );

    const stateRoot = join(rootDir, "state");
    const active: ActiveState = {
      issue: 95,
      phase: "create-pr",
      branch,
      status: "blocked",
      reason: "Handoff acceptanceState is blocked, expected done",
      resumeSkill: "/create-pr",
      startedAt: "2026-06-02T06:53:30.322Z",
    };
    await writeActive("proj", active, stateRoot);

    const resumed = await tryReconcileCreatePrNoDiffBlockedHandoff({
      projectPath,
      branch,
      stateRoot,
      projectId: "proj",
      active,
      git: noDiffGit,
    });

    expect(resumed).toEqual({ issue: 95, branch });
    await expect(access(resolveActivePath(stateRoot, "proj"))).rejects.toThrow();

    const worktreeHandoff = await readHandoff(
      join(projectPath, ".sandcastle", "worktrees", branch),
    );
    expect(worktreeHandoff).toMatchObject({
      acceptanceState: "done",
      nextSkill: "/next",
      blockers: [],
    });
  });

  it("resumes at create-pr when worktree handoff uses complete synonym", async () => {
    const { projectPath, stateRoot, active } =
      await setupWorktreeHandoff("complete");

    const reconciled = await tryReconcileSchemaBlockedHandoff({
      projectPath,
      branch: active.branch,
      stateRoot,
      projectId: "proj",
      active,
    });

    expect(reconciled).toEqual({
      issue: 29,
      phase: "create-pr",
      branch: "issue-29",
      status: "active",
      startedAt: active.startedAt,
    });

    const worktreeHandoff = await readHandoff(
      join(projectPath, ".sandcastle", "worktrees", active.branch),
    );
    expect(worktreeHandoff.acceptanceState).toBe("done");

    const hostHandoff = await readHostHandoff({
      stateRoot,
      projectId: "proj",
    });
    expect(hostHandoff.acceptanceState).toBe("done");
  });

  it("returns null when worktree handoff is missing", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "reconcile-empty-"));
    const stateRoot = join(rootDir, "state");
    const active: ActiveState = {
      issue: 1,
      phase: "tdd",
      branch: "issue-1",
      status: "blocked",
      reason: "Invalid handoff schema: bad",
      resumeSkill: "/tdd",
    };

    const reconciled = await tryReconcileSchemaBlockedHandoff({
      projectPath: join(rootDir, "repo"),
      branch: active.branch,
      stateRoot,
      projectId: "proj",
      active,
    });

    expect(reconciled).toBeNull();
  });

  it("resumes at review-tdd when blocked only for review-pr findings in blockers", async () => {
    const { projectPath, stateRoot, active } =
      await setupWorktreeHandoff("done");
    const branch = active.branch;
    const handoffDir = join(
      projectPath,
      ".sandcastle",
      "worktrees",
      branch,
      ".sandcastle-ralph",
      "handoff",
    );
    await writeFile(
      join(handoffDir, "current.json"),
      JSON.stringify(
        {
          project: "HaDuve/FantasyEconomySim",
          issue: 29,
          branch,
          phase: "review-pr",
          acceptanceState: "done",
          verdict: "request-changes",
          blockers: ["Required check lint failed"],
          mergeReady: false,
          nextSkill: "/review-tdd",
          pr: 55,
          startedAt: "2026-06-01T00:00:00.000Z",
          endedAt: "2026-06-01T01:00:00.000Z",
        },
        null,
        2,
      ) + "\n",
    );

    const reviewPrActive: ActiveState = {
      issue: 29,
      phase: "review-pr",
      branch,
      pr: 55,
      status: "blocked",
      reason: "Handoff has blockers: Required check lint failed",
      resumeSkill: "/review-pr",
      startedAt: active.startedAt,
    };

    const reconciled = await tryReconcileReviewPrBlockedHandoff({
      projectPath,
      branch,
      stateRoot,
      projectId: "proj",
      active: reviewPrActive,
    });

    expect(reconciled).toEqual({
      issue: 29,
      phase: "review-tdd",
      branch,
      pr: 55,
      status: "active",
      startedAt: reviewPrActive.startedAt,
      reason:
        "Review findings (addressed in review-tdd): Required check lint failed",
    });
  });

  it("resumes without verdict when nextSkill routes to review-tdd", async () => {
    const { projectPath, stateRoot, active } =
      await setupWorktreeHandoff("done");
    const branch = active.branch;
    const handoffDir = join(
      projectPath,
      ".sandcastle",
      "worktrees",
      branch,
      ".sandcastle-ralph",
      "handoff",
    );
    await writeFile(
      join(handoffDir, "current.json"),
      JSON.stringify(
        {
          project: "HaDuve/FantasyEconomySim",
          issue: 29,
          branch,
          phase: "review-pr",
          acceptanceState: "done",
          blockers: ["missing test"],
          mergeReady: false,
          nextSkill: "/review-tdd",
          pr: 55,
          startedAt: "2026-06-01T00:00:00.000Z",
          endedAt: "2026-06-01T01:00:00.000Z",
        },
        null,
        2,
      ) + "\n",
    );

    const reconciled = await tryReconcileReviewPrBlockedHandoff({
      projectPath,
      branch,
      stateRoot,
      projectId: "proj",
      active: {
        issue: 29,
        phase: "review-pr",
        branch,
        pr: 55,
        status: "blocked",
        reason: "Handoff has blockers: missing test",
        resumeSkill: "/review-pr",
        startedAt: active.startedAt,
      },
    });

    expect(reconciled?.phase).toBe("review-tdd");
    expect(reconciled?.status).toBe("active");
  });

  it("resumes merge gate when blocked on no-approve after babysit wrote verdict n/a", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "reconcile-babysit-verdict-"));
    const stateRoot = join(rootDir, "state");
    const projectId = "HaDuve/SandcastleRalphAuto";
    await writeHostHandoff({
      stateRoot,
      projectId,
      handoff: {
        project: projectId,
        issue: 80,
        branch: "issue-80",
        pr: 87,
        phase: "babysit",
        acceptanceState: "done",
        verdict: "n/a",
        blockers: [],
        mergeReady: true,
        nextSkill: "/merge",
        startedAt: "2026-06-01T00:00:00.000Z",
        endedAt: "2026-06-01T01:00:00.000Z",
      } satisfies Handoff,
    });
    await writeActive(
      projectId,
      {
        issue: 80,
        phase: "merge",
        branch: "issue-80",
        pr: 87,
        status: "blocked",
        reason: "Merge gate requires a clean Approve verdict",
        resumeSkill: "/merge",
      },
      stateRoot,
    );

    const resumed = await tryReconcileMergeGateBlockedHandoff({
      project: { autoMerge: true, remote: projectId },
      stateRoot,
      projectId,
      active: {
        issue: 80,
        phase: "merge",
        branch: "issue-80",
        pr: 87,
        status: "blocked",
        reason: "Merge gate requires a clean Approve verdict",
        resumeSkill: "/merge",
      },
      gh: async (args) => {
        if (args[0] !== "pr") {
          return "";
        }
        if (args[1] === "view") {
          const jsonFlag = args.indexOf("--json");
          const fields =
            jsonFlag === -1 ? "" : (args[jsonFlag + 1] ?? "");
          if (fields.includes("state")) {
            return JSON.stringify({ state: "OPEN" });
          }
          if (fields.includes("mergeable")) {
            return JSON.stringify({
              mergeable: "MERGEABLE",
              mergeStateStatus: "CLEAN",
            });
          }
        }
        if (args[1] === "checks") {
          return JSON.stringify([
            { name: "ci", state: "SUCCESS", bucket: "pass", link: "" },
          ]);
        }
        return "";
      },
    });

    expect(resumed).toEqual({ issue: 80, pr: 87 });
    await expect(access(resolveActivePath(stateRoot, projectId))).rejects.toThrow();
  });

  it("resumes merge gate + next when blocked on no-approve but PR is merged", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "reconcile-merge-gate-"));
    const stateRoot = join(rootDir, "state");
    const projectId = "HaDuve/FantasyEconomySim";
    const handoff = {
      project: projectId,
      issue: 32,
      branch: "issue-32",
      pr: 43,
      phase: "merge",
      acceptanceState: "done",
      verdict: "n/a",
      blockers: [],
      mergeReady: true,
      nextSkill: "/next",
      startedAt: "2026-06-01T00:00:00.000Z",
      endedAt: "2026-06-01T01:00:00.000Z",
    } satisfies Handoff;
    await writeHostHandoff({ stateRoot, projectId, handoff });
    const active: ActiveState = {
      issue: 32,
      phase: "merge",
      branch: "issue-32",
      pr: 43,
      status: "blocked",
      reason: MERGE_GATE_NO_APPROVE_REASON,
      resumeSkill: "/merge",
    };
    await writeActive(projectId, active, stateRoot);

    const resumed = await tryReconcileMergeGateBlockedHandoff({
      project: { autoMerge: true, remote: projectId },
      stateRoot,
      projectId,
      active,
      gh: async (args) => {
        if (args[0] === "pr" && args[1] === "view" && args.includes("state")) {
          return JSON.stringify({ state: "MERGED" });
        }
        return "";
      },
    });

    expect(resumed).toEqual({ issue: 32, pr: 43 });
    await expect(access(resolveActivePath(stateRoot, projectId))).rejects.toThrow();
  });

  it("resumes at merge when review-tdd blocked only for procedural merge reasons", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "reconcile-review-tdd-proc-"));
    const stateRoot = join(rootDir, "state");
    const projectId = "HaDuve/SandcastleRalphAuto";
    const handoff = {
      project: projectId,
      issue: 99,
      branch: "issue-99",
      pr: 111,
      phase: "review-tdd",
      acceptanceState: "blocked",
      blockers: ["PR author cannot submit an approving review (branch protection)"],
      mergeReady: false,
      nextSkill: "/merge",
      startedAt: "2026-06-01T00:00:00.000Z",
      endedAt: "2026-06-01T01:00:00.000Z",
    } satisfies Handoff;
    await writeHostHandoff({ stateRoot, projectId, handoff });

    const active: ActiveState = {
      issue: 99,
      phase: "review-tdd",
      branch: "issue-99",
      pr: 111,
      status: "blocked",
      reason: "Handoff acceptanceState is blocked, expected done",
      resumeSkill: "/review-tdd",
      startedAt: "2026-06-01T00:00:00.000Z",
    };
    await writeActive(projectId, active, stateRoot);

    const reconciled = await tryReconcileReviewTddProceduralBlockedHandoff({
      projectPath: join(rootDir, "repo"),
      branch: "issue-99",
      stateRoot,
      projectId,
      active,
    });

    expect(reconciled).toEqual({
      issue: 99,
      branch: "issue-99",
      pr: 111,
      phase: "merge",
      status: "active",
      startedAt: active.startedAt,
    });
  });

  it("resumes at babysit when merge stalled on blocked acceptance with conflict handoff", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "reconcile-merge-babysit-"));
    const stateRoot = join(rootDir, "state");
    const projectId = "HaDuve/SandcastleRalphAuto";
    const handoff = {
      project: projectId,
      issue: 80,
      branch: "issue-80",
      pr: 87,
      phase: "merge",
      acceptanceState: "blocked",
      verdict: "approve",
      blockers: [
        "PR #87 not mergeable: mergeStateStatus DIRTY — merge conflict with main",
      ],
      mergeReady: false,
      nextSkill: "/next",
      startedAt: "2026-06-01T00:00:00.000Z",
      endedAt: "2026-06-01T01:00:00.000Z",
    } satisfies Handoff;
    await writeHostHandoff({ stateRoot, projectId, handoff });

    const active: ActiveState = {
      issue: 80,
      phase: "merge",
      branch: "issue-80",
      pr: 87,
      status: "blocked",
      reason: "Handoff acceptanceState is blocked, expected done",
      resumeSkill: "/merge",
      startedAt: "2026-06-01T00:00:00.000Z",
    };
    await writeActive(projectId, active, stateRoot);

    const reconciled = await tryReconcileMergeDeferredBabysitHandoff({
      projectPath: join(rootDir, "repo"),
      branch: "issue-80",
      stateRoot,
      projectId,
      active,
    });

    expect(reconciled).toEqual({
      issue: 80,
      branch: "issue-80",
      pr: 87,
      phase: "babysit",
      status: "active",
      startedAt: active.startedAt,
    });
  });

  it("resumes at review-pr when merge blocked acceptance routes back to review-tdd", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "reconcile-merge-review-loop-"));
    const stateRoot = join(rootDir, "state");
    const projectId = "HaDuve/SandcastleRalphAuto";
    const handoff = {
      project: projectId,
      issue: 101,
      branch: "issue-101",
      pr: 113,
      phase: "merge",
      acceptanceState: "blocked",
      verdict: "request-changes",
      blockers: ["Live server tail is not wired"],
      mergeReady: false,
      nextSkill: "/review-tdd",
      startedAt: "2026-06-02T14:23:30.839Z",
      endedAt: "2026-06-02T14:24:00.000Z",
    } satisfies Handoff;
    await writeHostHandoff({ stateRoot, projectId, handoff });

    const active: ActiveState = {
      issue: 101,
      phase: "merge",
      branch: "issue-101",
      pr: 113,
      status: "blocked",
      reason: "Handoff acceptanceState is blocked, expected done",
      resumeSkill: "/merge",
      startedAt: "2026-06-02T14:23:30.839Z",
    };
    await writeActive(projectId, active, stateRoot);

    const reconciled = await tryReconcileMergeDeferredReviewLoopHandoff({
      projectPath: join(rootDir, "repo"),
      branch: "issue-101",
      stateRoot,
      projectId,
      active,
    });

    expect(reconciled).toEqual({
      issue: 101,
      branch: "issue-101",
      pr: 113,
      phase: "review-pr",
      status: "active",
      startedAt: active.startedAt,
    });
  });

  it("resumes at review-tdd when review-pr blocked only for procedural reasons", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "reconcile-review-pr-proc-"));
    const stateRoot = join(rootDir, "state");
    const projectId = "HaDuve/SandcastleRalphAuto";
    const handoff = {
      project: projectId,
      issue: 101,
      branch: "issue-101",
      pr: 113,
      phase: "review-pr",
      acceptanceState: "blocked",
      blockers: ["Different maintainer must approve PR #113"],
      mergeReady: false,
      nextSkill: "/review-tdd",
      startedAt: "2026-06-01T00:00:00.000Z",
      endedAt: "2026-06-01T01:00:00.000Z",
    } satisfies Handoff;
    await writeHostHandoff({ stateRoot, projectId, handoff });

    const active: ActiveState = {
      issue: 101,
      phase: "review-pr",
      branch: "issue-101",
      pr: 113,
      status: "blocked",
      reason: "Handoff acceptanceState is blocked, expected done",
      resumeSkill: "/review-pr",
      startedAt: "2026-06-01T00:00:00.000Z",
    };
    await writeActive(projectId, active, stateRoot);

    const reconciled = await tryReconcileReviewPrProceduralBlockedHandoff({
      projectPath: join(rootDir, "repo"),
      branch: "issue-101",
      stateRoot,
      projectId,
      active,
    });

    expect(reconciled?.phase).toBe("review-tdd");
    const host = await readHostHandoff({ stateRoot, projectId });
    expect(host.acceptanceState).toBe("done");
    expect(host.blockers).toEqual([]);
  });

  it("starts merged-tail recovery when PR is merged and pipeline incomplete", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "reconcile-merged-tail-"));
    const stateRoot = join(rootDir, "state");
    const projectId = "HaDuve/SandcastleRalphAuto";
    const handoff = {
      project: projectId,
      issue: 101,
      branch: "issue-101",
      pr: 113,
      phase: "review-pr",
      acceptanceState: "blocked",
      blockers: ["Different maintainer must approve"],
      mergeReady: false,
      nextSkill: "/review-tdd",
      startedAt: "2026-06-01T00:00:00.000Z",
      endedAt: "2026-06-01T01:00:00.000Z",
    } satisfies Handoff;
    await writeHostHandoff({ stateRoot, projectId, handoff });

    const active: ActiveState = {
      issue: 101,
      phase: "review-pr",
      branch: "issue-101",
      pr: 113,
      status: "blocked",
      reason: "Handoff acceptanceState is blocked, expected done",
      resumeSkill: "/review-pr",
      startedAt: "2026-06-01T00:00:00.000Z",
    };
    await writeActive(projectId, active, stateRoot);

    const resumed = await tryReconcileMergedTailBlockedHandoff({
      project: { remote: projectId },
      projectPath: join(rootDir, "repo"),
      branch: "issue-101",
      stateRoot,
      projectId,
      active,
      gh: async (args) => {
        if (args[0] === "pr" && args[1] === "view" && args.includes("state")) {
          return JSON.stringify({ state: "MERGED" });
        }
        return "";
      },
    });

    expect(resumed).toMatchObject({
      issue: 101,
      pr: 113,
      fromPhase: "review-pr",
      mergedTailReview: true,
    });
    const host = await readHostHandoff({ stateRoot, projectId });
    expect(host.mergedTailAttempts).toBe(1);
  });
});

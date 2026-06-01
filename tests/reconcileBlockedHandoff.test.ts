import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isHandoffSchemaBlockReason,
  tryReconcileReviewPrBlockedHandoff,
  tryReconcileSchemaBlockedHandoff,
} from "../src/handoff/reconcileBlockedHandoff.js";
import { readHostHandoff } from "../src/handoff/hostStore.js";
import { readHandoff } from "../src/handoff/io.js";
import { writeActive, type ActiveState } from "../src/state/index.js";

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
    });
  });
});

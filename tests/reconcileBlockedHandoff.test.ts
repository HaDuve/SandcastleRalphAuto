import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isHandoffSchemaBlockReason,
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
});

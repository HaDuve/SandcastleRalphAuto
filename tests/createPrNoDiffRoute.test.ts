import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  confirmsCreatePrNoDiffAtWorktree,
  isCreatePrNoDiffBlockedHandoff,
  isCreatePrNoDiffDoneHandoff,
  isCreatePrNoDiffStallReason,
  normalizeCreatePrNoDiffHandoff,
} from "../src/handoff/createPrNoDiffRoute.js";
import type { GitRunner } from "../src/handoff/worktreeNoDiff.js";
import type { Handoff } from "../src/handoff/schema.js";

const baseHandoff = {
  project: "HaDuve/SandcastleRalphAuto",
  issue: 95,
  branch: "issue-95",
  phase: "create-pr",
  mergeReady: false,
  startedAt: "2026-06-02T06:53:30.322Z",
  endedAt: "2026-06-02T06:54:00.000Z",
} satisfies Omit<Handoff, "acceptanceState" | "blockers" | "nextSkill">;

describe("createPrNoDiffRoute", () => {
  it("detects the host stall reason for blocked create-pr handoffs", () => {
    expect(
      isCreatePrNoDiffStallReason(
        "Handoff acceptanceState is blocked, expected done",
        "create-pr",
      ),
    ).toBe(true);
    expect(
      isCreatePrNoDiffStallReason(
        "Handoff acceptanceState is blocked, expected done",
        "tdd",
      ),
    ).toBe(false);
  });

  it("recognizes agent no-diff blockers on create-pr", () => {
    const handoff = {
      ...baseHandoff,
      acceptanceState: "blocked",
      blockers: [
        "No PR was created: branch issue-95 has 0 commits vs origin/main",
      ],
      nextSkill: "/review-pr",
    } satisfies Handoff;

    expect(isCreatePrNoDiffBlockedHandoff(handoff)).toBe(true);
    expect(
      isCreatePrNoDiffDoneHandoff(normalizeCreatePrNoDiffHandoff(handoff)),
    ).toBe(true);
  });

  it("confirms no-diff only when git and handoff agree", async () => {
    const worktreePath = await mkdtemp(join(tmpdir(), "nodiff-wt-"));
    const git: GitRunner = async (args) => {
      if (args[0] === "rev-list") {
        return { stdout: "0\n", exitCode: 0 };
      }
      if (args[0] === "diff") {
        return { stdout: "", exitCode: 0 };
      }
      return { stdout: "", exitCode: 1 };
    };
    const handoff = {
      ...baseHandoff,
      acceptanceState: "blocked",
      blockers: ["No PR was created: 0 commits vs origin/main"],
      nextSkill: "/review-pr",
    } satisfies Handoff;

    expect(
      await confirmsCreatePrNoDiffAtWorktree(handoff, worktreePath, git),
    ).toBe(true);
    expect(
      await confirmsCreatePrNoDiffAtWorktree(
        { ...handoff, blockers: ["unrelated blocker"] },
        worktreePath,
        git,
      ),
    ).toBe(true);
  });

  it("falls back to blocker text when worktree is missing", async () => {
    const handoff = {
      ...baseHandoff,
      acceptanceState: "blocked",
      blockers: ["0 commits vs origin/main"],
      nextSkill: "/review-pr",
    } satisfies Handoff;

    expect(
      await confirmsCreatePrNoDiffAtWorktree(
        handoff,
        "/tmp/does-not-exist-very-likely",
        undefined,
      ),
    ).toBe(true);
    expect(
      await confirmsCreatePrNoDiffAtWorktree(
        { ...handoff, blockers: ["some other failure"] },
        "/tmp/does-not-exist-very-likely",
        undefined,
      ),
    ).toBe(false);
  });

  it("normalizes blocked no-diff handoff to done with nextSkill /next", () => {
    const handoff = {
      ...baseHandoff,
      acceptanceState: "blocked",
      blockers: ["0 commits vs origin/main"],
      nextSkill: "/review-pr",
    } satisfies Handoff;

    expect(normalizeCreatePrNoDiffHandoff(handoff)).toMatchObject({
      acceptanceState: "done",
      blockers: [],
      nextSkill: "/next",
      pr: undefined,
    });
  });
});

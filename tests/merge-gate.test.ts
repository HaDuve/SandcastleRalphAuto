import { describe, expect, it } from "vitest";
import { type Handoff } from "../src/handoff/index.js";
import { runMergeGate, activeStateFromMergeGate } from "../src/merge/index.js";
import { type Project } from "../src/registry/index.js";

function mergeHandoff(overrides: Partial<Handoff> = {}): Handoff {
  return {
    project: "HaDuve/SandcastleRalphAuto",
    issue: 8,
    branch: "issue-8-merge-gate",
    pr: 42,
    phase: "merge",
    acceptanceState: "done",
    verdict: "approve",
    blockers: [],
    mergeReady: true,
    nextSkill: "/next",
    startedAt: "2026-06-01T00:00:00.000Z",
    endedAt: "2026-06-01T01:00:00.000Z",
    ...overrides,
  };
}

const project: Pick<Project, "autoMerge"> = {
  autoMerge: true,
};

describe("runMergeGate", () => {
  it("merges via gh when Approve, no blockers, green required checks, and autoMerge", async () => {
    const ghCalls: string[][] = [];
    const result = await runMergeGate(
      { handoff: mergeHandoff(), project, pr: 42 },
      {
        gh: async (args) => {
          ghCalls.push(args);
          if (args[0] === "pr" && args[1] === "checks") {
            return JSON.stringify([
              { name: "ci", state: "SUCCESS", bucket: "pass", link: "" },
            ]);
          }
          return "";
        },
      },
    );

    expect(result).toEqual({ status: "auto-merge-queued" });
    expect(ghCalls).toContainEqual([
      "pr",
      "checks",
      "42",
      "--required",
      "--json",
      "name,state,bucket,link",
    ]);
    expect(ghCalls).toContainEqual([
      "pr",
      "merge",
      "42",
      "--squash",
      "--auto",
    ]);
    expect(ghCalls.flat()).not.toContain("--admin");
  });

  it("stops with awaiting-human when autoMerge is disabled", async () => {
    const ghCalls: string[][] = [];

    const result = await runMergeGate(
      {
        handoff: mergeHandoff(),
        project: { ...project, autoMerge: false },
        pr: 42,
      },
      {
        gh: async (args) => {
          ghCalls.push(args);
          return "[]";
        },
      },
    );

    expect(result).toEqual({
      status: "awaiting-human",
      reason: "autoMerge is disabled for this project",
    });
    expect(ghCalls).toHaveLength(0);
  });

  it("blocks when a required check is not green", async () => {
    const ghCalls: string[][] = [];

    const result = await runMergeGate(
      { handoff: mergeHandoff(), project, pr: 42 },
      {
        gh: async (args) => {
          ghCalls.push(args);
          if (args[0] === "pr" && args[1] === "checks") {
            return JSON.stringify([
              { name: "ci", state: "FAILURE", bucket: "fail", link: "" },
            ]);
          }
          return "";
        },
      },
    );

    expect(result).toEqual({
      status: "blocked",
      reason: "Required checks not green: ci",
      resumeSkill: "/merge",
    });
    expect(ghCalls.some((args) => args[1] === "merge")).toBe(false);
  });

  it("blocks when the handoff has open blockers", async () => {
    const ghCalls: string[][] = [];

    const result = await runMergeGate(
      {
        handoff: mergeHandoff({ blockers: ["missing tests"] }),
        project,
        pr: 42,
      },
      {
        gh: async (args) => {
          ghCalls.push(args);
          return "[]";
        },
      },
    );

    expect(result).toEqual({
      status: "blocked",
      reason: "Open blockers: missing tests",
      resumeSkill: "/merge",
    });
    expect(ghCalls).toHaveLength(0);
  });

  it("blocks when the verdict is not Approve", async () => {
    const ghCalls: string[][] = [];

    const result = await runMergeGate(
      {
        handoff: mergeHandoff({ verdict: "request-changes" }),
        project,
        pr: 42,
      },
      {
        gh: async (args) => {
          ghCalls.push(args);
          return "[]";
        },
      },
    );

    expect(result).toEqual({
      status: "blocked",
      reason: "Merge gate requires a clean Approve verdict",
      resumeSkill: "/merge",
    });
    expect(ghCalls).toHaveLength(0);
  });

  it("blocks when a required check is still pending", async () => {
    const ghCalls: string[][] = [];

    const result = await runMergeGate(
      { handoff: mergeHandoff(), project, pr: 42 },
      {
        gh: async (args) => {
          ghCalls.push(args);
          if (args[0] === "pr" && args[1] === "checks") {
            return JSON.stringify([
              { name: "ci", state: "PENDING", bucket: "pending", link: "" },
            ]);
          }
          return "";
        },
      },
    );

    expect(result).toEqual({
      status: "blocked",
      reason: "Required checks not green: ci",
      resumeSkill: "/merge",
    });
    expect(ghCalls.some((args) => args[1] === "merge")).toBe(false);
  });

  it("blocks when gh returns malformed checks JSON", async () => {
    const ghCalls: string[][] = [];

    const result = await runMergeGate(
      { handoff: mergeHandoff(), project, pr: 42 },
      {
        gh: async (args) => {
          ghCalls.push(args);
          if (args[0] === "pr" && args[1] === "checks") {
            return "not json";
          }
          return "";
        },
      },
    );

    expect(result).toEqual({
      status: "blocked",
      reason: "Could not parse required checks from gh",
      resumeSkill: "/merge",
    });
    expect(ghCalls.some((args) => args[1] === "merge")).toBe(false);
  });
});

describe("activeStateFromMergeGate", () => {
  const context = {
    issue: 8,
    branch: "issue-8-merge-gate",
    pr: 42,
  };

  it("returns null when auto-merge is queued", () => {
    expect(
      activeStateFromMergeGate(context, { status: "auto-merge-queued" }),
    ).toBeNull();
  });

  it("maps awaiting-human to active state with reason", () => {
    expect(
      activeStateFromMergeGate(context, {
        status: "awaiting-human",
        reason: "autoMerge is disabled for this project",
      }),
    ).toEqual({
      issue: 8,
      phase: "merge",
      branch: "issue-8-merge-gate",
      pr: 42,
      status: "awaiting-human",
      reason: "autoMerge is disabled for this project",
    });
  });

  it("maps blocked to active state with reason and resume skill", () => {
    expect(
      activeStateFromMergeGate(context, {
        status: "blocked",
        reason: "Required checks not green: ci",
        resumeSkill: "/merge",
      }),
    ).toEqual({
      issue: 8,
      phase: "merge",
      branch: "issue-8-merge-gate",
      pr: 42,
      status: "blocked",
      reason: "Required checks not green: ci",
      resumeSkill: "/merge",
    });
  });
});

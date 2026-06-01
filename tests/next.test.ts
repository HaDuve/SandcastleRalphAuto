import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Handoff } from "../src/handoff/index.js";
import { runNext, selectNextIssue, type GhIssue } from "../src/next/index.js";
import { type Project } from "../src/registry/index.js";

const project: Pick<Project, "afkLabel" | "blockedLabels"> = {
  afkLabel: "ready-for-agent",
  blockedLabels: [
    "needs-info",
    "ready-for-human",
    "HITL",
    "wontfix",
    "needs-triage",
  ],
};

function issue(
  number: number,
  labels: string[],
  state: GhIssue["state"] = "OPEN",
): GhIssue {
  return {
    number,
    state,
    labels: labels.map((name) => ({ name })),
  };
}

describe("selectNextIssue", () => {
  it("returns the lowest open eligible issue number", () => {
    const issues = [
      issue(12, ["ready-for-agent"]),
      issue(9, ["ready-for-agent"]),
      issue(15, ["ready-for-agent"]),
    ];

    expect(selectNextIssue(issues, project, [])).toBe(9);
  });

  it("excludes issues with blocked labels", () => {
    const issues = [
      issue(9, ["ready-for-agent", "needs-info"]),
      issue(10, ["ready-for-agent"]),
    ];

    expect(selectNextIssue(issues, project, [])).toBe(10);
  });

  it("excludes issues without the afk label", () => {
    const issues = [
      issue(9, ["M1-engine"]),
      issue(10, ["ready-for-agent"]),
    ];

    expect(selectNextIssue(issues, project, [])).toBe(10);
  });

  it("excludes skipped issue numbers", () => {
    const issues = [
      issue(9, ["ready-for-agent"]),
      issue(10, ["ready-for-agent"]),
    ];

    expect(selectNextIssue(issues, project, [9])).toBe(10);
  });

  it("returns null when no eligible issues remain", () => {
    const issues = [
      issue(9, ["ready-for-agent", "HITL"]),
      issue(10, ["ready-for-agent"]),
    ];

    expect(selectNextIssue(issues, project, [10])).toBeNull();
  });
});

const fullProject: Project = {
  id: "sandcastle",
  path: "/tmp/sandcastle",
  remote: "HaDuve/SandcastleRalphAuto",
  defaultBase: "main",
  afkLabel: "ready-for-agent",
  blockedLabels: [
    "needs-info",
    "ready-for-human",
    "HITL",
    "wontfix",
    "needs-triage",
  ],
  autoMerge: true,
  concurrency: "single",
  sandbox: "none",
};

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

describe("runNext", () => {
  it("blocks when the prior PR is not merged", async () => {
    const ghCalls: string[][] = [];

    const result = await runNext(
      {
        project: fullProject,
        projectPath: "/tmp/sandcastle",
        stateRoot: "/tmp/state",
        pr: 42,
      },
      {
        gh: async (args) => {
          ghCalls.push(args);
          if (args[0] === "pr" && args[1] === "view") {
            return JSON.stringify({ state: "OPEN" });
          }
          return "[]";
        },
        readSkips: async () => [],
        archiveHandoff: async () => "unused",
        writeHandoff: async () => {},
        writeActive: async () => {},
        startTdd: async () => {},
      },
    );

    expect(result).toEqual({
      status: "blocked",
      reason: "PR #42 is not merged (state: OPEN)",
    });
    expect(ghCalls.some((args) => args[0] === "issue")).toBe(false);
  });

  it("archives handoff and starts tdd for the lowest eligible issue", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "next-test-"));
    const stateRoot = await mkdtemp(join(tmpdir(), "next-state-"));
    const handoffDir = join(rootDir, ".sandcastle-ralph/handoff");
    await mkdir(handoffDir, { recursive: true });
    await writeFile(
      join(handoffDir, "current.json"),
      JSON.stringify(mergeHandoff(), null, 2),
    );

    const ghCalls: string[][] = [];
    let archived = false;
    let startedTdd: { issue: number; branch: string } | undefined;
    let writtenHandoff: Handoff | undefined;
    let writtenActive: unknown;

    const result = await runNext(
      {
        project: fullProject,
        projectPath: rootDir,
        stateRoot,
        pr: 42,
        handoffRoot: rootDir,
      },
      {
        gh: async (args) => {
          ghCalls.push(args);
          if (args[0] === "pr" && args[1] === "view") {
            return JSON.stringify({ state: "MERGED" });
          }
          if (args[0] === "issue" && args[1] === "list") {
            return JSON.stringify([
              {
                number: 12,
                state: "OPEN",
                labels: [{ name: "ready-for-agent" }],
              },
              {
                number: 9,
                state: "OPEN",
                labels: [{ name: "ready-for-agent" }],
              },
            ]);
          }
          return "";
        },
        readSkips: async () => [],
        archiveHandoff: async (dir) => {
          archived = true;
          expect(dir).toBe(rootDir);
          return join(dir, ".sandcastle-ralph/handoff/history/42.json");
        },
        writeHandoff: async (handoff) => {
          writtenHandoff = handoff;
        },
        writeActive: async (_projectId, active) => {
          writtenActive = active;
        },
        startTdd: async ({ issue, branch }) => {
          startedTdd = { issue, branch };
        },
        now: () => new Date("2026-06-01T12:00:00.000Z"),
      },
    );

    expect(result).toEqual({
      status: "started",
      issue: 9,
      branch: "issue-9",
    });
    expect(archived).toBe(true);
    expect(startedTdd).toEqual({ issue: 9, branch: "issue-9" });
    expect(writtenHandoff).toMatchObject({
      project: "HaDuve/SandcastleRalphAuto",
      issue: 9,
      branch: "issue-9",
      phase: "tdd",
      acceptanceState: "in-progress",
      nextSkill: "/create-pr",
    });
    expect(writtenActive).toEqual({
      issue: 9,
      phase: "tdd",
      branch: "issue-9",
      status: "active",
    });
    expect(ghCalls).toContainEqual([
      "pr",
      "view",
      "42",
      "--repo",
      "HaDuve/SandcastleRalphAuto",
      "--json",
      "state",
    ]);
    expect(ghCalls).toContainEqual([
      "issue",
      "list",
      "--repo",
      "HaDuve/SandcastleRalphAuto",
      "--state",
      "open",
      "--label",
      "ready-for-agent",
      "--json",
      "number,labels,state",
    ]);
  });

  it("returns queue-empty when no eligible issues remain", async () => {
    const ghCalls: string[][] = [];
    let startTddCalled = false;

    const result = await runNext(
      {
        project: fullProject,
        projectPath: "/tmp/sandcastle",
        stateRoot: "/tmp/state",
        pr: 42,
      },
      {
        gh: async (args) => {
          ghCalls.push(args);
          if (args[0] === "pr" && args[1] === "view") {
            return JSON.stringify({ state: "MERGED" });
          }
          if (args[0] === "issue" && args[1] === "list") {
            return JSON.stringify([
              {
                number: 9,
                state: "OPEN",
                labels: [
                  { name: "ready-for-agent" },
                  { name: "HITL" },
                ],
              },
            ]);
          }
          return "";
        },
        readSkips: async () => [],
        archiveHandoff: async () => "archived",
        writeHandoff: async () => {},
        writeActive: async () => {},
        startTdd: async () => {
          startTddCalled = true;
        },
      },
    );

    expect(result).toEqual({ status: "queue-empty" });
    expect(startTddCalled).toBe(false);
  });

  it("excludes skipped issues when selecting the next slice", async () => {
    let startedTdd: { issue: number } | undefined;

    const result = await runNext(
      {
        project: fullProject,
        projectPath: "/tmp/sandcastle",
        stateRoot: "/tmp/state",
        pr: 42,
      },
      {
        gh: async (args) => {
          if (args[0] === "pr" && args[1] === "view") {
            return JSON.stringify({ state: "MERGED" });
          }
          if (args[0] === "issue" && args[1] === "list") {
            return JSON.stringify([
              {
                number: 9,
                state: "OPEN",
                labels: [{ name: "ready-for-agent" }],
              },
              {
                number: 10,
                state: "OPEN",
                labels: [{ name: "ready-for-agent" }],
              },
            ]);
          }
          return "";
        },
        readSkips: async () => [9],
        archiveHandoff: async () => "archived",
        writeHandoff: async () => {},
        writeActive: async () => {},
        startTdd: async ({ issue }) => {
          startedTdd = { issue };
        },
      },
    );

    expect(result).toEqual({
      status: "started",
      issue: 10,
      branch: "issue-10",
    });
    expect(startedTdd).toEqual({ issue: 10 });
  });
});

import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Handoff, writeHandoff } from "../src/handoff/index.js";
import {
  DEFAULT_TDD_MAX_ITERATIONS,
  PHASE_COMPLETE_SIGNAL,
  resolveOrchestratorRoot,
  runPhase,
  type RunPhaseDeps,
  type SandcastleRunOptions,
  type SandcastleRunResult,
} from "../src/runner/index.js";

const sampleHandoff: Handoff = {
  project: "HaDuve/SandcastleRalphAuto",
  issue: 6,
  branch: "issue-6-runner",
  phase: "create-pr",
  acceptanceState: "done",
  blockers: [],
  mergeReady: false,
  nextSkill: "/review-pr",
  startedAt: "2026-06-01T00:00:00.000Z",
  endedAt: "2026-06-01T01:00:00.000Z",
};

function mockAgent(): ReturnType<RunPhaseDeps["cursor"]> {
  return { name: "cursor-auto" } as ReturnType<RunPhaseDeps["cursor"]>;
}

function mockSandbox(name = "none"): ReturnType<RunPhaseDeps["noSandbox"]> {
  return { name, tag: "none" } as unknown as ReturnType<
    RunPhaseDeps["noSandbox"]
  >;
}

function createMockDeps(
  runImpl: (options: SandcastleRunOptions) => Promise<SandcastleRunResult>,
): RunPhaseDeps {
  return {
    run: runImpl,
    cursor: () => mockAgent(),
    noSandbox: () => mockSandbox(),
    readHandoff: async (rootDir) => {
      const { readHandoff } = await import("../src/handoff/index.js");
      return readHandoff(rootDir);
    },
  };
}

describe("runPhase", () => {
  it("invokes Sandcastle run with cursor auto, noSandbox, branch strategy, and phase completion signal", async () => {
    const runCalls: SandcastleRunOptions[] = [];
    const projectPath = await mkdtemp(join(tmpdir(), "runner-test-"));
    const promptFile = join(projectPath, "prompts", "create-pr.md");
    await mkdir(join(projectPath, "prompts"), { recursive: true });
    await writeFile(promptFile, "# create-pr\n");
    await writeHandoff(sampleHandoff, projectPath);

    const deps = createMockDeps(async (options) => {
      runCalls.push(options);
      return {
        commits: [{ sha: "abc123" }],
        branch: "issue-6-runner",
        completionSignal: PHASE_COMPLETE_SIGNAL,
        logFilePath: join(projectPath, "run.log"),
        iterations: [],
        stdout: "",
      };
    });

    await runPhase(
      {
        phase: "create-pr",
        branch: "issue-6-runner",
        projectPath,
        promptFile,
      },
      deps,
    );

    expect(runCalls).toHaveLength(1);
    expect(runCalls[0]?.agent).toEqual(mockAgent());
    expect(runCalls[0]?.sandbox).toEqual(mockSandbox());
    expect(runCalls[0]?.branchStrategy).toEqual({
      type: "branch",
      branch: "issue-6-runner",
    });
    expect(runCalls[0]?.completionSignal).toBe(PHASE_COMPLETE_SIGNAL);
    expect(runCalls[0]?.cwd).toBe(projectPath);
    expect(runCalls[0]?.promptFile).toBe(promptFile);
    expect(runCalls[0]?.maxIterations).toBe(1);
  });

  it("uses tddMaxIterations for tdd and single-shot for other phases", async () => {
    const runCalls: SandcastleRunOptions[] = [];
    const projectPath = await mkdtemp(join(tmpdir(), "runner-test-"));
    const promptFile = join(projectPath, "prompts", "tdd.md");
    await mkdir(join(projectPath, "prompts"), { recursive: true });
    await writeFile(promptFile, "# tdd\n");
    await writeHandoff({ ...sampleHandoff, phase: "tdd" }, projectPath);

    const deps = createMockDeps(async (options) => {
      runCalls.push(options);
      return {
        commits: [],
        branch: "issue-6-runner",
        iterations: [],
        stdout: "",
      };
    });

    await runPhase(
      {
        phase: "tdd",
        branch: "issue-6-runner",
        projectPath,
        promptFile,
        tddMaxIterations: 7,
      },
      deps,
    );

    expect(runCalls[0]?.maxIterations).toBe(7);

    runCalls.length = 0;
    await writeHandoff({ ...sampleHandoff, phase: "tdd" }, projectPath);

    await runPhase(
      {
        phase: "tdd",
        branch: "issue-6-runner",
        projectPath,
        promptFile,
      },
      deps,
    );

    expect(runCalls[0]?.maxIterations).toBe(DEFAULT_TDD_MAX_ITERATIONS);

    runCalls.length = 0;
    await writeHandoff({ ...sampleHandoff, phase: "merge" }, projectPath);

    await runPhase(
      {
        phase: "merge",
        branch: "issue-6-runner",
        projectPath,
        promptFile: join(projectPath, "prompts", "merge.md"),
        tddMaxIterations: 7,
      },
      deps,
    );

    expect(runCalls[0]?.maxIterations).toBe(1);
  });

  it("threads AbortSignal to Sandcastle run for the kill switch", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "runner-test-"));
    const promptFile = join(projectPath, "prompts", "create-pr.md");
    await mkdir(join(projectPath, "prompts"), { recursive: true });
    await writeFile(promptFile, "# create-pr\n");
    await writeHandoff(sampleHandoff, projectPath);

    const controller = new AbortController();
    const runCalls: SandcastleRunOptions[] = [];

    const deps = createMockDeps(async (options) => {
      runCalls.push(options);
      return {
        commits: [],
        branch: "issue-6-runner",
        iterations: [],
        stdout: "",
      };
    });

    await runPhase(
      {
        phase: "create-pr",
        branch: "issue-6-runner",
        projectPath,
        promptFile,
        signal: controller.signal,
      },
      deps,
    );

    expect(runCalls[0]?.signal).toBe(controller.signal);
  });

  it("returns run metadata and reads handoff from the preserved worktree", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "runner-test-"));
    const worktreePath = await mkdtemp(join(tmpdir(), "runner-worktree-"));
    const promptFile = join(projectPath, "prompts", "create-pr.md");
    await mkdir(join(projectPath, "prompts"), { recursive: true });
    await writeFile(promptFile, "# create-pr\n");
    await writeHandoff(sampleHandoff, worktreePath);

    const deps = createMockDeps(async () => ({
      commits: [{ sha: "deadbeef" }],
      branch: "issue-6-runner",
      completionSignal: PHASE_COMPLETE_SIGNAL,
      logFilePath: join(projectPath, "run.log"),
      preservedWorktreePath: worktreePath,
      iterations: [],
      stdout: "",
    }));

    const result = await runPhase(
      {
        phase: "create-pr",
        branch: "issue-6-runner",
        projectPath,
        promptFile,
      },
      deps,
    );

    expect(result).toEqual({
      commits: [{ sha: "deadbeef" }],
      branch: "issue-6-runner",
      completionSignal: PHASE_COMPLETE_SIGNAL,
      logFilePath: join(projectPath, "run.log"),
      handoff: sampleHandoff,
    });
  });

  it("accepts a configurable sandbox provider", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "runner-test-"));
    const promptFile = join(projectPath, "prompts", "create-pr.md");
    await mkdir(join(projectPath, "prompts"), { recursive: true });
    await writeFile(promptFile, "# create-pr\n");
    await writeHandoff(sampleHandoff, projectPath);

    const customSandbox = mockSandbox("custom");
    const runCalls: SandcastleRunOptions[] = [];

    const deps = createMockDeps(async (options) => {
      runCalls.push(options);
      return {
        commits: [],
        branch: "issue-6-runner",
        iterations: [],
        stdout: "",
      };
    });

    await runPhase(
      {
        phase: "create-pr",
        branch: "issue-6-runner",
        projectPath,
        promptFile,
        sandbox: customSandbox,
      },
      deps,
    );

    expect(runCalls[0]?.sandbox).toBe(customSandbox);
  });
});

describe("resolveOrchestratorRoot", () => {
  it("defaults to the repo root that contains prompts/", async () => {
    const root = resolveOrchestratorRoot();

    await expect(access(join(root, "prompts", "tdd.md"))).resolves.toBeUndefined();
  });
});

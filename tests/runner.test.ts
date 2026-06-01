import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Handoff, writeHandoff } from "../src/handoff/index.js";
import {
  CURSOR_TRUST_SETUP,
  DEFAULT_TDD_MAX_ITERATIONS,
  PHASE_COMPLETE_SIGNAL,
  resolveOrchestratorRoot,
  runPhase,
  type RunPhaseDeps,
  type SandcastleCreateSandboxOptions,
  type SandcastleSandboxRunOptions,
  type SandcastleSandboxRunResult,
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

type MockSandboxConfig = {
  worktreePath: string;
  branch?: string;
  runImpl: (
    options: SandcastleSandboxRunOptions,
  ) => Promise<SandcastleSandboxRunResult>;
  onClose?: () => void;
};

function createMockDeps(
  config: MockSandboxConfig,
  createSandboxCalls: SandcastleCreateSandboxOptions[] = [],
  runCalls: SandcastleSandboxRunOptions[] = [],
): RunPhaseDeps {
  return {
    createSandbox: async (options) => {
      createSandboxCalls.push(options);
      return {
        branch: config.branch ?? options.branch,
        worktreePath: config.worktreePath,
        run: async (runOptions) => {
          runCalls.push(runOptions);
          return config.runImpl(runOptions);
        },
        close: async () => {
          config.onClose?.();
          return {};
        },
      };
    },
    cursor: () => mockAgent(),
    noSandbox: () => mockSandbox(),
    readHandoff: async (rootDir) => {
      const { readHandoff } = await import("../src/handoff/index.js");
      return readHandoff(rootDir);
    },
  };
}

describe("runPhase", () => {
  it("invokes createSandbox and sandbox.run with cursor auto, noSandbox, and phase completion signal", async () => {
    const createSandboxCalls: SandcastleCreateSandboxOptions[] = [];
    const runCalls: SandcastleSandboxRunOptions[] = [];
    const projectPath = await mkdtemp(join(tmpdir(), "runner-test-"));
    const worktreePath = await mkdtemp(join(tmpdir(), "runner-worktree-"));
    const promptFile = join(projectPath, "prompts", "create-pr.md");
    await mkdir(join(projectPath, "prompts"), { recursive: true });
    await writeFile(promptFile, "# create-pr\n");
    await writeHandoff(sampleHandoff, worktreePath);

    const deps = createMockDeps(
      {
        worktreePath,
        runImpl: async () => ({
          commits: [{ sha: "abc123" }],
          completionSignal: PHASE_COMPLETE_SIGNAL,
          logFilePath: join(projectPath, "run.log"),
          iterations: [],
          stdout: "",
        }),
      },
      createSandboxCalls,
      runCalls,
    );

    await runPhase(
      {
        phase: "create-pr",
        branch: "issue-6-runner",
        projectPath,
        promptFile,
      },
      deps,
    );

    expect(createSandboxCalls).toEqual([
      {
        branch: "issue-6-runner",
        cwd: projectPath,
        sandbox: mockSandbox(),
      },
    ]);
    expect(runCalls).toHaveLength(1);
    expect(runCalls[0]?.agent).toEqual(mockAgent());
    expect(runCalls[0]?.completionSignal).toBe(PHASE_COMPLETE_SIGNAL);
    expect(runCalls[0]?.promptFile).toBe(promptFile);
    expect(runCalls[0]?.maxIterations).toBe(1);
  });

  it("resolves promptFile from orchestrator prompts when not overridden", async () => {
    const runCalls: SandcastleSandboxRunOptions[] = [];
    const projectPath = await mkdtemp(join(tmpdir(), "runner-test-"));
    const worktreePath = await mkdtemp(join(tmpdir(), "runner-worktree-"));
    await writeHandoff(sampleHandoff, worktreePath);
    const orchestratorRoot = resolveOrchestratorRoot();

    const deps = createMockDeps(
      {
        worktreePath,
        runImpl: async () => ({
          commits: [],
          iterations: [],
          stdout: "",
        }),
      },
      [],
      runCalls,
    );

    await runPhase(
      {
        phase: "review-pr",
        branch: "issue-6-runner",
        projectPath,
        orchestratorRoot,
      },
      deps,
    );

    expect(runCalls[0]?.promptFile).toBe(
      join(orchestratorRoot, "prompts", "review-pr.md"),
    );
  });

  it("uses tddMaxIterations for tdd and single-shot for other phases", async () => {
    const runCalls: SandcastleSandboxRunOptions[] = [];
    const projectPath = await mkdtemp(join(tmpdir(), "runner-test-"));
    const worktreePath = await mkdtemp(join(tmpdir(), "runner-worktree-"));
    const promptFile = join(projectPath, "prompts", "tdd.md");
    await mkdir(join(projectPath, "prompts"), { recursive: true });
    await writeFile(promptFile, "# tdd\n");
    await writeHandoff({ ...sampleHandoff, phase: "tdd" }, worktreePath);

    const deps = createMockDeps(
      {
        worktreePath,
        runImpl: async () => ({
          commits: [],
          iterations: [],
          stdout: "",
        }),
      },
      [],
      runCalls,
    );

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
    await writeHandoff({ ...sampleHandoff, phase: "merge" }, worktreePath);

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

  it("threads AbortSignal to sandbox.run for the kill switch", async () => {
    const runCalls: SandcastleSandboxRunOptions[] = [];
    const projectPath = await mkdtemp(join(tmpdir(), "runner-test-"));
    const worktreePath = await mkdtemp(join(tmpdir(), "runner-worktree-"));
    const promptFile = join(projectPath, "prompts", "create-pr.md");
    await mkdir(join(projectPath, "prompts"), { recursive: true });
    await writeFile(promptFile, "# create-pr\n");
    await writeHandoff(sampleHandoff, worktreePath);

    const controller = new AbortController();

    const deps = createMockDeps(
      {
        worktreePath,
        runImpl: async () => ({
          commits: [],
          iterations: [],
          stdout: "",
        }),
      },
      [],
      runCalls,
    );

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

  it("reads handoff from the worktree before sandbox teardown on a clean success path", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "runner-test-"));
    const worktreePath = await mkdtemp(join(tmpdir(), "runner-worktree-"));
    const promptFile = join(projectPath, "prompts", "create-pr.md");
    await mkdir(join(projectPath, "prompts"), { recursive: true });
    await writeFile(promptFile, "# create-pr\n");
    await writeHandoff(sampleHandoff, worktreePath);

    let closed = false;

    const deps = createMockDeps({
      worktreePath,
      onClose: () => {
        closed = true;
      },
      runImpl: async () => ({
        commits: [{ sha: "deadbeef" }],
        completionSignal: PHASE_COMPLETE_SIGNAL,
        logFilePath: join(projectPath, "run.log"),
        iterations: [],
        stdout: "",
      }),
    });

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
    expect(closed).toBe(true);
  });

  it("accepts a configurable sandbox provider", async () => {
    const createSandboxCalls: SandcastleCreateSandboxOptions[] = [];
    const projectPath = await mkdtemp(join(tmpdir(), "runner-test-"));
    const worktreePath = await mkdtemp(join(tmpdir(), "runner-worktree-"));
    const promptFile = join(projectPath, "prompts", "create-pr.md");
    await mkdir(join(projectPath, "prompts"), { recursive: true });
    await writeFile(promptFile, "# create-pr\n");
    await writeHandoff(sampleHandoff, worktreePath);

    const customSandbox = mockSandbox("custom");

    const deps = createMockDeps(
      {
        worktreePath,
        runImpl: async () => ({
          commits: [],
          iterations: [],
          stdout: "",
        }),
      },
      createSandboxCalls,
    );

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

    expect(createSandboxCalls[0]?.sandbox).toBe(customSandbox);
  });
});

describe("resolveOrchestratorRoot", () => {
  it("defaults to the repo root that contains prompts/", async () => {
    const root = resolveOrchestratorRoot();

    await expect(access(join(root, "prompts", "tdd.md"))).resolves.toBeUndefined();
  });
});

describe("CURSOR_TRUST_SETUP", () => {
  it("documents operator trust setup deferred until Sandcastle adds --trust", () => {
    expect(CURSOR_TRUST_SETUP).toMatch(/trust/i);
  });
});

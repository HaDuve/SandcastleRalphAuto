import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Handoff, writeHandoff, writeHostHandoff } from "../src/handoff/index.js";
import {
  CURSOR_TRUST_SETUP,
  DEFAULT_BABYSIT_MAX_ITERATIONS,
  DEFAULT_TDD_MAX_ITERATIONS,
  PHASE_COMPLETE_SIGNAL,
  resolveOrchestratorRoot,
  runPhase,
  type RunPhaseDeps,
  type SandcastleCreateSandboxOptions,
  type SandcastleSandboxRunOptions,
  type SandcastleSandboxRunResult,
} from "../src/runner/index.js";

const PROJECT_ID = "HaDuve/SandcastleRalphAuto";

const sampleHandoff: Handoff = {
  project: PROJECT_ID,
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
    const stateRoot = await mkdtemp(join(tmpdir(), "runner-state-"));
    const promptFile = join(projectPath, "prompts", "create-pr.md");
    await mkdir(join(projectPath, "prompts"), { recursive: true });
    await writeFile(promptFile, "# create-pr\n");
    await writeHostHandoff({ stateRoot, projectId: PROJECT_ID, handoff: sampleHandoff });

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
        projectId: PROJECT_ID,
        stateRoot,
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

  it("writes seedHandoff to the sandbox worktree before the agent runs", async () => {
    const createSandboxCalls: SandcastleCreateSandboxOptions[] = [];
    const projectPath = await mkdtemp(join(tmpdir(), "runner-test-"));
    const worktreePath = await mkdtemp(join(tmpdir(), "runner-worktree-"));
    const stateRoot = await mkdtemp(join(tmpdir(), "runner-state-"));
    const promptFile = join(projectPath, "prompts", "tdd.md");
    await mkdir(join(projectPath, "prompts"), { recursive: true });
    await writeFile(promptFile, "# tdd\n");

    const seedHandoff: Handoff = {
      project: PROJECT_ID,
      issue: 9,
      branch: "issue-9",
      phase: "tdd",
      acceptanceState: "in-progress",
      blockers: [],
      mergeReady: false,
      nextSkill: "/create-pr",
      startedAt: "2026-06-01T12:00:00.000Z",
      endedAt: "2026-06-01T12:00:00.000Z",
    };

    let handoffWhenAgentRuns: Handoff | undefined;

    const deps = createMockDeps(
      {
        worktreePath,
        runImpl: async () => {
          const { readHandoff } = await import("../src/handoff/index.js");
          handoffWhenAgentRuns = await readHandoff(worktreePath);
          await writeHandoff(
            {
              ...seedHandoff,
              acceptanceState: "done",
              endedAt: "2026-06-01T13:00:00.000Z",
            },
            worktreePath,
          );
          return {
            commits: [],
            completionSignal: PHASE_COMPLETE_SIGNAL,
            iterations: [],
            stdout: "",
          };
        },
      },
      createSandboxCalls,
    );

    await runPhase(
      {
        phase: "tdd",
        branch: "issue-9",
        projectPath,
        projectId: PROJECT_ID,
        stateRoot,
        promptFile,
        seedHandoff,
      },
      deps,
    );

    expect(createSandboxCalls[0]?.cwd).toBe(projectPath);
    expect(handoffWhenAgentRuns).toEqual(seedHandoff);
    await expect(
      access(join(worktreePath, ".sandcastle-ralph/handoff/current.json")),
    ).resolves.toBeUndefined();
  });

  it("resolves promptFile from orchestrator prompts when not overridden", async () => {
    const runCalls: SandcastleSandboxRunOptions[] = [];
    const projectPath = await mkdtemp(join(tmpdir(), "runner-test-"));
    const worktreePath = await mkdtemp(join(tmpdir(), "runner-worktree-"));
    const stateRoot = await mkdtemp(join(tmpdir(), "runner-state-"));
    await writeHostHandoff({ stateRoot, projectId: PROJECT_ID, handoff: sampleHandoff });
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
        projectId: PROJECT_ID,
        stateRoot,
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
    const stateRoot = await mkdtemp(join(tmpdir(), "runner-state-"));
    const promptFile = join(projectPath, "prompts", "tdd.md");
    await mkdir(join(projectPath, "prompts"), { recursive: true });
    await writeFile(promptFile, "# tdd\n");
    await writeHostHandoff({
      stateRoot,
      projectId: PROJECT_ID,
      handoff: { ...sampleHandoff, phase: "tdd" },
    });

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
        projectId: PROJECT_ID,
        stateRoot,
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
        projectId: PROJECT_ID,
        stateRoot,
        promptFile,
      },
      deps,
    );

    expect(runCalls[0]?.maxIterations).toBe(DEFAULT_TDD_MAX_ITERATIONS);

    runCalls.length = 0;
    await writeHostHandoff({
      stateRoot,
      projectId: PROJECT_ID,
      handoff: { ...sampleHandoff, phase: "merge" },
    });

    await runPhase(
      {
        phase: "merge",
        branch: "issue-6-runner",
        projectPath,
        projectId: PROJECT_ID,
        stateRoot,
        promptFile: join(projectPath, "prompts", "merge.md"),
        tddMaxIterations: 7,
      },
      deps,
    );

    expect(runCalls[0]?.maxIterations).toBe(1);
  });

  it("uses babysitMaxIterations for babysit and single-shot for other non-tdd phases", async () => {
    const runCalls: SandcastleSandboxRunOptions[] = [];
    const projectPath = await mkdtemp(join(tmpdir(), "runner-test-"));
    const worktreePath = await mkdtemp(join(tmpdir(), "runner-worktree-"));
    const stateRoot = await mkdtemp(join(tmpdir(), "runner-state-"));
    const promptFile = join(projectPath, "prompts", "babysit.md");
    await mkdir(join(projectPath, "prompts"), { recursive: true });
    await writeFile(promptFile, "# babysit\n");
    await writeHostHandoff({
      stateRoot,
      projectId: PROJECT_ID,
      handoff: { ...sampleHandoff, phase: "babysit", nextSkill: "/merge" },
    });

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
        phase: "babysit",
        branch: "issue-6-runner",
        projectPath,
        projectId: PROJECT_ID,
        stateRoot,
        promptFile,
        babysitMaxIterations: 4,
        signal: new AbortController().signal,
      },
      deps,
    );

    expect(runCalls[0]?.maxIterations).toBe(4);
    expect(runCalls[0]?.signal).toBeInstanceOf(AbortSignal);

    runCalls.length = 0;

    await runPhase(
      {
        phase: "babysit",
        branch: "issue-6-runner",
        projectPath,
        projectId: PROJECT_ID,
        stateRoot,
        promptFile,
      },
      deps,
    );

    expect(runCalls[0]?.maxIterations).toBe(DEFAULT_BABYSIT_MAX_ITERATIONS);
  });

  it("threads AbortSignal to sandbox.run for the kill switch", async () => {
    const runCalls: SandcastleSandboxRunOptions[] = [];
    const projectPath = await mkdtemp(join(tmpdir(), "runner-test-"));
    const worktreePath = await mkdtemp(join(tmpdir(), "runner-worktree-"));
    const stateRoot = await mkdtemp(join(tmpdir(), "runner-state-"));
    const promptFile = join(projectPath, "prompts", "create-pr.md");
    await mkdir(join(projectPath, "prompts"), { recursive: true });
    await writeFile(promptFile, "# create-pr\n");
    await writeHostHandoff({ stateRoot, projectId: PROJECT_ID, handoff: sampleHandoff });

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
        projectId: PROJECT_ID,
        stateRoot,
        promptFile,
        signal: controller.signal,
      },
      deps,
    );

    expect(runCalls[0]?.signal).toBe(controller.signal);
  });

  it("carries over host handoff when the agent writes no worktree handoff", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "runner-test-"));
    const worktreePath = await mkdtemp(join(tmpdir(), "runner-worktree-"));
    const stateRoot = await mkdtemp(join(tmpdir(), "runner-state-"));
    const promptFile = join(projectPath, "prompts", "review-pr.md");
    await mkdir(join(projectPath, "prompts"), { recursive: true });
    await writeFile(promptFile, "# review-pr\n");
    await writeHostHandoff({ stateRoot, projectId: PROJECT_ID, handoff: sampleHandoff });

    const deps = createMockDeps({
      worktreePath,
      runImpl: async () => {
        const { unlink } = await import("node:fs/promises");
        await unlink(
          join(worktreePath, ".sandcastle-ralph/handoff/current.json"),
        );
        return {
          commits: [],
          completionSignal: PHASE_COMPLETE_SIGNAL,
          iterations: [],
          stdout: "",
        };
      },
    });

    const result = await runPhase(
      {
        phase: "review-pr",
        branch: "issue-6-runner",
        projectPath,
        projectId: PROJECT_ID,
        stateRoot,
        promptFile,
      },
      deps,
    );

    expect(result.handoff).toEqual(sampleHandoff);
    const hostRaw = await readFile(
      join(stateRoot, PROJECT_ID, "handoff/current.json"),
      "utf8",
    );
    expect(JSON.parse(hostRaw)).toEqual(sampleHandoff);
  });

  it("reads handoff from the worktree before sandbox teardown on a clean success path", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "runner-test-"));
    const worktreePath = await mkdtemp(join(tmpdir(), "runner-worktree-"));
    const stateRoot = await mkdtemp(join(tmpdir(), "runner-state-"));
    const promptFile = join(projectPath, "prompts", "create-pr.md");
    await mkdir(join(projectPath, "prompts"), { recursive: true });
    await writeFile(promptFile, "# create-pr\n");
    await writeHostHandoff({ stateRoot, projectId: PROJECT_ID, handoff: sampleHandoff });

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
        projectId: PROJECT_ID,
        stateRoot,
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

  it("forwards onAgentStreamEvent through file logging on sandbox.run", async () => {
    const runCalls: SandcastleSandboxRunOptions[] = [];
    const forwarded: unknown[] = [];
    const projectPath = await mkdtemp(join(tmpdir(), "runner-test-"));
    const worktreePath = await mkdtemp(join(tmpdir(), "runner-worktree-"));
    const stateRoot = await mkdtemp(join(tmpdir(), "runner-state-"));
    const promptFile = join(projectPath, "prompts", "tdd.md");
    await mkdir(join(projectPath, "prompts"), { recursive: true });
    await writeFile(promptFile, "# tdd\n");
    await writeHostHandoff({
      stateRoot,
      projectId: PROJECT_ID,
      handoff: { ...sampleHandoff, phase: "tdd" },
    });

    const textEvent = {
      type: "text" as const,
      message: "planning tests",
      iteration: 1,
      timestamp: new Date("2026-06-01T12:00:00.000Z"),
    };
    const toolEvent = {
      type: "toolCall" as const,
      name: "read_file",
      formattedArgs: "path=src/foo.ts",
      iteration: 1,
      timestamp: new Date("2026-06-01T12:00:01.000Z"),
    };

    const deps = createMockDeps(
      {
        worktreePath,
        runImpl: async (runOptions) => {
          expect(runOptions.logging?.type).toBe("file");
          if (runOptions.logging?.type !== "file") {
            throw new Error("expected file logging");
          }
          expect(runOptions.logging.onAgentStreamEvent).toEqual(
            expect.any(Function),
          );
          runOptions.logging.onAgentStreamEvent?.(textEvent);
          runOptions.logging.onAgentStreamEvent?.(toolEvent);
          return {
            commits: [],
            iterations: [],
            stdout: "",
          };
        },
      },
      [],
      runCalls,
    );

    await runPhase(
      {
        phase: "tdd",
        branch: "issue-12-stream",
        projectPath,
        projectId: PROJECT_ID,
        stateRoot,
        promptFile,
        onAgentStreamEvent: (event) => {
          forwarded.push(event);
        },
      },
      deps,
    );

    expect(forwarded).toEqual([textEvent, toolEvent]);
  });

  it("uses Sandcastle-compatible branch sanitization for streaming log paths", async () => {
    const runCalls: SandcastleSandboxRunOptions[] = [];
    const projectPath = await mkdtemp(join(tmpdir(), "runner-test-"));
    const worktreePath = await mkdtemp(join(tmpdir(), "runner-worktree-"));
    const stateRoot = await mkdtemp(join(tmpdir(), "runner-state-"));
    const promptFile = join(projectPath, "prompts", "tdd.md");
    await mkdir(join(projectPath, "prompts"), { recursive: true });
    await writeFile(promptFile, "# tdd\n");
    await writeHostHandoff({
      stateRoot,
      projectId: PROJECT_ID,
      handoff: { ...sampleHandoff, phase: "tdd" },
    });

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
        branch: "feature/foo@bar",
        projectPath,
        projectId: PROJECT_ID,
        stateRoot,
        promptFile,
        onAgentStreamEvent: () => {},
      },
      deps,
    );

    expect(runCalls[0]?.logging).toMatchObject({
      type: "file",
      path: join(projectPath, ".sandcastle", "logs", "feature-foo@bar-tdd.log"),
    });
  });

  it("accepts a configurable sandbox provider", async () => {
    const createSandboxCalls: SandcastleCreateSandboxOptions[] = [];
    const projectPath = await mkdtemp(join(tmpdir(), "runner-test-"));
    const worktreePath = await mkdtemp(join(tmpdir(), "runner-worktree-"));
    const stateRoot = await mkdtemp(join(tmpdir(), "runner-state-"));
    const promptFile = join(projectPath, "prompts", "create-pr.md");
    await mkdir(join(projectPath, "prompts"), { recursive: true });
    await writeFile(promptFile, "# create-pr\n");
    await writeHostHandoff({ stateRoot, projectId: PROJECT_ID, handoff: sampleHandoff });

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
        projectId: PROJECT_ID,
        stateRoot,
        promptFile,
        sandbox: customSandbox,
      },
      deps,
    );

    expect(createSandboxCalls[0]?.sandbox).toBe(customSandbox);
  });

  it("retries sandbox.run on transient resource_exhausted with exponential backoff", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "runner-retry-"));
    const worktreePath = await mkdtemp(join(tmpdir(), "runner-retry-wt-"));
    const stateRoot = await mkdtemp(join(tmpdir(), "runner-retry-state-"));
    const promptFile = join(projectPath, "prompts", "create-pr.md");
    await mkdir(join(projectPath, "prompts"), { recursive: true });
    await writeFile(promptFile, "# create-pr\n");
    await writeHostHandoff({ stateRoot, projectId: PROJECT_ID, handoff: sampleHandoff });

    let runCount = 0;
    const deps = createMockDeps({
      worktreePath,
      runImpl: async () => {
        runCount += 1;
        if (runCount < 3) {
          throw new Error(
            "cursor exited with code 1:\nT: [resource_exhausted] Error\n",
          );
        }
        return {
          commits: [{ sha: "retry-ok" }],
          completionSignal: PHASE_COMPLETE_SIGNAL,
          logFilePath: join(projectPath, "run.log"),
          iterations: [],
          stdout: "",
        };
      },
    });

    const result = await runPhase(
      {
        phase: "create-pr",
        branch: "issue-6-runner",
        projectPath,
        projectId: PROJECT_ID,
        stateRoot,
        promptFile,
        cursorTransientMaxAttempts: 4,
        cursorTransientBaseDelayMs: 0,
        cursorTransientMaxDelayMs: 0,
        cursorTransientJitterRatio: 0,
      },
      deps,
    );

    expect(runCount).toBe(3);
    expect(result.commits).toEqual([{ sha: "retry-ok" }]);
  });

  it("throws after exhausting transient resource_exhausted retries", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "runner-retry-ex-"));
    const worktreePath = await mkdtemp(join(tmpdir(), "runner-retry-ex-wt-"));
    const stateRoot = await mkdtemp(join(tmpdir(), "runner-retry-ex-state-"));
    const promptFile = join(projectPath, "prompts", "create-pr.md");
    await mkdir(join(projectPath, "prompts"), { recursive: true });
    await writeFile(promptFile, "# create-pr\n");
    await writeHostHandoff({ stateRoot, projectId: PROJECT_ID, handoff: sampleHandoff });

    const deps = createMockDeps({
      worktreePath,
      runImpl: async () => {
        throw new Error(
          "cursor exited with code 1:\nT: [resource_exhausted] Error\n",
        );
      },
    });

    await expect(
      runPhase(
        {
          phase: "create-pr",
          branch: "issue-6-runner",
          projectPath,
          projectId: PROJECT_ID,
          stateRoot,
          promptFile,
          cursorTransientMaxAttempts: 2,
          cursorTransientBaseDelayMs: 0,
          cursorTransientMaxDelayMs: 0,
          cursorTransientJitterRatio: 0,
        },
        deps,
      ),
    ).rejects.toThrow(/exhausted 2 Sandcastle attempts/);
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

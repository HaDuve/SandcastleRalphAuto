import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentStreamEnvelope, createInMemoryProjectMutex, loopProject, type RunProjectDeps } from "../src/cli/index.js";
import { type Project } from "../src/registry/index.js";
import { createEventBus, type DashboardEvent } from "../src/server/eventBus.js";
import { createWorkerManager } from "../src/server/workerManager.js";
import { readRunOutcome, writeActive } from "../src/state/index.js";

const portfolio: Project = {
  id: "portfolio",
  path: "/tmp/portfolio",
  remote: "HaDuve/Portfolio",
  defaultBase: "main",
  afkLabel: "ready-for-agent",
  blockedLabels: ["needs-info"],
  autoMerge: true,
  concurrency: "single",
  sandbox: "none",
};

async function waitForWorkerToFinish(
  manager: ReturnType<typeof createWorkerManager>,
  projectId: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (manager.isRunning(projectId) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(manager.isRunning(projectId)).toBe(false);
}

describe("createWorkerManager", () => {
  it("emits worker-stopped when loopProject rejects", async () => {
    const eventBus = createEventBus();
    const events: DashboardEvent[] = [];
    eventBus.subscribe("portfolio", (event) => events.push(event));

    const manager = createWorkerManager({
      eventBus,
      loopProject: async () => {
        throw new Error("Project HaDuve/Portfolio is already running");
      },
    });

    await manager.start(portfolio, {
      rootDir: "/tmp",
      stateRoot: "/tmp/state",
    });
    await waitForWorkerToFinish(manager, "portfolio");

    expect(events).toContainEqual({
      type: "worker-stopped",
      projectId: "portfolio",
      lastRunOutcome: {
        outcome: "error",
        reason: "Project HaDuve/Portfolio is already running",
        stoppedAt: expect.any(String),
      },
    });
    expect(manager.isRunning("portfolio")).toBe(false);
  });

  it("emits stream events tagged with project, issue, and phase", async () => {
    const eventBus = createEventBus();
    const events: DashboardEvent[] = [];
    eventBus.subscribe("portfolio", (event) => events.push(event));

    const streamEnvelope: AgentStreamEnvelope = {
      issue: 12,
      phase: "tdd",
      event: {
        type: "toolCall",
        name: "grep",
        formattedArgs: "pattern=stream",
        iteration: 2,
        timestamp: new Date("2026-06-01T12:00:00.000Z"),
      },
    };

    const manager = createWorkerManager({
      eventBus,
      loopProject: async (_input, deps) => {
        deps!.onAgentStream?.(streamEnvelope);
        return { status: "queue-empty", slicesCompleted: 0 };
      },
    });

    await manager.start(portfolio, {
      rootDir: "/tmp",
      stateRoot: "/tmp/state",
    });
    await waitForWorkerToFinish(manager, "portfolio");

    expect(events).toContainEqual({
      type: "stream",
      projectId: "portfolio",
      issue: 12,
      phase: "tdd",
      event: streamEnvelope.event,
    });
    expect(manager.isRunning("portfolio")).toBe(false);
  });

  it("allows restarting a project after kill releases the mutex", async () => {
    const eventBus = createEventBus();
    const mutex = createInMemoryProjectMutex();
    const runDeps: RunProjectDeps = {
      mutex,
      loadRegistry: async () => [portfolio],
      runLinearSlice: async (options, sliceDeps) => {
        await sliceDeps!.runPhase({
          phase: "tdd",
          branch: options.branch,
          projectPath: options.projectPath,
          projectId: options.projectId,
          stateRoot: options.stateRoot,
        });
        return {
          status: "ready-for-next",
          issue: options.issue,
          branch: options.branch,
          pr: 42,
          phasesCompleted: ["tdd"],
        };
      },
      runPhase: async (options) => {
        await new Promise<void>((_, reject) => {
          if (options.signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          options.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
        throw new Error("unreachable");
      },
      runMergeGate: async () => ({ status: "auto-merge-queued" }),
      waitForMergedPr: async () => {},
    };

    const manager = createWorkerManager({
      eventBus,
      loopProject: (input, deps) =>
        loopProject({ ...input, issue: 10 }, deps),
    });

    const firstStart = await manager.start(portfolio, {
      rootDir: "/tmp",
      stateRoot: "/tmp/state",
      deps: runDeps,
    });
    expect(firstStart).toEqual({ status: "started" });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(manager.kill("portfolio")).toEqual({ status: "killed" });
    await waitForWorkerToFinish(manager, "portfolio");
    expect(manager.isRunning("portfolio")).toBe(false);

    const secondStart = await manager.start(portfolio, {
      rootDir: "/tmp",
      stateRoot: "/tmp/state",
      deps: runDeps,
    });
    expect(secondStart).toEqual({ status: "started" });
  });

  it("persists queue-empty run outcome when the loop drains the queue", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "worker-run-outcome-"));
    const eventBus = createEventBus();
    const manager = createWorkerManager({
      eventBus,
      loopProject: async () => ({ status: "queue-empty", slicesCompleted: 2 }),
      now: () => new Date("2026-06-01T12:00:00.000Z"),
    });

    await manager.start(portfolio, { rootDir: "/tmp", stateRoot });
    await waitForWorkerToFinish(manager, "portfolio");

    await expect(readRunOutcome(portfolio.remote, stateRoot)).resolves.toEqual({
      outcome: "queue-empty",
      stoppedAt: "2026-06-01T12:00:00.000Z",
    });
  });

  it("emits worker-stopped with lastRunOutcome matching run.json when blocked", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "worker-run-outcome-"));
    const eventBus = createEventBus();
    const events: DashboardEvent[] = [];
    eventBus.subscribe("portfolio", (event) => events.push(event));
    const manager = createWorkerManager({
      eventBus,
      loopProject: async () => {
        await writeActive(
          portfolio.remote,
          {
            issue: 7,
            phase: "review-tdd",
            branch: "issue-7",
            status: "blocked",
            reason: "Required check ci failed",
            resumeSkill: "/review-tdd",
          },
          stateRoot,
        );
        return { status: "blocked", reason: "Required check ci failed" };
      },
      now: () => new Date("2026-06-01T12:00:00.000Z"),
    });

    await manager.start(portfolio, { rootDir: "/tmp", stateRoot });
    await waitForWorkerToFinish(manager, "portfolio");

    const persisted = await readRunOutcome(portfolio.remote, stateRoot);
    expect(events).toContainEqual({
      type: "worker-stopped",
      projectId: "portfolio",
      lastRunOutcome: persisted,
    });
    expect(persisted).toEqual({
      outcome: "blocked",
      reason: "Required check ci failed",
      phase: "review-tdd",
      stoppedAt: "2026-06-01T12:00:00.000Z",
      logRef: join(
        portfolio.path,
        ".sandcastle",
        "logs",
        "issue-7-review-tdd.log",
      ),
    });
  });

  it("persists blocked run outcome with reason, phase, and logRef", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "worker-run-outcome-"));
    const eventBus = createEventBus();
    const manager = createWorkerManager({
      eventBus,
      loopProject: async () => {
        await writeActive(
          portfolio.remote,
          {
            issue: 7,
            phase: "review-tdd",
            branch: "issue-7",
            status: "blocked",
            reason: "Required check ci failed",
            resumeSkill: "/review-tdd",
          },
          stateRoot,
        );
        return { status: "blocked", reason: "Required check ci failed" };
      },
      now: () => new Date("2026-06-01T12:00:00.000Z"),
    });

    await manager.start(portfolio, { rootDir: "/tmp", stateRoot });
    await waitForWorkerToFinish(manager, "portfolio");

    await expect(readRunOutcome(portfolio.remote, stateRoot)).resolves.toEqual({
      outcome: "blocked",
      reason: "Required check ci failed",
      phase: "review-tdd",
      stoppedAt: "2026-06-01T12:00:00.000Z",
      logRef: join(
        portfolio.path,
        ".sandcastle",
        "logs",
        "issue-7-review-tdd.log",
      ),
    });
  });

  it("persists host-level blocked run outcome when there is no active slice", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "worker-run-outcome-"));
    const eventBus = createEventBus();
    const manager = createWorkerManager({
      eventBus,
      loopProject: async () => ({
        status: "blocked",
        reason: "Could not parse issues from gh",
      }),
      now: () => new Date("2026-06-01T12:00:00.000Z"),
    });

    await manager.start(portfolio, { rootDir: "/tmp", stateRoot });
    await waitForWorkerToFinish(manager, "portfolio");

    await expect(readRunOutcome(portfolio.remote, stateRoot)).resolves.toEqual({
      outcome: "blocked",
      reason: "Could not parse issues from gh",
      stoppedAt: "2026-06-01T12:00:00.000Z",
    });
  });

  it("persists awaiting-human run outcome with reason, phase, and logRef", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "worker-run-outcome-"));
    const eventBus = createEventBus();
    const manager = createWorkerManager({
      eventBus,
      loopProject: async () => {
        await writeActive(
          portfolio.remote,
          {
            issue: 7,
            phase: "merge",
            branch: "issue-7",
            pr: 42,
            status: "awaiting-human",
            reason: "autoMerge is disabled for this project",
          },
          stateRoot,
        );
        return {
          status: "awaiting-human",
          reason: "autoMerge is disabled for this project",
        };
      },
      now: () => new Date("2026-06-01T12:00:00.000Z"),
    });

    await manager.start(portfolio, { rootDir: "/tmp", stateRoot });
    await waitForWorkerToFinish(manager, "portfolio");

    await expect(readRunOutcome(portfolio.remote, stateRoot)).resolves.toEqual({
      outcome: "awaiting-human",
      reason: "autoMerge is disabled for this project",
      phase: "merge",
      stoppedAt: "2026-06-01T12:00:00.000Z",
      logRef: join(
        portfolio.path,
        ".sandcastle",
        "logs",
        "issue-7-merge.log",
      ),
    });
  });

  it("persists error run outcome when loopProject rejects", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "worker-run-outcome-"));
    const eventBus = createEventBus();
    const manager = createWorkerManager({
      eventBus,
      loopProject: async () => {
        throw new Error("Project HaDuve/Portfolio is already running");
      },
      now: () => new Date("2026-06-01T12:00:00.000Z"),
    });

    await manager.start(portfolio, { rootDir: "/tmp", stateRoot });
    await waitForWorkerToFinish(manager, "portfolio");

    await expect(readRunOutcome(portfolio.remote, stateRoot)).resolves.toEqual({
      outcome: "error",
      reason: "Project HaDuve/Portfolio is already running",
      stoppedAt: "2026-06-01T12:00:00.000Z",
    });
  });

  it("persists killed run outcome when the operator kills the worker", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "worker-run-outcome-"));
    const eventBus = createEventBus();
    const mutex = createInMemoryProjectMutex();
    const runDeps: RunProjectDeps = {
      mutex,
      loadRegistry: async () => [portfolio],
      runLinearSlice: async (options, sliceDeps) => {
        await sliceDeps!.runPhase({
          phase: "tdd",
          branch: options.branch,
          projectPath: options.projectPath,
          projectId: options.projectId,
          stateRoot: options.stateRoot,
        });
        return {
          status: "ready-for-next",
          issue: options.issue,
          branch: options.branch,
          pr: 42,
          phasesCompleted: ["tdd"],
        };
      },
      runPhase: async (options) => {
        await new Promise<void>((_, reject) => {
          if (options.signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          options.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
        throw new Error("unreachable");
      },
      runMergeGate: async () => ({ status: "auto-merge-queued" }),
      waitForMergedPr: async () => {},
    };

    const manager = createWorkerManager({
      eventBus,
      loopProject: (input, deps) =>
        loopProject({ ...input, issue: 10 }, deps),
      now: () => new Date("2026-06-01T12:00:00.000Z"),
    });

    await manager.start(portfolio, {
      rootDir: "/tmp",
      stateRoot,
      deps: runDeps,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(manager.kill("portfolio")).toEqual({ status: "killed" });
    await waitForWorkerToFinish(manager, "portfolio");

    await expect(readRunOutcome(portfolio.remote, stateRoot)).resolves.toEqual({
      outcome: "killed",
      stoppedAt: "2026-06-01T12:00:00.000Z",
    });
  });
});

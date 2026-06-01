import { describe, expect, it } from "vitest";
import { createInMemoryProjectMutex, loopProject, type RunProjectDeps } from "../src/cli/index.js";
import { type Project } from "../src/registry/index.js";
import { createEventBus, type DashboardEvent } from "../src/server/eventBus.js";
import { createWorkerManager } from "../src/server/workerManager.js";

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
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(events).toContainEqual({
      type: "worker-stopped",
      projectId: "portfolio",
      reason: "Project HaDuve/Portfolio is already running",
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
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(manager.isRunning("portfolio")).toBe(false);

    const secondStart = await manager.start(portfolio, {
      rootDir: "/tmp",
      stateRoot: "/tmp/state",
      deps: runDeps,
    });
    expect(secondStart).toEqual({ status: "started" });
  });
});

import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Handoff } from "../src/handoff/index.js";
import {
  createInMemoryProjectMutex,
  loopProject,
  type RunProjectDeps,
} from "../src/cli/index.js";
import { QUEUE_EMPTY } from "../src/next/index.js";
import { type Project } from "../src/registry/index.js";
import { PHASE_COMPLETE_SIGNAL } from "../src/runner/index.js";
import { createEventBus, type DashboardEvent } from "../src/server/eventBus.js";
import { createDashboardServer, type DashboardServerOptions } from "../src/server/index.js";
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

async function setupProjectRoot(): Promise<{
  rootDir: string;
  project: Project;
  stateRoot: string;
}> {
  const rootDir = await mkdtemp(join(tmpdir(), "server-root-"));
  const projectPath = join(rootDir, "portfolio-repo");
  await mkdir(projectPath);
  const project: Project = { ...portfolio, path: projectPath };
  await writeFile(
    join(rootDir, "projects.json"),
    JSON.stringify({ projects: [project] }, null, 2),
  );
  return { rootDir, project, stateRoot: join(rootDir, "state") };
}

async function seedActiveSliceWithLogs(
  stateRoot: string,
  project: Project,
  active: {
    issue: number;
    phase: string;
    branch: string;
    status: string;
    pr?: number;
  },
  logFiles: Record<string, string>,
): Promise<void> {
  const activeDir = join(stateRoot, project.remote);
  await mkdir(activeDir, { recursive: true });
  await writeFile(
    join(activeDir, "active.json"),
    JSON.stringify(active, null, 2) + "\n",
  );
  const logsDir = join(project.path, ".sandcastle", "logs");
  await mkdir(logsDir, { recursive: true });
  for (const [filename, content] of Object.entries(logFiles)) {
    await writeFile(join(logsDir, filename), content);
  }
}

async function startServer(
  rootDir: string,
  overrides: Omit<DashboardServerOptions, "rootDir"> = {},
): Promise<{ server: Server; baseUrl: string }> {
  const server = createDashboardServer({ rootDir, ...overrides });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected server to listen on a TCP port");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function reviewHandoff(issue = 12, pr = 42): Handoff {
  return {
    project: "HaDuve/Portfolio",
    issue,
    branch: `issue-${issue}`,
    pr,
    phase: "review-pr",
    acceptanceState: "done",
    verdict: "approve",
    blockers: [],
    mergeReady: false,
    nextSkill: "/review-tdd",
    startedAt: "2026-06-01T00:00:00.000Z",
    endedAt: "2026-06-01T01:00:00.000Z",
  };
}

async function waitForDashboardEvent(
  events: DashboardEvent[],
  type: DashboardEvent["type"],
  timeoutMs = 3_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (events.some((event) => event.type === type)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for dashboard event: ${type}`);
}

describe("dashboard server", () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
    });
    server = undefined;
  });

  it("lists projects with default enrichment when no slice state exists", async () => {
    const { rootDir, project } = await setupProjectRoot();
    const started = await startServer(rootDir);
    server = started.server;

    const response = await fetch(`${started.baseUrl}/api/projects`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      projects: [
        {
          ...project,
          workerStatus: "idle",
          lastRunOutcome: null,
          active: null,
        },
      ],
    });
  });

  it("lists registered projects with status enrichment", async () => {
    const { rootDir, project, stateRoot } = await setupProjectRoot();
    const activeDir = join(stateRoot, project.remote);
    await mkdir(activeDir, { recursive: true });
    await writeFile(
      join(activeDir, "active.json"),
      JSON.stringify(
        {
          issue: 11,
          phase: "tdd",
          branch: "issue-11",
          status: "active",
        },
        null,
        2,
      ) + "\n",
    );
    await writeFile(
      join(activeDir, "run.json"),
      JSON.stringify(
        {
          outcome: "blocked",
          reason: "CI failed",
          phase: "review-pr",
          stoppedAt: "2026-06-01T12:00:00.000Z",
        },
        null,
        2,
      ) + "\n",
    );

    const started = await startServer(rootDir, { stateRoot });
    server = started.server;

    const response = await fetch(`${started.baseUrl}/api/projects`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      projects: [
        {
          ...project,
          workerStatus: "idle",
          lastRunOutcome: {
            outcome: "blocked",
            reason: "CI failed",
            phase: "review-pr",
            stoppedAt: "2026-06-01T12:00:00.000Z",
          },
          active: { issue: 11, phase: "tdd", status: "active" },
        },
      ],
    });
  });

  it("returns the active issue phase log and available phases", async () => {
    const { rootDir, project, stateRoot } = await setupProjectRoot();
    await seedActiveSliceWithLogs(
      stateRoot,
      project,
      { issue: 7, phase: "review-pr", branch: "issue-7", status: "active" },
      {
        "issue-7-tdd.log": "tdd output\n",
        "issue-7-review-pr.log": "review output\n",
      },
    );

    const started = await startServer(rootDir, { stateRoot });
    server = started.server;

    const response = await fetch(`${started.baseUrl}/api/projects/portfolio/log`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      issue: 7,
      phase: "review-pr",
      log: "review output\n",
      phases: ["tdd", "review-pr"],
    });
  });

  it("returns 404 for log when no active slice", async () => {
    const { rootDir } = await setupProjectRoot();
    const started = await startServer(rootDir);
    server = started.server;

    const response = await fetch(`${started.baseUrl}/api/projects/portfolio/log`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "No active slice" });
  });

  it("serves log by issue and phase when active slice was cleared", async () => {
    const { rootDir, project, stateRoot } = await setupProjectRoot();
    await seedActiveSliceWithLogs(
      stateRoot,
      project,
      { issue: 7, phase: "merge", branch: "issue-7", status: "active" },
      { "issue-7-merge.log": "merged output\n" },
    );
    const activePath = join(
      stateRoot,
      project.remote,
      "active.json",
    );
    const { unlink } = await import("node:fs/promises");
    await unlink(activePath);

    const started = await startServer(rootDir, { stateRoot });
    server = started.server;

    const response = await fetch(
      `${started.baseUrl}/api/projects/portfolio/log?issue=7&phase=merge`,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      issue: 7,
      phase: "merge",
      log: "merged output\n",
      phases: expect.arrayContaining(["merge"]),
    });
  });

  it("rejects unknown phase query on log endpoint", async () => {
    const { rootDir, project, stateRoot } = await setupProjectRoot();
    await seedActiveSliceWithLogs(
      stateRoot,
      project,
      { issue: 7, phase: "review-pr", branch: "issue-7", status: "active" },
      {},
    );

    const started = await startServer(rootDir, { stateRoot });
    server = started.server;

    const response = await fetch(
      `${started.baseUrl}/api/projects/portfolio/log?phase=evil`,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid phase" });
  });

  it("returns babysit phase log when recovery phase is active", async () => {
    const { rootDir, project, stateRoot } = await setupProjectRoot();
    await seedActiveSliceWithLogs(
      stateRoot,
      project,
      { issue: 7, phase: "babysit", branch: "issue-7", status: "active", pr: 42 },
      { "issue-7-babysit.log": "babysit output\n" },
    );

    const started = await startServer(rootDir, { stateRoot });
    server = started.server;

    const response = await fetch(
      `${started.baseUrl}/api/projects/portfolio/log?phase=babysit`,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      issue: 7,
      phase: "babysit",
      log: "babysit output\n",
    });
  });

  it("returns a specific phase log when phase query is set", async () => {
    const { rootDir, project, stateRoot } = await setupProjectRoot();
    await seedActiveSliceWithLogs(
      stateRoot,
      project,
      { issue: 7, phase: "review-pr", branch: "issue-7", status: "active" },
      {
        "issue-7-tdd.log": "tdd output\n",
        "issue-7-review-pr.log": "review output\n",
      },
    );

    const started = await startServer(rootDir, { stateRoot });
    server = started.server;

    const response = await fetch(
      `${started.baseUrl}/api/projects/portfolio/log?phase=tdd`,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      issue: 7,
      phase: "tdd",
      log: "tdd output\n",
      phases: ["tdd", "review-pr"],
    });
  });

  it("returns active slice state for a project", async () => {
    const { rootDir, project, stateRoot } = await setupProjectRoot();
    const activeDir = join(stateRoot, project.remote);
    await mkdir(activeDir, { recursive: true });
    await writeFile(
      join(activeDir, "active.json"),
      JSON.stringify(
        {
          issue: 11,
          phase: "tdd",
          branch: "issue-11",
          status: "active",
        },
        null,
        2,
      ) + "\n",
    );

    const started = await startServer(rootDir, { stateRoot });
    server = started.server;
    const response = await fetch(`${started.baseUrl}/api/projects/portfolio/active`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      active: {
        issue: 11,
        phase: "tdd",
        branch: "issue-11",
        status: "active",
      },
    });
  });

  it("returns queue issues with skip and eligibility flags", async () => {
    const { rootDir, project, stateRoot } = await setupProjectRoot();
    const started = await startServer(rootDir, {
      stateRoot,
      fetchQueue: async () => [
        { number: 10, labels: ["ready-for-agent"], skipped: false, eligible: true },
        { number: 12, labels: ["ready-for-agent", "needs-info"], skipped: false, eligible: false },
      ],
    });
    server = started.server;

    const response = await fetch(`${started.baseUrl}/api/projects/portfolio/queue`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      queue: [
        { number: 10, labels: ["ready-for-agent"], skipped: false, eligible: true },
        { number: 12, labels: ["ready-for-agent", "needs-info"], skipped: false, eligible: false },
      ],
    });
    void project;
  });

  it("returns archived handoff history from the host store", async () => {
    const { rootDir, project, stateRoot } = await setupProjectRoot();
    const historyDir = join(
      stateRoot,
      project.remote,
      "handoff",
      "history",
    );
    await mkdir(historyDir, { recursive: true });
    const handoff: Handoff = {
      project: project.remote,
      issue: 9,
      branch: "issue-9",
      pr: 99,
      phase: "merge",
      acceptanceState: "done",
      verdict: "approve",
      blockers: [],
      mergeReady: true,
      nextSkill: "/next",
      startedAt: "2026-06-01T00:00:00.000Z",
      endedAt: "2026-06-01T01:00:00.000Z",
    };
    await writeFile(
      join(historyDir, "99-2026-06-01T01-00-00.000Z.json"),
      JSON.stringify(handoff, null, 2) + "\n",
    );

    const started = await startServer(rootDir, { stateRoot });
    server = started.server;
    const response = await fetch(`${started.baseUrl}/api/projects/portfolio/history`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { history: Array<{ pr: number; issue: number }> };
    expect(body.history).toHaveLength(1);
    expect(body.history[0]).toMatchObject({ pr: 99, issue: 9 });
  });

  it("records operator skip for an issue", async () => {
    const { rootDir, project, stateRoot } = await setupProjectRoot();
    const started = await startServer(rootDir, { stateRoot });
    server = started.server;

    const response = await fetch(`${started.baseUrl}/api/projects/portfolio/skip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issue: 15 }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "skipped", issue: 15 });

    const skipsPath = join(stateRoot, project.remote, "skips.json");
    const skips = JSON.parse(await (await import("node:fs/promises")).readFile(skipsPath, "utf8"));
    expect(skips).toEqual([15]);
  });

  it("removes operator skip for an issue", async () => {
    const { rootDir, project, stateRoot } = await setupProjectRoot();
    const skipsDir = join(stateRoot, project.remote);
    await mkdir(skipsDir, { recursive: true });
    await writeFile(join(skipsDir, "skips.json"), JSON.stringify([10, 15], null, 2) + "\n");

    const started = await startServer(rootDir, { stateRoot });
    server = started.server;

    const response = await fetch(`${started.baseUrl}/api/projects/portfolio/skip`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issue: 15 }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "unskipped", issue: 15 });

    const skipsPath = join(stateRoot, project.remote, "skips.json");
    const skips = JSON.parse(await (await import("node:fs/promises")).readFile(skipsPath, "utf8"));
    expect(skips).toEqual([10]);
  });

  it("starts, pauses, and kills a project worker", async () => {
    const { rootDir, stateRoot } = await setupProjectRoot();
    const eventBus = createEventBus();
    let releaseLoop: (() => void) | undefined;
    const loopStarted = new Promise<void>((resolve) => {
      releaseLoop = resolve;
    });

    const workerManager = createWorkerManager({
      eventBus,
      loopProject: async () => {
        await loopStarted;
        return { status: "queue-empty", slicesCompleted: 0 };
      },
    });

    const started = await startServer(rootDir, {
      stateRoot,
      eventBus,
      workerManager,
    });
    server = started.server;

    const startResponse = await fetch(`${started.baseUrl}/api/projects/portfolio/start`, {
      method: "POST",
    });
    expect(startResponse.status).toBe(202);
    expect(await startResponse.json()).toEqual({ status: "started" });

    const pauseResponse = await fetch(`${started.baseUrl}/api/projects/portfolio/pause`, {
      method: "POST",
    });
    expect(pauseResponse.status).toBe(200);
    expect(await pauseResponse.json()).toEqual({ status: "paused" });

    const killResponse = await fetch(`${started.baseUrl}/api/projects/portfolio/kill`, {
      method: "POST",
    });
    expect(killResponse.status).toBe(200);
    expect(await killResponse.json()).toEqual({ status: "killed" });

    releaseLoop?.();
  });

  it("streams incremental phase-log over SSE before the worker stops", async () => {
    const { rootDir, project, stateRoot } = await setupProjectRoot();
    const eventBus = createEventBus();

    const runProjectDeps: RunProjectDeps = {
      mutex: createInMemoryProjectMutex(),
      loadRegistry: async () => [project],
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
        options.onAgentStreamEvent?.({
          type: "text",
          message: "alpha\n",
          iteration: 1,
          timestamp: new Date("2026-06-01T12:00:00.000Z"),
        });
        await new Promise((resolve) => setTimeout(resolve, 80));
        options.onAgentStreamEvent?.({
          type: "text",
          message: "beta\n",
          iteration: 2,
          timestamp: new Date("2026-06-01T12:00:01.000Z"),
        });
        await new Promise((resolve) => setTimeout(resolve, 80));
        return {
          commits: [],
          branch: options.branch,
          completionSignal: PHASE_COMPLETE_SIGNAL,
          handoff: {
            ...reviewHandoff(12),
            phase: options.phase,
          },
        };
      },
      runNext: async () => ({ status: QUEUE_EMPTY }),
      runMergeGate: async () => ({ status: "auto-merge-queued" }),
      waitForMergedPr: async () => {},
    };

    const workerManager = createWorkerManager({
      eventBus,
      loopProject: (input, deps) => loopProject({ ...input, issue: 12 }, deps),
    });

    const started = await startServer(rootDir, {
      stateRoot,
      eventBus,
      workerManager,
      runProjectDeps,
    });
    server = started.server;

    const sseEvents: DashboardEvent[] = [];
    const response = await fetch(`${started.baseUrl}/api/projects/portfolio/events`);
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    const readSse = (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        const chunk = decoder.decode(value);
        for (const block of chunk.split("\n\n")) {
          if (!block.includes("data:")) {
            continue;
          }
          const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
          if (dataLine) {
            sseEvents.push(JSON.parse(dataLine.slice("data: ".length)) as DashboardEvent);
          }
        }
        const phaseLogCount = sseEvents.filter((event) => event.type === "phase-log").length;
        if (phaseLogCount >= 2 && sseEvents.some((event) => event.type === "worker-stopped")) {
          break;
        }
      }
    })();

    const startResponse = await fetch(`${started.baseUrl}/api/projects/portfolio/start`, {
      method: "POST",
    });
    expect(startResponse.status).toBe(202);

    await Promise.race([
      readSse,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("Timed out waiting for incremental phase-log SSE")), 5_000),
      ),
    ]);
    await reader.cancel();

    const phaseLogEvents = sseEvents.filter((event) => event.type === "phase-log");
    const workerStoppedIndex = sseEvents.findIndex((event) => event.type === "worker-stopped");
    const lastPhaseLogIndex = sseEvents.reduce(
      (last, event, index) => (event.type === "phase-log" ? index : last),
      -1,
    );

    expect(phaseLogEvents.length).toBeGreaterThan(1);
    expect(lastPhaseLogIndex).toBeLessThan(workerStoppedIndex);
    expect(phaseLogEvents.map((event) => event.chunk).join("")).toBe("alpha\nbeta\n");
  });

  it("streams project events over SSE", async () => {
    const { rootDir } = await setupProjectRoot();
    const eventBus = createEventBus();
    const started = await startServer(rootDir, { eventBus });
    server = started.server;

    const events: unknown[] = [];
    const response = await fetch(`${started.baseUrl}/api/projects/portfolio/events`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    eventBus.emit({ type: "phase-log", projectId: "portfolio", chunk: "hello" });

    while (events.length < 2) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      const chunk = decoder.decode(value);
      for (const block of chunk.split("\n\n")) {
        if (!block.includes("data:")) {
          continue;
        }
        const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
        if (dataLine) {
          events.push(JSON.parse(dataLine.slice("data: ".length)));
        }
      }
    }
    reader.cancel();

    expect(events[0]).toEqual({
      type: "connected",
      projectId: "portfolio",
      workerStatus: "idle",
    });
    expect(events[1]).toEqual({
      type: "phase-log",
      projectId: "portfolio",
      chunk: "hello",
    });
  });

  it("includes orchestrator status in the SSE connected event when a worker is running", async () => {
    const { rootDir, stateRoot } = await setupProjectRoot();
    const eventBus = createEventBus();
    let releaseLoop: (() => void) | undefined;
    const loopStarted = new Promise<void>((resolve) => {
      releaseLoop = resolve;
    });

    const workerManager = createWorkerManager({
      eventBus,
      loopProject: async () => {
        await loopStarted;
        return { status: "queue-empty", slicesCompleted: 0 };
      },
    });

    const started = await startServer(rootDir, {
      stateRoot,
      eventBus,
      workerManager,
    });
    server = started.server;

    await fetch(`${started.baseUrl}/api/projects/portfolio/start`, { method: "POST" });

    const response = await fetch(`${started.baseUrl}/api/projects/portfolio/events`);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const events: unknown[] = [];

    while (events.length < 1) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      const chunk = decoder.decode(value);
      for (const block of chunk.split("\n\n")) {
        if (!block.includes("data:")) {
          continue;
        }
        const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
        if (dataLine) {
          events.push(JSON.parse(dataLine.slice("data: ".length)));
        }
      }
    }
    reader.cancel();
    releaseLoop?.();

    expect(events[0]).toEqual({
      type: "connected",
      projectId: "portfolio",
      workerStatus: "running",
    });
  });

  it("streams agent events tagged with issue and phase over SSE", async () => {
    const { rootDir } = await setupProjectRoot();
    const eventBus = createEventBus();
    const started = await startServer(rootDir, { eventBus });
    server = started.server;

    const events: unknown[] = [];
    const response = await fetch(`${started.baseUrl}/api/projects/portfolio/events`);
    expect(response.status).toBe(200);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    eventBus.emit({
      type: "stream",
      projectId: "portfolio",
      issue: 12,
      phase: "tdd",
    });

    while (events.length < 2) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      const chunk = decoder.decode(value);
      for (const block of chunk.split("\n\n")) {
        if (!block.includes("data:")) {
          continue;
        }
        const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
        if (dataLine) {
          events.push(JSON.parse(dataLine.slice("data: ".length)));
        }
      }
    }
    reader.cancel();

    expect(events[0]).toEqual({
      type: "connected",
      projectId: "portfolio",
      workerStatus: "idle",
    });
    expect(events[1]).toEqual({
      type: "stream",
      projectId: "portfolio",
      issue: 12,
      phase: "tdd",
    });
  });

  it("completes an active worker when SSE disconnects during live stream events", async () => {
    const { rootDir, project, stateRoot } = await setupProjectRoot();
    const eventBus = createEventBus();
    const events: DashboardEvent[] = [];
    eventBus.subscribe("portfolio", (event) => events.push(event));

    const workerManager = createWorkerManager({
      eventBus,
      loopProject: (input, deps) => loopProject({ ...input, issue: 12 }, deps),
    });

    const runProjectDeps: RunProjectDeps = {
      mutex: createInMemoryProjectMutex(),
      loadRegistry: async () => [project],
      runLinearSlice: async (options, sliceDeps) => {
        await sliceDeps!.runPhase({
          phase: "tdd",
          branch: options.branch,
          projectPath: options.projectPath,
          projectId: options.projectId,
          stateRoot: options.stateRoot,
        });
        await sliceDeps!.runPhase({
          phase: "review-pr",
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
          phasesCompleted: [
            "tdd",
            "create-pr",
            "review-pr",
            "review-tdd",
            "merge",
          ],
        };
      },
      runPhase: async (options) => {
        options.onAgentStreamEvent?.({
          type: "text",
          message: `streaming ${options.phase}`,
          iteration: 1,
          timestamp: new Date("2026-06-01T12:00:00.000Z"),
        });
        return {
          commits: [],
          branch: options.branch,
          completionSignal: PHASE_COMPLETE_SIGNAL,
          handoff:
            options.phase === "review-pr"
              ? reviewHandoff(12)
              : {
                  ...reviewHandoff(12),
                  phase: options.phase,
                  pr: undefined,
                },
        };
      },
      runNext: async () => ({ status: QUEUE_EMPTY }),
      runMergeGate: async () => ({ status: "auto-merge-queued" }),
      waitForMergedPr: async () => {},
    };

    const started = await startServer(rootDir, {
      stateRoot,
      eventBus,
      workerManager,
      runProjectDeps,
    });
    server = started.server;

    const sseResponse = await fetch(`${started.baseUrl}/api/projects/portfolio/events`);
    expect(sseResponse.status).toBe(200);
    await sseResponse.body!.cancel();

    const startResponse = await fetch(`${started.baseUrl}/api/projects/portfolio/start`, {
      method: "POST",
    });
    expect(startResponse.status).toBe(202);

    await waitForDashboardEvent(events, "worker-stopped");

    expect(events).toContainEqual({
      type: "worker-stopped",
      projectId: "portfolio",
      lastRunOutcome: {
        outcome: "queue-empty",
        stoppedAt: expect.any(String),
      },
    });
    expect(events.some((event) => event.type === "stream")).toBe(true);
  });

  it("keeps publishing when an SSE client disconnects", async () => {
    const { rootDir } = await setupProjectRoot();
    const eventBus = createEventBus();
    const started = await startServer(rootDir, { eventBus });
    server = started.server;

    const response = await fetch(`${started.baseUrl}/api/projects/portfolio/events`);
    expect(response.status).toBe(200);
    await response.body!.cancel();

    expect(() => {
      eventBus.emit({
        type: "stream",
        projectId: "portfolio",
        issue: 12,
        phase: "tdd",
      });
    }).not.toThrow();

    const delivered: DashboardEvent[] = [];
    eventBus.subscribe("portfolio", (event) => {
      delivered.push(event);
    });
    eventBus.emit({
      type: "phase-log",
      projectId: "portfolio",
      chunk: "after-disconnect",
    });

    await new Promise<void>((resolve) => {
      queueMicrotask(() => resolve());
    });
    expect(delivered).toEqual([
      { type: "phase-log", projectId: "portfolio", chunk: "after-disconnect" },
    ]);
  });

  it("serves the built Vite app from the static directory", async () => {
    const { rootDir } = await setupProjectRoot();
    const staticDir = join(rootDir, "dashboard", "dist");
    await mkdir(staticDir, { recursive: true });
    await writeFile(join(staticDir, "index.html"), "<!doctype html><title>Dashboard</title>");

    const started = await startServer(rootDir, { staticDir });
    server = started.server;
    const response = await fetch(`${started.baseUrl}/`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Dashboard");
  });

  it("rejects static paths outside the build directory", async () => {
    const { rootDir } = await setupProjectRoot();
    const staticDir = join(rootDir, "dashboard", "dist");
    await mkdir(staticDir, { recursive: true });
    await writeFile(join(staticDir, "index.html"), "<!doctype html><title>Dashboard</title>");
    await writeFile(join(rootDir, "secret.txt"), "nope");

    const started = await startServer(rootDir, { staticDir });
    server = started.server;
    const address = started.server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const statusCode = await new Promise<number>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port, path: "/../../secret.txt", method: "GET" },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 500);
        },
      );
      req.on("error", reject);
      req.end();
    });

    expect(statusCode).toBe(404);
  });

  it("binds to localhost only", async () => {
    const { rootDir } = await setupProjectRoot();
    const started = await startServer(rootDir);
    server = started.server;

    const address = server.address();
    expect(address).toMatchObject({ address: "127.0.0.1" });
  });

  it("returns 404 for unknown projects", async () => {
    const { rootDir } = await setupProjectRoot();
    const started = await startServer(rootDir);
    server = started.server;

    const response = await fetch(`${started.baseUrl}/api/projects/missing/active`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Unknown project: missing" });
  });
});

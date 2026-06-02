// @vitest-environment node
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEventBus } from "../src/server/eventBus.js";
import { createWorkerManager } from "../src/server/workerManager.js";
import { resolveServerLogPath } from "../src/phaseLogs/index.js";

async function waitForFileContains(path: string, needle: string): Promise<string> {
  const startedAt = Date.now();
  for (;;) {
    try {
      const text = await readFile(path, "utf8");
      if (text.includes(needle)) {
        return text;
      }
    } catch {
      // ignore
    }
    if (Date.now() - startedAt > 2_000) {
      throw new Error(`Timed out waiting for log write: ${path}`);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("server log capture", () => {
  it("captures console.log/warn during a worker run into <branch>-server.log and emits SSE events", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "server-log-project-"));
    await mkdir(join(projectPath, ".sandcastle", "logs"), { recursive: true });
    const eventBus = createEventBus();
    const events: Array<{ type: string; chunk?: string }> = [];
    eventBus.subscribe("p1", (e) => events.push(e));

    const workerManager = createWorkerManager({
      eventBus,
      loopProject: async (_input, deps) => {
        if (!deps?.runPhase) {
          throw new Error("Expected deps.runPhase to be provided");
        }
        await deps.runPhase({
          phase: "tdd",
          branch: "issue-123",
          projectPath,
          projectId: "p1",
          stateRoot: "/tmp/state",
        });
        return { status: "queue-empty", slicesCompleted: 1 };
      },
    });

    await workerManager.start(
      { id: "p1", path: projectPath, remote: "HaDuve/Portfolio", defaultBase: "main", afkLabel: "ready-for-agent", blockedLabels: [], autoMerge: true, concurrency: "single", sandbox: "none" },
      {
        rootDir: "/tmp/root",
        stateRoot: "/tmp/state",
        deps: {
          runPhase: async () => {
            console.log("alpha");
            console.warn("beta");
            return {
              commits: [],
              branch: "issue-123",
              completionSignal: "<promise>PHASE_COMPLETE</promise>",
              handoff: {
                project: "HaDuve/Portfolio",
                issue: 123,
                branch: "issue-123",
                phase: "tdd",
                acceptanceState: "done",
                blockers: [],
                mergeReady: false,
                nextSkill: "/create-pr",
                startedAt: "2026-06-01T00:00:00.000Z",
                endedAt: "2026-06-01T01:00:00.000Z",
              },
            };
          },
        },
      },
    );

    const logPath = resolveServerLogPath({ projectPath, branch: "issue-123" });
    const contents = await waitForFileContains(logPath, "alpha");
    expect(contents).toContain("alpha\n");
    expect(contents).toContain("beta\n");

    const serverLogEvents = events.filter((e) => e.type === "server-log");
    expect(serverLogEvents.map((e) => e.chunk).join("")).toContain("alpha\n");
    expect(serverLogEvents.map((e) => e.chunk).join("")).toContain("beta\n");
  });

  it("does not capture console output outside a worker context", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "server-log-project-"));
    console.log("outside");
    const logPath = resolveServerLogPath({ projectPath, branch: "issue-1" });
    await expect(readFile(logPath, "utf8")).rejects.toBeTruthy();
  });
});


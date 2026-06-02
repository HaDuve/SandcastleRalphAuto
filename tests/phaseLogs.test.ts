import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { listPhaseLogs, readPhaseLog, startTailPhaseLog } from "../src/phaseLogs/index.js";

describe("phase logs service", () => {
  async function setupProject(): Promise<{
    rootDir: string;
    projectPath: string;
    projectId: string;
  }> {
    const rootDir = await mkdtemp(join(tmpdir(), "phase-logs-root-"));
    const projectPath = await mkdtemp(join(tmpdir(), "phase-logs-project-"));
    const projectId = "HaDuve/SandcastleRalphAuto";
    await writeFile(
      join(rootDir, "projects.json"),
      JSON.stringify(
        {
          projects: [
            {
              id: "ralph",
              path: projectPath,
              remote: projectId,
              defaultBase: "main",
              afkLabel: "ready-for-agent",
              blockedLabels: [],
              autoMerge: true,
              concurrency: "single",
              sandbox: "none",
            },
          ],
        },
        null,
        2,
      ),
    );
    return { rootDir, projectPath, projectId };
  }

  it("lists phases with logs in canonical pipeline order", async () => {
    const { rootDir, projectPath, projectId } = await setupProject();
    const logsDir = join(projectPath, ".sandcastle", "logs");
    await mkdir(logsDir, { recursive: true });

    // Create out-of-order; result must still be canonical order.
    await writeFile(join(logsDir, "issue-7-review-pr.log"), "review-pr\n");
    await writeFile(join(logsDir, "issue-7-tdd.log"), "tdd\n");
    await writeFile(join(logsDir, "issue-7-merge.log"), "merge\n");

    await expect(listPhaseLogs(projectId, 7, { rootDir })).resolves.toEqual([
      "tdd",
      "review-pr",
      "merge",
    ]);
  });

  it("returns empty list when no logs exist", async () => {
    const { rootDir, projectId } = await setupProject();
    await expect(listPhaseLogs(projectId, 99, { rootDir })).resolves.toEqual([]);
  });

  it("reads an existing phase log and returns null for missing logs", async () => {
    const { rootDir, projectPath, projectId } = await setupProject();
    const logsDir = join(projectPath, ".sandcastle", "logs");
    await mkdir(logsDir, { recursive: true });
    await writeFile(join(logsDir, "issue-42-create-pr.log"), "hello\n");

    await expect(
      readPhaseLog(projectId, 42, "create-pr", { rootDir }),
    ).resolves.toBe("hello\n");

    await expect(readPhaseLog(projectId, 42, "tdd", { rootDir })).resolves.toBe(
      null,
    );
  });

  it("includes recovery phase logs in runnable pipeline order", async () => {
    const { rootDir, projectPath, projectId } = await setupProject();
    const logsDir = join(projectPath, ".sandcastle", "logs");
    await mkdir(logsDir, { recursive: true });
    await writeFile(join(logsDir, "issue-7-babysit.log"), "babysit\n");
    await writeFile(join(logsDir, "issue-7-merge.log"), "merge\n");

    await expect(listPhaseLogs(projectId, 7, { rootDir })).resolves.toEqual([
      "merge",
      "babysit",
    ]);
  });

  it("emits incremental chunks as a simulated log file grows", async () => {
    vi.useFakeTimers();
    const chunks: string[] = [];
    let content = "";

    const handle = startTailPhaseLog({
      logPath: "/tmp/growing.log",
      pollIntervalMs: 50,
      readTextFile: async () => content,
      onChunk: (chunk) => chunks.push(chunk),
    });

    content = "alpha\n";
    await vi.advanceTimersByTimeAsync(50);

    content = "alpha\nbeta\n";
    await vi.advanceTimersByTimeAsync(50);

    await handle.stop();

    expect(chunks).toEqual(["alpha\n", "beta\n"]);
    vi.useRealTimers();
  });

  it("flushes remaining content on stop", async () => {
    const chunks: string[] = [];
    let content = "";
    const handle = startTailPhaseLog({
      logPath: "/tmp/final.log",
      pollIntervalMs: 60_000,
      readTextFile: async () => content,
      onChunk: (chunk) => chunks.push(chunk),
    });

    content = "tail\n";
    await handle.stop();

    expect(chunks).toEqual(["tail\n"]);
  });

  it("treats ENOENT during read as a missing log (no crash)", async () => {
    const { rootDir, projectId } = await setupProject();

    await expect(
      readPhaseLog(projectId, 7, "tdd", {
        rootDir,
        readTextFile: async () => {
          const err = new Error("missing") as Error & { code?: string };
          err.code = "ENOENT";
          throw err;
        },
      }),
    ).resolves.toBeNull();
  });
});


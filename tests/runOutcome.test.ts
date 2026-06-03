import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readRunOutcome,
  StateError,
  writeRunOutcome,
  type RunOutcome,
} from "../src/state/index.js";

const projectId = "HaDuve/SandcastleRalphAuto";
const stoppedAt = "2026-06-01T12:00:00.000Z";

describe("readRunOutcome", () => {
  it("returns null when run.json is missing", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "run-outcome-test-"));

    const outcome = await readRunOutcome(projectId, stateRoot);

    expect(outcome).toBeNull();
  });
});

describe("writeRunOutcome / readRunOutcome", () => {
  async function stateRoot(): Promise<string> {
    return mkdtemp(join(tmpdir(), "run-outcome-test-"));
  }

  async function expectRoundTrip(
    root: string,
    outcome: RunOutcome,
  ): Promise<void> {
    await writeRunOutcome(projectId, outcome, root);
    await expect(readRunOutcome(projectId, root)).resolves.toEqual(outcome);

    const raw = await readFile(join(root, projectId, "run.json"), "utf8");
    expect(JSON.parse(raw)).toEqual(outcome);
  }

  it("round-trips queue-empty", async () => {
    await expectRoundTrip(await stateRoot(), {
      outcome: "queue-empty",
      stoppedAt,
    });
  });

  it("round-trips queue-empty with merged-tail recovery warning", async () => {
    await expectRoundTrip(await stateRoot(), {
      outcome: "queue-empty",
      stoppedAt,
      recoveryWarning:
        "Merged-tail recovery exhausted for issue #101 (PR #113); advanced queue with warning",
    });
  });

  it("round-trips blocked with reason, phase, and logRef", async () => {
    await expectRoundTrip(await stateRoot(), {
      outcome: "blocked",
      reason: "Required check ci failed",
      phase: "review-tdd",
      stoppedAt,
      logRef: "/tmp/project/.sandcastle/logs/issue-7-review-tdd.log",
    });
  });

  it("round-trips host-level blocked with reason only (no active slice)", async () => {
    await expectRoundTrip(await stateRoot(), {
      outcome: "blocked",
      reason: "Could not parse issues from gh",
      stoppedAt,
    });
  });

  it("round-trips awaiting-human with reason, phase, and logRef", async () => {
    await expectRoundTrip(await stateRoot(), {
      outcome: "awaiting-human",
      reason: "autoMerge is disabled for this project",
      phase: "merge",
      stoppedAt,
      logRef: "/tmp/project/.sandcastle/logs/issue-7-merge.log",
    });
  });

  it("round-trips killed", async () => {
    await expectRoundTrip(await stateRoot(), {
      outcome: "killed",
      stoppedAt,
    });
  });

  it("round-trips error with reason and optional logRef", async () => {
    await expectRoundTrip(await stateRoot(), {
      outcome: "error",
      reason: "Project HaDuve/Portfolio is already running",
      stoppedAt,
      logRef: "/tmp/project/.sandcastle/logs/issue-7-tdd.log",
    });
  });

  it("writes atomically without leaving temp files", async () => {
    const root = await stateRoot();
    const stateDir = join(root, projectId);

    await writeRunOutcome(
      projectId,
      { outcome: "queue-empty", stoppedAt },
      root,
    );

    const files = await readdir(stateDir);
    expect(files).toEqual(["run.json"]);
    await expect(readRunOutcome(projectId, root)).resolves.toEqual({
      outcome: "queue-empty",
      stoppedAt,
    });
  });
});

describe("run outcome validation", () => {
  it("rejects blocked outcome without reason on write", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "run-outcome-test-"));

    const error = await writeRunOutcome(
      projectId,
      { outcome: "blocked", stoppedAt } as RunOutcome,
      stateRoot,
    ).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(StateError);
    expect((error as StateError).message).toMatch(/Invalid run outcome/);
  });

  it("rejects malformed run outcome on read with a clear error", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "run-outcome-test-"));
    const runPath = join(stateRoot, projectId, "run.json");
    await mkdir(join(runPath, ".."), { recursive: true });
    await writeFile(
      runPath,
      JSON.stringify({ outcome: "blocked", stoppedAt }),
    );

    const error = await readRunOutcome(projectId, stateRoot).catch(
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(StateError);
    expect((error as StateError).message).toMatch(/Invalid run outcome schema/);
  });
});

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readRunOutcome,
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

  it("round-trips blocked with reason, phase, and logRef", async () => {
    await expectRoundTrip(await stateRoot(), {
      outcome: "blocked",
      reason: "Required check ci failed",
      phase: "review-tdd",
      stoppedAt,
      logRef: "/tmp/project/.sandcastle/logs/issue-7-review-tdd.log",
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
});

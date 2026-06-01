import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HandoffError,
  readHandoff,
  resolveCurrentHandoffPath,
} from "../src/handoff/index.js";

const basePayload = {
  project: "HaDuve/SandcastleRalphAuto",
  issue: 29,
  branch: "issue-29",
  phase: "tdd",
  blockers: [] as string[],
  mergeReady: false,
  nextSkill: "/create-pr",
  startedAt: "2026-06-01T02:54:52.656Z",
  endedAt: "2026-06-01T16:10:30.000Z",
};

describe("readHandoff", () => {
  it("normalizes acceptanceState synonym complete to done", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "handoff-io-"));
    const path = resolveCurrentHandoffPath(rootDir);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({ ...basePayload, acceptanceState: "complete" }, null, 2),
    );

    const handoff = await readHandoff(rootDir);

    expect(handoff.acceptanceState).toBe("done");
  });

  it("rejects unknown acceptanceState values after synonym normalization", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "handoff-io-"));
    const path = resolveCurrentHandoffPath(rootDir);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({ ...basePayload, acceptanceState: "finished" }, null, 2),
    );

    const error = await readHandoff(rootDir).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(HandoffError);
    expect((error as HandoffError).message).toMatch(/Invalid handoff schema/);
  });
});

import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  archiveHandoff,
  HandoffError,
  readHandoff,
  writeHandoff,
  type Handoff,
} from "../src/handoff/index.js";

const sampleHandoff: Handoff = {
  project: "HaDuve/SandcastleRalphAuto",
  issue: 3,
  branch: "issue-3-handoff",
  phase: "tdd",
  acceptanceState: "done",
  blockers: [],
  mergeReady: false,
  nextSkill: "/create-pr",
  startedAt: "2026-06-01T00:00:00.000Z",
  endedAt: "2026-06-01T01:00:00.000Z",
};

describe("writeHandoff / readHandoff", () => {
  it("round-trips a valid handoff through current.json", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "handoff-test-"));

    await writeHandoff(sampleHandoff, rootDir);
    const read = await readHandoff(rootDir);

    expect(read).toEqual(sampleHandoff);

    const raw = await readFile(
      join(rootDir, ".sandcastle-ralph/handoff/current.json"),
      "utf8",
    );
    expect(JSON.parse(raw)).toEqual(sampleHandoff);
  });

  it("rejects malformed handoff on read with a clear error", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "handoff-test-"));
    const handoffPath = join(
      rootDir,
      ".sandcastle-ralph/handoff/current.json",
    );
    await mkdir(join(handoffPath, ".."), { recursive: true });
    await writeFile(
      handoffPath,
      JSON.stringify({ project: "HaDuve/SandcastleRalphAuto", issue: "3" }),
    );

    await expect(readHandoff(rootDir)).rejects.toThrow(HandoffError);
    await expect(readHandoff(rootDir)).rejects.toThrow(/Invalid handoff schema/);
  });

  it("rejects invalid JSON on read with a clear error", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "handoff-test-"));
    const handoffPath = join(
      rootDir,
      ".sandcastle-ralph/handoff/current.json",
    );
    await mkdir(join(handoffPath, ".."), { recursive: true });
    await writeFile(handoffPath, "{ not json");

    await expect(readHandoff(rootDir)).rejects.toThrow(HandoffError);
    await expect(readHandoff(rootDir)).rejects.toThrow(/Invalid JSON/);
  });

  it("rejects invalid handoff on write with a clear error", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "handoff-test-"));

    await expect(
      writeHandoff({ ...sampleHandoff, issue: "3" } as unknown as Handoff, rootDir),
    ).rejects.toThrow(HandoffError);
    await expect(
      writeHandoff({ ...sampleHandoff, issue: "3" } as unknown as Handoff, rootDir),
    ).rejects.toThrow(/Invalid handoff/);
  });
});

describe("archiveHandoff", () => {
  const archivedHandoff: Handoff = {
    ...sampleHandoff,
    pr: 42,
    phase: "merge",
    acceptanceState: "done",
    mergeReady: true,
    nextSkill: "/next",
  };

  it("moves current handoff to history/<pr>-<iso>.json", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "handoff-test-"));
    const fixedDate = new Date("2026-06-01T12:30:45.123Z");

    await writeHandoff(archivedHandoff, rootDir);
    const archivePath = await archiveHandoff(rootDir, () => fixedDate);

    expect(archivePath).toBe(
      join(
        rootDir,
        ".sandcastle-ralph/handoff/history/42-2026-06-01T12-30-45.123Z.json",
      ),
    );

    const archived = JSON.parse(await readFile(archivePath, "utf8"));
    expect(archived).toEqual(archivedHandoff);

    await expect(readHandoff(rootDir)).rejects.toThrow(/Handoff not found/);
  });

  it("rejects archive when current handoff has no pr number", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "handoff-test-"));
    await writeHandoff(sampleHandoff, rootDir);

    await expect(archiveHandoff(rootDir)).rejects.toThrow(HandoffError);
    await expect(archiveHandoff(rootDir)).rejects.toThrow(/pr number/);
  });
});

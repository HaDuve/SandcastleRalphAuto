import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HandoffError,
  archiveHostHandoff,
  listHandoffHistory,
  readHostHandoff,
  writeHostHandoff,
  type Handoff,
} from "../src/handoff/index.js";

const PROJECT_ID = "HaDuve/SandcastleRalphAuto";

const sampleHandoff: Handoff = {
  project: PROJECT_ID,
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

describe("host handoff store", () => {
  it("round-trips a valid handoff through state/<projectId>/handoff/current.json", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "handoff-test-"));
    const stateRoot = join(rootDir, "state");

    await writeHostHandoff({ stateRoot, projectId: PROJECT_ID, handoff: sampleHandoff });
    const read = await readHostHandoff({ stateRoot, projectId: PROJECT_ID });

    expect(read).toEqual(sampleHandoff);

    const raw = await readFile(
      join(stateRoot, PROJECT_ID, "handoff/current.json"),
      "utf8",
    );
    expect(JSON.parse(raw)).toEqual(sampleHandoff);
  });

  it("writes atomically without leaving temp files", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "handoff-test-"));
    const stateRoot = join(rootDir, "state");
    const handoffDir = join(stateRoot, PROJECT_ID, "handoff");

    await writeHostHandoff({ stateRoot, projectId: PROJECT_ID, handoff: sampleHandoff });

    const files = await readdir(handoffDir);
    expect(files).toEqual(["current.json"]);
    await expect(readHostHandoff({ stateRoot, projectId: PROJECT_ID })).resolves.toEqual(sampleHandoff);
  });

  it("rejects read when current.json is missing", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "handoff-test-"));
    const stateRoot = join(rootDir, "state");

    const error = await readHostHandoff({ stateRoot, projectId: PROJECT_ID }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(HandoffError);
    expect((error as HandoffError).message).toMatch(/Handoff not found/);
  });

  it("rejects malformed handoff on read with a clear error", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "handoff-test-"));
    const stateRoot = join(rootDir, "state");
    const handoffPath = join(
      stateRoot,
      PROJECT_ID,
      "handoff/current.json",
    );
    await mkdir(join(handoffPath, ".."), { recursive: true });
    await writeFile(
      handoffPath,
      JSON.stringify({ project: "HaDuve/SandcastleRalphAuto", issue: "3" }),
    );

    const error = await readHostHandoff({ stateRoot, projectId: PROJECT_ID }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(HandoffError);
    expect((error as HandoffError).message).toMatch(/Invalid handoff schema/);
  });

  it("rejects invalid JSON on read with a clear error", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "handoff-test-"));
    const stateRoot = join(rootDir, "state");
    const handoffPath = join(
      stateRoot,
      PROJECT_ID,
      "handoff/current.json",
    );
    await mkdir(join(handoffPath, ".."), { recursive: true });
    await writeFile(handoffPath, "{ not json");

    const error = await readHostHandoff({ stateRoot, projectId: PROJECT_ID }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(HandoffError);
    expect((error as HandoffError).message).toMatch(/Invalid JSON/);
  });

  it("accepts babysit phase in handoff schema", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "handoff-test-"));
    const stateRoot = join(rootDir, "state");
    const babysitHandoff: Handoff = {
      ...sampleHandoff,
      pr: 88,
      phase: "babysit",
      nextSkill: "/merge",
    };

    await writeHostHandoff({ stateRoot, projectId: PROJECT_ID, handoff: babysitHandoff });
    await expect(readHostHandoff({ stateRoot, projectId: PROJECT_ID })).resolves.toEqual(
      babysitHandoff,
    );
  });

  it("persists acceptanceState done when write receives complete synonym", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "handoff-test-"));
    const stateRoot = join(rootDir, "state");
    const withSynonym = {
      ...sampleHandoff,
      acceptanceState: "complete",
    } as unknown as Handoff;

    await writeHostHandoff({
      stateRoot,
      projectId: PROJECT_ID,
      handoff: withSynonym,
    });

    const read = await readHostHandoff({ stateRoot, projectId: PROJECT_ID });
    expect(read.acceptanceState).toBe("done");

    const raw = JSON.parse(
      await readFile(
        join(stateRoot, PROJECT_ID, "handoff/current.json"),
        "utf8",
      ),
    ) as Handoff;
    expect(raw.acceptanceState).toBe("done");
  });

  it("rejects invalid handoff on write with a clear error", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "handoff-test-"));
    const stateRoot = join(rootDir, "state");

    const error = await writeHostHandoff({
      stateRoot,
      projectId: PROJECT_ID,
      handoff: { ...sampleHandoff, issue: "3" } as unknown as Handoff,
    }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(HandoffError);
    expect((error as HandoffError).message).toMatch(/Invalid handoff/);
  });
});

describe("archiveHostHandoff", () => {
  const archivedHandoff: Handoff = {
    ...sampleHandoff,
    pr: 42,
    phase: "merge",
    acceptanceState: "done",
    mergeReady: true,
    nextSkill: "/next",
  };

  it("moves current handoff to state/<projectId>/handoff/history/<pr>-<iso>.json", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "handoff-test-"));
    const stateRoot = join(rootDir, "state");
    const fixedDate = new Date("2026-06-01T12:30:45.123Z");

    await writeHostHandoff({ stateRoot, projectId: PROJECT_ID, handoff: archivedHandoff });
    const archivePath = await archiveHostHandoff(
      { stateRoot, projectId: PROJECT_ID },
      () => fixedDate,
    );

    expect(archivePath).toBe(
      join(
        stateRoot,
        PROJECT_ID,
        "handoff/history/42-2026-06-01T12-30-45.123Z.json",
      ),
    );

    const archived = JSON.parse(await readFile(archivePath, "utf8"));
    expect(archived).toEqual(archivedHandoff);

    await expect(readHostHandoff({ stateRoot, projectId: PROJECT_ID })).rejects.toThrow(
      /Handoff not found/,
    );
  });

  it("rejects archive when current handoff has no pr number", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "handoff-test-"));
    const stateRoot = join(rootDir, "state");
    await writeHostHandoff({ stateRoot, projectId: PROJECT_ID, handoff: sampleHandoff });

    const error = await archiveHostHandoff({ stateRoot, projectId: PROJECT_ID }).catch(
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(HandoffError);
    expect((error as HandoffError).message).toMatch(/pr number/);
  });
});

describe("listHandoffHistory", () => {
  it("lists archived handoffs from state/<projectId>/handoff/history/", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "handoff-test-"));
    const stateRoot = join(rootDir, "state");
    const archivedHandoff: Handoff = {
      ...sampleHandoff,
      pr: 55,
      phase: "merge",
      acceptanceState: "done",
      mergeReady: true,
      nextSkill: "/next",
    };

    await writeHostHandoff({ stateRoot, projectId: PROJECT_ID, handoff: archivedHandoff });
    await archiveHostHandoff(
      { stateRoot, projectId: PROJECT_ID },
      () => new Date("2026-06-01T15:00:00.000Z"),
    );

    const history = await listHandoffHistory({ stateRoot, projectId: PROJECT_ID });

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      pr: 55,
      issue: sampleHandoff.issue,
      branch: sampleHandoff.branch,
    });
  });
});

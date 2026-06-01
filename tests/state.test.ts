import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readActive,
  readSkips,
  StateError,
  writeActive,
  writeSkips,
  type ActiveState,
} from "../src/state/index.js";

describe("readSkips", () => {
  it("returns an empty list when skips.json is missing", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "state-test-"));

    const skips = await readSkips("HaDuve/SandcastleRalphAuto", stateRoot);

    expect(skips).toEqual([]);
  });
});

describe("readActive", () => {
  it("returns null when active.json is missing", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "state-test-"));

    const active = await readActive("HaDuve/SandcastleRalphAuto", stateRoot);

    expect(active).toBeNull();
  });
});

describe("writeActive / readActive", () => {
  const sampleActive: ActiveState = {
    issue: 4,
    phase: "review-pr",
    branch: "issue-4-state-store",
    pr: 17,
    status: "active",
  };

  it("round-trips an active slice", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "state-test-"));
    const projectId = "HaDuve/SandcastleRalphAuto";

    await writeActive(projectId, sampleActive, stateRoot);
    const active = await readActive(projectId, stateRoot);

    expect(active).toEqual(sampleActive);

    const raw = await readFile(
      join(stateRoot, projectId, "active.json"),
      "utf8",
    );
    expect(JSON.parse(raw)).toEqual(sampleActive);
  });

  it("persists awaiting-human state when autoMerge is disabled", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "state-test-"));
    const awaitingHuman: ActiveState = {
      issue: 4,
      phase: "merge",
      branch: "issue-4-state-store",
      pr: 17,
      status: "awaiting-human",
      reason: "autoMerge is disabled for this project",
    };

    await writeActive("HaDuve/SandcastleRalphAuto", awaitingHuman, stateRoot);

    await expect(
      readActive("HaDuve/SandcastleRalphAuto", stateRoot),
    ).resolves.toEqual(awaitingHuman);
  });

  it("persists blocked state with reason and resume skill", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "state-test-"));
    const blocked: ActiveState = {
      issue: 4,
      phase: "merge",
      branch: "issue-4-state-store",
      pr: 17,
      status: "blocked",
      reason: "Required check ci failed",
      resumeSkill: "/review-tdd",
    };

    await writeActive("HaDuve/SandcastleRalphAuto", blocked, stateRoot);

    await expect(
      readActive("HaDuve/SandcastleRalphAuto", stateRoot),
    ).resolves.toEqual(blocked);
  });

  it("writes atomically without leaving temp files", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "state-test-"));
    const projectId = "HaDuve/SandcastleRalphAuto";
    const stateDir = join(stateRoot, projectId);

    await writeActive(projectId, sampleActive, stateRoot);

    const files = await readdir(stateDir);
    expect(files).toEqual(["active.json"]);
    await expect(readActive(projectId, stateRoot)).resolves.toEqual(
      sampleActive,
    );
  });
});

describe("writeSkips / readSkips", () => {
  it("round-trips skipped issue numbers", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "state-test-"));
    const projectId = "HaDuve/SandcastleRalphAuto";

    await writeSkips(projectId, [4, 12, 99], stateRoot);
    const skips = await readSkips(projectId, stateRoot);

    expect(skips).toEqual([4, 12, 99]);

    const raw = await readFile(
      join(stateRoot, projectId, "skips.json"),
      "utf8",
    );
    expect(JSON.parse(raw)).toEqual([4, 12, 99]);
  });

  it("writes atomically without leaving temp files", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "state-test-"));
    const projectId = "HaDuve/SandcastleRalphAuto";
    const stateDir = join(stateRoot, projectId);

    await writeSkips(projectId, [4], stateRoot);

    const files = await readdir(stateDir);
    expect(files).toEqual(["skips.json"]);
    await expect(readSkips(projectId, stateRoot)).resolves.toEqual([4]);
  });

  it("rejects invalid skips on write with a clear error", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "state-test-"));

    const error = await writeSkips(
      "HaDuve/SandcastleRalphAuto",
      [0, -1],
      stateRoot,
    ).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(StateError);
    expect((error as StateError).message).toMatch(/Invalid skips/);
  });

  it("rejects malformed skips on read with a clear error", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "state-test-"));
    const skipsPath = join(
      stateRoot,
      "HaDuve/SandcastleRalphAuto",
      "skips.json",
    );
    await mkdir(join(skipsPath, ".."), { recursive: true });
    await writeFile(skipsPath, JSON.stringify(["not-a-number"]));

    const error = await readSkips(
      "HaDuve/SandcastleRalphAuto",
      stateRoot,
    ).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(StateError);
    expect((error as StateError).message).toMatch(/Invalid skips schema/);
  });

  it("rejects invalid JSON on read with a clear error", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "state-test-"));
    const skipsPath = join(
      stateRoot,
      "HaDuve/SandcastleRalphAuto",
      "skips.json",
    );
    await mkdir(join(skipsPath, ".."), { recursive: true });
    await writeFile(skipsPath, "{ not json");

    const error = await readSkips(
      "HaDuve/SandcastleRalphAuto",
      stateRoot,
    ).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(StateError);
    expect((error as StateError).message).toMatch(/Invalid JSON/);
  });
});

describe("active state validation", () => {
  const sampleActive: ActiveState = {
    issue: 4,
    phase: "tdd",
    branch: "issue-4-state-store",
    status: "active",
  };

  it("rejects blocked state without reason and resume skill on write", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "state-test-"));

    const error = await writeActive(
      "HaDuve/SandcastleRalphAuto",
      {
        ...sampleActive,
        status: "blocked",
      },
      stateRoot,
    ).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(StateError);
    expect((error as StateError).message).toMatch(/Invalid active state/);
  });

  it("rejects blocked state without reason and resume skill on read", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "state-test-"));
    const activePath = join(
      stateRoot,
      "HaDuve/SandcastleRalphAuto",
      "active.json",
    );
    await mkdir(join(activePath, ".."), { recursive: true });
    await writeFile(
      activePath,
      JSON.stringify({
        issue: 4,
        phase: "merge",
        branch: "issue-4-state-store",
        status: "blocked",
      }),
    );

    const error = await readActive(
      "HaDuve/SandcastleRalphAuto",
      stateRoot,
    ).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(StateError);
    expect((error as StateError).message).toMatch(/Invalid active state schema/);
  });

  it("rejects invalid active state on write with a clear error", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "state-test-"));

    const error = await writeActive(
      "HaDuve/SandcastleRalphAuto",
      { ...sampleActive, issue: "4" } as unknown as ActiveState,
      stateRoot,
    ).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(StateError);
    expect((error as StateError).message).toMatch(/Invalid active state/);
  });

  it("rejects malformed active state on read with a clear error", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "state-test-"));
    const activePath = join(
      stateRoot,
      "HaDuve/SandcastleRalphAuto",
      "active.json",
    );
    await mkdir(join(activePath, ".."), { recursive: true });
    await writeFile(
      activePath,
      JSON.stringify({ issue: 4, status: "active" }),
    );

    const error = await readActive(
      "HaDuve/SandcastleRalphAuto",
      stateRoot,
    ).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(StateError);
    expect((error as StateError).message).toMatch(/Invalid active state schema/);
  });

  it("rejects invalid JSON on read with a clear error", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "state-test-"));
    const activePath = join(
      stateRoot,
      "HaDuve/SandcastleRalphAuto",
      "active.json",
    );
    await mkdir(join(activePath, ".."), { recursive: true });
    await writeFile(activePath, "{ not json");

    const error = await readActive(
      "HaDuve/SandcastleRalphAuto",
      stateRoot,
    ).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(StateError);
    expect((error as StateError).message).toMatch(/Invalid JSON/);
  });
});

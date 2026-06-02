import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureCursorignoreAllowsHandoff,
  HANDOFF_CURSORIGNORE_NEGATION,
  ensureCursorignoreAllowsSandcastleWorktrees,
  SANDCASTLE_WORKTREES_CURSORIGNORE_NEGATION,
  SANDCASTLE_WORKTREES_GLOB_NEGATION,
} from "../src/runner/cursorignore.js";

describe("ensureCursorignoreAllowsHandoff", () => {
  it("creates .cursorignore with handoff negation when absent", async () => {
    const worktreePath = await mkdtemp(join(tmpdir(), "cursorignore-"));

    await ensureCursorignoreAllowsHandoff(worktreePath);

    const content = await readFile(join(worktreePath, ".cursorignore"), "utf8");
    expect(content).toBe(`${HANDOFF_CURSORIGNORE_NEGATION}\n`);
  });

  it("appends handoff negation without clobbering existing content", async () => {
    const worktreePath = await mkdtemp(join(tmpdir(), "cursorignore-"));
    await writeFile(
      join(worktreePath, ".cursorignore"),
      "# existing\nnode_modules/\n",
      "utf8",
    );

    await ensureCursorignoreAllowsHandoff(worktreePath);

    const content = await readFile(join(worktreePath, ".cursorignore"), "utf8");
    expect(content).toBe(`# existing\nnode_modules/\n${HANDOFF_CURSORIGNORE_NEGATION}\n`);
  });

  it("is idempotent (does not add duplicate lines)", async () => {
    const worktreePath = await mkdtemp(join(tmpdir(), "cursorignore-"));
    await writeFile(
      join(worktreePath, ".cursorignore"),
      `${HANDOFF_CURSORIGNORE_NEGATION}\n`,
      "utf8",
    );

    await ensureCursorignoreAllowsHandoff(worktreePath);
    await ensureCursorignoreAllowsHandoff(worktreePath);

    const content = await readFile(join(worktreePath, ".cursorignore"), "utf8");
    expect(content).toBe(`${HANDOFF_CURSORIGNORE_NEGATION}\n`);
  });
});

describe("ensureCursorignoreAllowsSandcastleWorktrees", () => {
  it("creates .cursorignore with worktrees negations when absent", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "cursorignore-project-"));

    await ensureCursorignoreAllowsSandcastleWorktrees(projectPath);

    const content = await readFile(join(projectPath, ".cursorignore"), "utf8");
    expect(content).toBe(
      `${SANDCASTLE_WORKTREES_CURSORIGNORE_NEGATION}\n${SANDCASTLE_WORKTREES_GLOB_NEGATION}\n`,
    );
  });

  it("appends worktrees negations without clobbering existing content", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "cursorignore-project-"));
    await writeFile(
      join(projectPath, ".cursorignore"),
      ".sandcastle/worktrees/\n# keep logs ignored\n.sandcastle/logs/\n",
      "utf8",
    );

    await ensureCursorignoreAllowsSandcastleWorktrees(projectPath);

    const content = await readFile(join(projectPath, ".cursorignore"), "utf8");
    expect(content).toBe(
      `.sandcastle/worktrees/\n# keep logs ignored\n.sandcastle/logs/\n${SANDCASTLE_WORKTREES_CURSORIGNORE_NEGATION}\n${SANDCASTLE_WORKTREES_GLOB_NEGATION}\n`,
    );
  });

  it("is idempotent (does not add duplicate lines)", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "cursorignore-project-"));
    await writeFile(
      join(projectPath, ".cursorignore"),
      `${SANDCASTLE_WORKTREES_CURSORIGNORE_NEGATION}\n${SANDCASTLE_WORKTREES_GLOB_NEGATION}\n`,
      "utf8",
    );

    await ensureCursorignoreAllowsSandcastleWorktrees(projectPath);
    await ensureCursorignoreAllowsSandcastleWorktrees(projectPath);

    const content = await readFile(join(projectPath, ".cursorignore"), "utf8");
    expect(content).toBe(
      `${SANDCASTLE_WORKTREES_CURSORIGNORE_NEGATION}\n${SANDCASTLE_WORKTREES_GLOB_NEGATION}\n`,
    );
  });
});


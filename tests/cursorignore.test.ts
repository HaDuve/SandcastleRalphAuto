import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureCursorignoreAllowsHandoff,
  HANDOFF_CURSORIGNORE_NEGATION,
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


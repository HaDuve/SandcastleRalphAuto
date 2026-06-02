import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EOL } from "node:os";

export const HANDOFF_CURSORIGNORE_NEGATION = "!.sandcastle-ralph/handoff/";

function hasNegationLine(content: string): boolean {
  const lines = content.split(/\r?\n/);
  return lines.some((line) => line.trim() === HANDOFF_CURSORIGNORE_NEGATION);
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith("\n") || content.endsWith("\r\n") ? content : `${content}${EOL}`;
}

export async function ensureCursorignoreAllowsHandoff(
  worktreePath: string,
): Promise<void> {
  const cursorignorePath = join(worktreePath, ".cursorignore");
  let existing: string | null = null;
  try {
    existing = await readFile(cursorignorePath, "utf8");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      existing = null;
    } else {
      throw error;
    }
  }

  if (existing === null) {
    await writeFile(cursorignorePath, `${HANDOFF_CURSORIGNORE_NEGATION}${EOL}`, "utf8");
    return;
  }

  if (hasNegationLine(existing)) {
    return;
  }

  const next = `${ensureTrailingNewline(existing)}${HANDOFF_CURSORIGNORE_NEGATION}${EOL}`;
  await writeFile(cursorignorePath, next, "utf8");
}


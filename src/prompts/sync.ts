import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildPrompt } from "./build.js";
import { RUNNABLE_PHASES, type RunnablePhase } from "./phases.js";

export type PhaseSyncResult = {
  phase: RunnablePhase;
  changed: boolean;
  diff: string | null;
};

export type SyncSkillsResult = {
  promptsDir: string;
  skillsRoot: string;
  phases: PhaseSyncResult[];
};

export type SyncSkillsOptions = {
  promptsDir?: string;
  skillsRoot?: string;
};

function lineDiff(before: string, after: string): string | null {
  if (before === after) {
    return null;
  }
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const lines: string[] = [`--- snapshot`, `+++ ${afterLines.length} lines`];
  const max = Math.max(beforeLines.length, afterLines.length);
  let shown = 0;
  for (let i = 0; i < max && shown < 40; i++) {
    const a = beforeLines[i];
    const b = afterLines[i];
    if (a === b) {
      continue;
    }
    if (a !== undefined) {
      lines.push(`-${a}`);
      shown++;
    }
    if (b !== undefined) {
      lines.push(`+${b}`);
      shown++;
    }
  }
  if (shown >= 40) {
    lines.push("... (truncated)");
  }
  return lines.join("\n");
}

export async function syncSkills(
  options: SyncSkillsOptions = {},
): Promise<SyncSkillsResult> {
  const promptsDir = options.promptsDir ?? join(process.cwd(), "prompts");
  const skillsRoot =
    options.skillsRoot ?? join(homedir(), ".cursor", "skills");

  await mkdir(promptsDir, { recursive: true });

  const phases: PhaseSyncResult[] = [];

  for (const phase of RUNNABLE_PHASES) {
    const skillPath = join(skillsRoot, phase, "SKILL.md");
    const skillMarkdown = await readFile(skillPath, "utf8");
    const next = buildPrompt(phase, skillMarkdown);
    const promptPath = join(promptsDir, `${phase}.md`);

    let previous = "";
    try {
      previous = await readFile(promptPath, "utf8");
    } catch {
      // first sync creates the file
    }

    const changed = previous !== next;
    const diff = changed ? lineDiff(previous, next) : null;

    if (changed) {
      await writeFile(promptPath, next, "utf8");
    }

    phases.push({ phase, changed, diff });
  }

  return { promptsDir, skillsRoot, phases };
}

export function formatSyncReport(result: SyncSkillsResult): string {
  const lines: string[] = [
    `sync-skills: ${result.skillsRoot} → ${result.promptsDir}`,
    "",
  ];

  for (const { phase, changed, diff } of result.phases) {
    if (!changed) {
      lines.push(`${phase}: up to date`);
      continue;
    }
    lines.push(`${phase}: updated`);
    if (diff) {
      lines.push(diff);
    }
    lines.push("");
  }

  const updated = result.phases.filter((p) => p.changed);
  if (updated.length === 0) {
    lines.push("All phase prompts match their skill snapshots.");
  } else {
    lines.push(`Updated ${updated.length} prompt(s).`);
  }

  return lines.join("\n").trimEnd() + "\n";
}

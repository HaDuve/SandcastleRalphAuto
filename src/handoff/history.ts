import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { HandoffSchema, type Handoff } from "./schema.js";
import { resolveHostHandoffHistoryDir } from "./hostStore.js";

export type HistoryEntry = {
  pr: number;
  issue: number;
  title?: string;
  branch: string;
  startedAt: string;
  endedAt: string;
  phases: Array<{ phase: Handoff["phase"]; startedAt: string; endedAt: string }>;
};

export async function listHandoffHistory(
  input: { stateRoot: string; projectId: string },
  limit = 20,
): Promise<HistoryEntry[]> {
  const historyDir = resolveHostHandoffHistoryDir(input.stateRoot, input.projectId);
  let filenames: string[];
  try {
    filenames = await readdir(historyDir);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }

  const jsonFiles = filenames.filter((name) => name.endsWith(".json")).sort().reverse();
  const entries: HistoryEntry[] = [];

  for (const filename of jsonFiles.slice(0, limit)) {
    const raw = await readFile(join(historyDir, filename), "utf8");
    const parsed = HandoffSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.pr === undefined) {
      continue;
    }
    const handoff = parsed.data;
    entries.push({
      pr: handoff.pr!,
      issue: handoff.issue,
      branch: handoff.branch,
      startedAt: handoff.startedAt,
      endedAt: handoff.endedAt,
      phases: [{ phase: handoff.phase, startedAt: handoff.startedAt, endedAt: handoff.endedAt }],
    });
  }

  return entries;
}

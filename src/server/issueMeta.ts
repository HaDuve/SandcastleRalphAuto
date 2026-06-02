import { type GhRunner } from "../merge/index.js";

export type GhIssueMeta = {
  title: string;
};

export async function fetchGhIssueMeta(
  gh: GhRunner,
  remote: string,
  issue: number,
): Promise<GhIssueMeta | null> {
  try {
    const raw = await gh([
      "issue",
      "view",
      String(issue),
      "--repo",
      remote,
      "--json",
      "title",
    ]);
    const parsed = JSON.parse(raw) as { title?: unknown };
    if (typeof parsed.title === "string" && parsed.title.length > 0) {
      return { title: parsed.title };
    }
  } catch {
    return null;
  }
  return null;
}

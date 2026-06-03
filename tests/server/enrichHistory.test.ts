import { describe, expect, it } from "vitest";
import { enrichHistoryEntries } from "../../src/server/projectSnapshot.js";
import type { HistoryEntry } from "../../src/handoff/history.js";

const baseEntry: HistoryEntry = {
  pr: 99,
  issue: 9,
  branch: "issue-9",
  startedAt: "2026-06-01T00:00:00.000Z",
  endedAt: "2026-06-01T01:00:00.000Z",
  phases: [
    {
      phase: "merge",
      startedAt: "2026-06-01T00:00:00.000Z",
      endedAt: "2026-06-01T01:00:00.000Z",
    },
  ],
};

describe("enrichHistoryEntries", () => {
  it("adds titles from gh for unique issues", async () => {
    const gh = async (args: string[]) => {
      const issue = Number(args[2]);
      if (issue === 9) {
        return JSON.stringify({ title: "Merged dashboard work" });
      }
      return JSON.stringify({ title: "Other" });
    };

    const enriched = await enrichHistoryEntries(
      [baseEntry, { ...baseEntry, pr: 100 }],
      "HaDuve/Portfolio",
      gh,
    );

    expect(enriched).toEqual([
      { ...baseEntry, title: "Merged dashboard work" },
      { ...baseEntry, pr: 100, title: "Merged dashboard work" },
    ]);
  });

  it("leaves entries unchanged when gh returns no title", async () => {
    const enriched = await enrichHistoryEntries(
      [baseEntry],
      "HaDuve/Portfolio",
      async () => "not json",
    );

    expect(enriched).toEqual([baseEntry]);
  });
});

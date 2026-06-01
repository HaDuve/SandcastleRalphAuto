import { describe, expect, it } from "vitest";
import { HandoffSchema } from "../src/handoff/index.js";

describe("project smoke", () => {
  it("parses a minimal valid handoff", () => {
    const result = HandoffSchema.safeParse({
      project: "HaDuve/SandcastleRalphAuto",
      issue: 1,
      branch: "issue-1-scaffold",
      phase: "tdd",
      acceptanceState: "in-progress",
      blockers: [],
      mergeReady: false,
      nextSkill: "/create-pr",
      startedAt: "2026-06-01T00:00:00.000Z",
      endedAt: "2026-06-01T00:00:00.000Z",
    });

    expect(result.success).toBe(true);
  });

  it("normalizes acceptanceState complete to done", () => {
    const result = HandoffSchema.safeParse({
      project: "HaDuve/SandcastleRalphAuto",
      issue: 1,
      branch: "issue-1-scaffold",
      phase: "tdd",
      acceptanceState: "complete",
      blockers: [],
      mergeReady: false,
      nextSkill: "/create-pr",
      startedAt: "2026-06-01T00:00:00.000Z",
      endedAt: "2026-06-01T00:00:00.000Z",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.acceptanceState).toBe("done");
    }
  });
});

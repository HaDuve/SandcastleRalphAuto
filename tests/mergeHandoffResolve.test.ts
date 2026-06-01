import { describe, expect, it } from "vitest";
import { type Handoff } from "../src/handoff/index.js";
import { resolveHandoffForMergeGate } from "../src/cli/runProject.js";
import { type Project } from "../src/registry/index.js";

const project: Project = {
  id: "p",
  path: "/tmp/p",
  remote: "HaDuve/Portfolio",
  defaultBase: "main",
  afkLabel: "ready-for-agent",
  blockedLabels: [],
  autoMerge: true,
  concurrency: "single",
  sandbox: "none",
};

function reviewPrHandoff(): Handoff {
  return {
    project: project.remote,
    issue: 32,
    branch: "issue-32",
    pr: 99,
    phase: "review-pr",
    acceptanceState: "done",
    verdict: "request-changes",
    blockers: ["CI red"],
    mergeReady: false,
    nextSkill: "/review-tdd",
    startedAt: "2026-06-01T00:00:00.000Z",
    endedAt: "2026-06-01T01:00:00.000Z",
  };
}

describe("resolveHandoffForMergeGate", () => {
  it("prefers host handoff after review-tdd over stale review-pr snapshot", async () => {
    const host: Handoff = {
      ...reviewPrHandoff(),
      phase: "review-tdd",
      verdict: "approve",
      blockers: [],
      nextSkill: "/merge",
    };

    const resolved = await resolveHandoffForMergeGate(
      project,
      "/state",
      reviewPrHandoff(),
      async () => host,
    );

    expect(resolved).toBe(host);
    expect(resolved?.phase).toBe("review-tdd");
    expect(resolved?.verdict).toBe("approve");
  });

  it("falls back to review-pr handoff when host is still on review-pr", async () => {
    const cached = reviewPrHandoff();
    const resolved = await resolveHandoffForMergeGate(
      project,
      "/state",
      cached,
      async () => cached,
    );

    expect(resolved).toBe(cached);
  });
});

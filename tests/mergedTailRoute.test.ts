import { describe, expect, it } from "vitest";
import {
  DEFAULT_MERGED_TAIL_MAX_ATTEMPTS,
  buildMergedTailExhaustionWarning,
  incrementMergedTailAttempt,
  isMergedTailEligiblePhase,
  isMergedTailExhausted,
  isPipelineCompleteForMergedPr,
  shouldEnterMergedTailRecovery,
} from "../src/handoff/mergedTailRoute.js";
import type { Handoff } from "../src/handoff/index.js";
import type { ActiveState } from "../src/state/index.js";

const active = (overrides: Partial<ActiveState> = {}): ActiveState => ({
  issue: 101,
  phase: "review-pr",
  branch: "issue-101",
  pr: 113,
  status: "blocked",
  reason: "Handoff acceptanceState is blocked, expected done",
  resumeSkill: "/review-pr",
  ...overrides,
});

const handoff = (overrides: Partial<Handoff> = {}): Handoff => ({
  project: "HaDuve/SandcastleRalphAuto",
  issue: 101,
  branch: "issue-101",
  pr: 113,
  phase: "review-pr",
  acceptanceState: "blocked",
  blockers: ["Different maintainer must approve PR #113"],
  mergeReady: false,
  nextSkill: "/review-tdd",
  startedAt: "2026-06-01T00:00:00.000Z",
  endedAt: "2026-06-01T01:00:00.000Z",
  ...overrides,
});

describe("mergedTailRoute", () => {
  it("detects eligible blocked phases", () => {
    expect(isMergedTailEligiblePhase("review-pr")).toBe(true);
    expect(isMergedTailEligiblePhase("review-tdd")).toBe(true);
    expect(isMergedTailEligiblePhase("merge")).toBe(true);
    expect(isMergedTailEligiblePhase("tdd")).toBe(false);
  });

  it("detects pipeline complete after review-tdd approve", () => {
    expect(
      isPipelineCompleteForMergedPr({
        ...handoff(),
        phase: "review-tdd",
        acceptanceState: "done",
        verdict: "approve",
        blockers: [],
        nextSkill: "/merge",
      }),
    ).toBe(true);
  });

  it("enters recovery when PR is merged and review-tdd approve missing", () => {
    expect(
      shouldEnterMergedTailRecovery({
        active: active(),
        prState: "MERGED",
        handoff: handoff(),
      }),
    ).toBe(true);
  });

  it("skips recovery when pipeline already has review-tdd approve", () => {
    expect(
      shouldEnterMergedTailRecovery({
        active: active({ phase: "merge" }),
        prState: "MERGED",
        handoff: {
          ...handoff(),
          phase: "review-tdd",
          acceptanceState: "done",
          verdict: "approve",
          blockers: [],
          nextSkill: "/merge",
        },
      }),
    ).toBe(false);
  });

  it("tracks merged-tail attempts and exhaustion", () => {
    const first = incrementMergedTailAttempt(handoff());
    expect(first.mergedTailAttempts).toBe(1);
    const second = incrementMergedTailAttempt(first);
    expect(second.mergedTailAttempts).toBe(2);
    expect(isMergedTailExhausted(second)).toBe(true);
    expect(DEFAULT_MERGED_TAIL_MAX_ATTEMPTS).toBe(2);
  });

  it("builds exhaustion warning text", () => {
    expect(buildMergedTailExhaustionWarning(101, 113)).toMatch(/101/);
    expect(buildMergedTailExhaustionWarning(101, 113)).toMatch(/113/);
  });
});

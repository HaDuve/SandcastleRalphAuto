import { type Handoff } from "../handoff/index.js";
import { type CanonicalPhase } from "../prompts/phases.js";
import {
  PHASE_COMPLETE_SIGNAL,
  type RunPhaseResult,
} from "../runner/index.js";
import { type ActiveState } from "../state/index.js";
import { getNextOrchestratorPhase, isCanonicalPhase } from "./sequence.js";

export type AdvanceSliceInput = {
  issue: number;
  branch: string;
  pr?: number;
  phase: CanonicalPhase;
  result: RunPhaseResult;
};

export type AdvanceSliceSuccess = {
  ok: true;
  active: ActiveState;
  handoffToNext: boolean;
};

export type AdvanceSliceBlocked = {
  ok: false;
  active: ActiveState;
  reason: string;
};

export type AdvanceSliceOutcome = AdvanceSliceSuccess | AdvanceSliceBlocked;

export function skillForPhase(phase: CanonicalPhase): string {
  return `/${phase}`;
}

export function expectedNextSkill(phase: CanonicalPhase): string {
  const next = getNextOrchestratorPhase(phase);
  if (next === "next") {
    return "/next";
  }
  if (next && isCanonicalPhase(next)) {
    return skillForPhase(next);
  }
  throw new Error(`No successor skill for phase: ${phase}`);
}

function blockedActive(
  input: AdvanceSliceInput,
  reason: string,
  resumeSkill: string,
): ActiveState {
  return {
    issue: input.issue,
    phase: input.phase,
    branch: input.branch,
    pr: input.pr ?? input.result.handoff.pr,
    status: "blocked",
    reason,
    resumeSkill,
  };
}

function advanceFailureReason(
  phase: CanonicalPhase,
  handoff: Handoff,
  completionSignal: string | undefined,
): string | null {
  if (completionSignal !== PHASE_COMPLETE_SIGNAL) {
    return "Phase did not emit PHASE_COMPLETE completion signal";
  }
  if (handoff.phase !== phase) {
    return `Handoff phase ${handoff.phase} does not match completed phase ${phase}`;
  }
  if (handoff.acceptanceState !== "done") {
    return `Handoff acceptanceState is ${handoff.acceptanceState}, expected done`;
  }
  if (handoff.blockers.length > 0) {
    return `Handoff has blockers: ${handoff.blockers.join("; ")}`;
  }
  const expected = expectedNextSkill(phase);
  if (handoff.nextSkill !== expected) {
    return `Handoff nextSkill ${handoff.nextSkill} does not match linear pipeline (expected ${expected})`;
  }
  return null;
}

export function advanceSlice(input: AdvanceSliceInput): AdvanceSliceOutcome {
  const { handoff, completionSignal } = input.result;
  const failure = advanceFailureReason(
    input.phase,
    handoff,
    completionSignal,
  );

  if (failure) {
    return {
      ok: false,
      active: blockedActive(
        input,
        failure,
        handoff.nextSkill || skillForPhase(input.phase),
      ),
      reason: failure,
    };
  }

  const next = getNextOrchestratorPhase(input.phase);
  if (next === "next") {
    return {
      ok: true,
      handoffToNext: true,
      active: {
        issue: input.issue,
        phase: "merge",
        branch: input.branch,
        pr: handoff.pr ?? input.pr,
        status: "active",
      },
    };
  }

  if (!next || !isCanonicalPhase(next)) {
    const reason = `No successor phase after ${input.phase}`;
    return {
      ok: false,
      active: blockedActive(input, reason, skillForPhase(input.phase)),
      reason,
    };
  }

  return {
    ok: true,
    handoffToNext: false,
    active: {
      issue: input.issue,
      phase: next,
      branch: input.branch,
      pr: handoff.pr ?? input.pr,
      status: "active",
    },
  };
}

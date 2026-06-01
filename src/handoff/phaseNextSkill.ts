import {
  getNextOrchestratorPhase,
  isCanonicalPhase,
} from "../pipeline/sequence.js";
import type { RunnablePhase } from "../prompts/phases.js";

/** Next skill string for a completed phase (matches `advanceSlice` / harness contract). */
export function nextSkillAfterPhase(phase: RunnablePhase): string {
  if (phase === "babysit") {
    return "/merge";
  }
  const next = getNextOrchestratorPhase(phase);
  if (next === "next") {
    return "/next";
  }
  if (next && isCanonicalPhase(next)) {
    return `/${next}`;
  }
  throw new Error(`No successor skill for phase: ${phase}`);
}

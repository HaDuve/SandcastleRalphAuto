import type { CanonicalPhase } from "./phases.js";

export function renderHarness(phase: CanonicalPhase): string {
  return [
    "# Headless harness (SandcastleRalphAuto)",
    "",
    "You are running phase `" + phase + "` AFK. Do not ask questions; use only the handoff and GitHub.",
    "",
    "## Inputs",
    "",
    "1. Read `.sandcastle-ralph/handoff/current.json` (JSON handoff from the prior phase).",
    "2. Load the linked GitHub issue (`project` + `issue` from the handoff).",
    "",
    "## Outputs",
    "",
    "1. When the phase work is complete, write an updated handoff to `.sandcastle-ralph/handoff/current.json` (valid per host schema: phase, acceptanceState, blockers, mergeReady, nextSkill, timestamps).",
    "2. Emit `<promise>PHASE_COMPLETE</promise>` as the final line of your response when done.",
    "",
  ].join("\n");
}

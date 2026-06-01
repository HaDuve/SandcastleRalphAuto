import type { CanonicalPhase } from "./phases.js";

function renderBranchPin(phase: CanonicalPhase): string {
  const lines = [
    "## Git branch",
    "",
    "The host checked out `handoff.branch` before this run. It is always `issue-<handoff.issue>` — stay on that branch for all git work in this phase.",
    "Do not create or switch to `feat/<slug>-<n>` or other branch names.",
  ];

  if (phase === "create-pr") {
    lines.push(
      "",
      "For this AFK run, **ignore** the create-pr skill's branch-resolution table in the skill snapshot. Use only `handoff.branch`.",
    );
  }

  return lines.join("\n");
}

function renderCommitStep(): string {
  return [
    "## Git commit (required)",
    "",
    "Before updating the handoff or emitting the completion signal:",
    "",
    "1. Stage only the paths you changed in this phase (not blind `git add -A` unless the skill explicitly requires it).",
    "2. Commit with a message matching repo style (1–2 sentences, focus on **why**). **Do not create an empty commit** — if there are no file changes from this phase, skip the commit step.",
  ].join("\n");
}

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
    renderBranchPin(phase),
    "",
    renderCommitStep(),
    "",
    "## Outputs (in order)",
    "",
    "1. When the phase work is complete, write an updated handoff to `.sandcastle-ralph/handoff/current.json` (valid per host schema: phase, acceptanceState, blockers, mergeReady, nextSkill, timestamps).",
    "2. Emit `<promise>PHASE_COMPLETE</promise>` as the final line of your response when done.",
    "",
  ].join("\n");
}

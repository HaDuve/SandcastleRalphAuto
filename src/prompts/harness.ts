import { renderHandoffContract } from "../handoff/contract.js";
import type { RunnablePhase } from "./phases.js";

function renderBranchPin(phase: RunnablePhase): string {
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

function renderOutputs(): string {
  return [
    "## Outputs (in order)",
    "",
    "1. **Commit** — stage only the paths you changed in this phase (not blind `git add -A` unless the skill explicitly requires it). Commit with a message matching repo style (1–2 sentences, focus on **why**). **Do not create an empty commit**; if there are no file changes from this phase, skip this step.",
    "2. **Handoff** — write `.sandcastle-ralph/handoff/current.json` per the **Handoff contract** above.",
    "3. **Signal** — emit `<promise>PHASE_COMPLETE</promise>` as the final line of your response.",
  ].join("\n");
}

export function renderHarness(phase: RunnablePhase): string {
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
    renderHandoffContract(),
    "",
    renderOutputs(),
    "",
  ].join("\n");
}

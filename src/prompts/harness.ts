import { renderHandoffContract } from "../handoff/contract.js";
import type { RunnablePhase } from "./phases.js";

export const INLINE_HANDOFF_JSON_PLACEHOLDER =
  "__SANDCASTLE_RALPH_INLINE_HANDOFF_JSON__";

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
      "",
      "## No-diff shortcut (unblock automation)",
      "",
      "If `git log origin/main..HEAD --oneline` is empty **and** `git diff origin/main...HEAD` is empty, there is no diff to open a PR for. In that case:",
      "",
      "- Do **not** mark the handoff `blocked`.",
      "- Write the handoff as `acceptanceState: \"done\"`, `blockers: []`, `pr` omitted, and set `nextSkill: \"/next\"` so the host advances the queue.",
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

function renderInlineHandoff(): string {
  return [
    "## Inline handoff (JSON)",
    "",
    "The current handoff is included inline below. Do **not** attempt to read `.sandcastle-ralph/handoff/current.json` to start this phase.",
    "",
    "```json",
    INLINE_HANDOFF_JSON_PLACEHOLDER,
    "```",
  ].join("\n");
}

function renderReviewTddAfKGuidance(phase: RunnablePhase): string {
  if (phase !== "review-tdd") {
    return "";
  }
  return [
    "## Review-tdd AFK rules",
    "",
    "- Land fixes on `handoff.branch` with commit + push. If the slice PR is already **MERGED** (merged-tail recovery), push to `main` when allowed; if `main` is protected, open a **follow-up PR** via normal commits on the issue branch — do not leave fixes only in a local worktree.",
    "- Finish with `acceptanceState: \"done\"`, `verdict: \"approve\"`, cleared `blockers`, and `nextSkill: \"/merge\"` when in-scope review work is complete.",
    "",
  ].join("\n");
}

function renderReviewPrAfKGuidance(phase: RunnablePhase): string {
  if (phase !== "review-pr") {
    return "";
  }
  return [
    "## Review-pr AFK rules",
    "",
    "- **PR approved** for this pipeline means handoff `verdict: \"approve\"` only — not a GitHub `APPROVE` review.",
    "- If `gh pr review --approve` is disallowed (self-approval), post a **comment** review and set handoff `verdict` from the code bar.",
    "- **Do not** use `acceptanceState: \"blocked\"` for procedural constraints (self-approval, maintainer must approve, branch protection). Use `\"done\"` and route to `/review-tdd`.",
    "- You may put suggestions and nits in `blockers[]` while `verdict: \"approve\"`; the host advances to `/review-tdd`.",
    "",
  ].join("\n");
}

export function renderMergedTailReviewSection(): string {
  return [
    "## Merged-tail recovery",
    "",
    "The slice PR is already **MERGED** on `main`. Review the **landed commit on `main`** (use `git log` / `git show` on `main`, and the linked issue acceptance criteria), not an open PR diff.",
    "Post findings as a GitHub **comment** review when approve is disallowed. Then write handoff for `/review-tdd` to implement in-scope blockers, suggestions, and nits.",
    "",
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
    "1. Use the inline handoff JSON below.",
    "2. Load the linked GitHub issue (`project` + `issue` from the handoff).",
    "",
    renderInlineHandoff(),
    "",
    renderBranchPin(phase),
    "",
    renderReviewPrAfKGuidance(phase),
    renderReviewTddAfKGuidance(phase),
    renderHandoffContract(phase),
    "",
    renderOutputs(),
    "",
  ].join("\n");
}

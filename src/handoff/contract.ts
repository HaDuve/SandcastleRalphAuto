import type { RunnablePhase } from "../prompts/phases.js";
import { nextSkillAfterPhase } from "./phaseNextSkill.js";
import {
  HANDOFF_ACCEPTANCE_STATE_VALUES,
  HANDOFF_PHASE_VALUES,
} from "./schema.js";

function exampleHandoffForPhase(phase: RunnablePhase) {
  return {
    project: "owner/repo",
    issue: 29,
    branch: "issue-29",
    phase,
    acceptanceState: "done" as const,
    blockers: [] as string[],
    mergeReady: phase === "merge",
    nextSkill: nextSkillAfterPhase(phase),
    startedAt: "2026-06-01T00:00:00.000Z",
    endedAt: "2026-06-01T01:00:00.000Z",
  };
}

function renderCreatePrNoDiffExample(): string {
  return JSON.stringify(
    {
      project: "owner/repo",
      issue: 95,
      branch: "issue-95",
      phase: "create-pr",
      acceptanceState: "done",
      blockers: [],
      mergeReady: false,
      nextSkill: "/next",
      startedAt: "2026-06-01T00:00:00.000Z",
      endedAt: "2026-06-01T01:00:00.000Z",
    },
    null,
    2,
  );
}

export function renderHandoffContract(phase: RunnablePhase): string {
  const acceptanceStates = HANDOFF_ACCEPTANCE_STATE_VALUES.map((v) => `"${v}"`).join(
    " | ",
  );
  const phases = HANDOFF_PHASE_VALUES.map((v) => `"${v}"`).join(", ");
  const example = exampleHandoffForPhase(phase);
  const nextSkillLine =
    phase === "create-pr"
      ? '- `nextSkill` — when done with a PR: `"/review-pr"`; when **no diff vs main** (no PR): `"/next"`'
      : `- \`nextSkill\` — for this phase when done: \`"${example.nextSkill}"\``;

  return [
    "## Handoff contract (`current.json`)",
    "",
    "Required JSON (host validates with Zod after this phase):",
    "",
    "- `project` — `owner/repo`",
    "- `issue` — number",
    "- `branch` — `issue-<issue>` for this pipeline",
    "- `pr` — optional PR number (set once a PR exists)",
    `- \`phase\` — must be \`"${phase}"\` for this run (allowed values: ${phases})`,
    `- \`acceptanceState\` — one of: ${acceptanceStates}. When this phase **finishes successfully**, use \`"done"\` — **not** \`"complete"\`, \`"finished"\`, or other words.`,
    "- `verdict` — optional: `\"approve\"` | `\"request-changes\"` | `\"n/a\"`",
    "- `blockers` — string array (empty when unblocked)",
    "- `mergeReady` — boolean",
    nextSkillLine,
    "- `startedAt` / `endedAt` — ISO-8601 timestamps",
    "",
    "Example when this phase is complete:",
    "",
    "```json",
    JSON.stringify(example, null, 2),
    "```",
    ...(phase === "create-pr"
      ? [
          "",
          "Example when there is **no diff** (no PR; host advances queue):",
          "",
          "```json",
          renderCreatePrNoDiffExample(),
          "```",
        ]
      : []),
  ].join("\n");
}

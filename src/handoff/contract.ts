import {
  HANDOFF_ACCEPTANCE_STATE_VALUES,
  HANDOFF_PHASE_VALUES,
} from "./schema.js";

const EXAMPLE_HANDOFF = {
  project: "owner/repo",
  issue: 29,
  branch: "issue-29",
  phase: "tdd",
  acceptanceState: "done",
  blockers: [] as string[],
  mergeReady: false,
  nextSkill: "/create-pr",
  startedAt: "2026-06-01T00:00:00.000Z",
  endedAt: "2026-06-01T01:00:00.000Z",
};

export function renderHandoffContract(): string {
  const acceptanceStates = HANDOFF_ACCEPTANCE_STATE_VALUES.map((v) => `"${v}"`).join(
    " | ",
  );
  const phases = HANDOFF_PHASE_VALUES.map((v) => `"${v}"`).join(", ");

  return [
    "## Handoff contract (`current.json`)",
    "",
    "Required JSON (host validates with Zod after this phase):",
    "",
    "- `project` — `owner/repo`",
    "- `issue` — number",
    "- `branch` — `issue-<issue>` for this pipeline",
    "- `pr` — optional PR number (set once a PR exists)",
    `- \`phase\` — one of: ${phases}`,
    `- \`acceptanceState\` — one of: ${acceptanceStates}. When this phase **finishes successfully**, use \`"done"\` — **not** \`"complete"\`, \`"finished"\`, or other words.`,
    "- `verdict` — optional: `\"approve\"` | `\"request-changes\"` | `\"n/a\"`",
    "- `blockers` — string array (empty when unblocked)",
    "- `mergeReady` — boolean",
    "- `nextSkill` — next phase skill, e.g. `\"/create-pr\"`",
    "- `startedAt` / `endedAt` — ISO-8601 timestamps",
    "",
    "Example when the phase is complete:",
    "",
    "```json",
    JSON.stringify(EXAMPLE_HANDOFF, null, 2),
    "```",
  ].join("\n");
}

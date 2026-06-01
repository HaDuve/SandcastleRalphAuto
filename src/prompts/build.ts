import { renderHarness } from "./harness.js";
import { RUNNABLE_PHASES, type RunnablePhase } from "./phases.js";

const RUNNABLE_PHASE_SET = new Set<string>(RUNNABLE_PHASES);

const HARNESS_START = "<!-- sandcastle-ralph:harness -->";
const HARNESS_END = "<!-- /sandcastle-ralph:harness -->";

export function skillSnapshotStart(phase: RunnablePhase): string {
  return `<!-- sandcastle-ralph:skill-snapshot source=~/.cursor/skills/${phase}/SKILL.md -->`;
}

const SKILL_SNAPSHOT_END = "<!-- /sandcastle-ralph:skill-snapshot -->";

export function buildPrompt(phase: RunnablePhase, skillMarkdown: string): string {
  const harness = renderHarness(phase);
  const skill = skillMarkdown.trimEnd();

  return [
    HARNESS_START,
    harness,
    HARNESS_END,
    "",
    skillSnapshotStart(phase),
    skill,
    SKILL_SNAPSHOT_END,
    "",
  ].join("\n");
}

export type ParsedPrompt = {
  phase: RunnablePhase;
  harness: string;
  skillSnapshot: string;
};

export function parsePrompt(content: string): ParsedPrompt {
  const phaseMatch = content.match(
    /<!-- sandcastle-ralph:skill-snapshot source=~\/\.cursor\/skills\/([^/]+)\/SKILL\.md -->/,
  );
  if (!phaseMatch) {
    throw new Error("missing skill-snapshot marker");
  }
  const phase = phaseMatch[1];
  if (!RUNNABLE_PHASE_SET.has(phase)) {
    throw new Error(`unknown phase: ${phase}`);
  }

  const harnessMatch = content.match(
    /<!-- sandcastle-ralph:harness -->\n([\s\S]*?)<!-- \/sandcastle-ralph:harness -->/,
  );
  if (!harnessMatch) {
    throw new Error("missing harness section");
  }

  const skillMatch = content.match(
    /<!-- sandcastle-ralph:skill-snapshot source=~\/\.cursor\/skills\/[^/]+\/SKILL\.md -->\n([\s\S]*?)<!-- \/sandcastle-ralph:skill-snapshot -->/,
  );
  if (!skillMatch) {
    throw new Error("missing skill body");
  }

  return {
    phase: phase as RunnablePhase,
    harness: harnessMatch[1].trimEnd(),
    skillSnapshot: skillMatch[1].trimEnd(),
  };
}

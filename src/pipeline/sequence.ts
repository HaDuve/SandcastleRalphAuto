import { CANONICAL_PHASES, type CanonicalPhase } from "../prompts/phases.js";

/** Full orchestrator path including idle and host `/next` handoff. */
export const ORCHESTRATOR_PHASES = [
  "idle",
  ...CANONICAL_PHASES,
  "next",
] as const;

export type OrchestratorPhase = (typeof ORCHESTRATOR_PHASES)[number];

export function getNextOrchestratorPhase(
  phase: OrchestratorPhase,
): OrchestratorPhase | null {
  const index = ORCHESTRATOR_PHASES.indexOf(phase);
  if (index === -1 || index === ORCHESTRATOR_PHASES.length - 1) {
    return null;
  }
  return ORCHESTRATOR_PHASES[index + 1] ?? null;
}

export function isCanonicalPhase(
  phase: OrchestratorPhase,
): phase is CanonicalPhase {
  return (CANONICAL_PHASES as readonly string[]).includes(phase);
}

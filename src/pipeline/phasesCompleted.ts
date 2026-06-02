import {
  CANONICAL_PHASES,
  type CanonicalPhase,
} from "../prompts/phases.js";

/** Phases finished when create-pr ends with no diff (respects `fromPhase` resume). */
export function phasesCompletedThroughCreatePr(
  fromPhase?: CanonicalPhase,
): CanonicalPhase[] {
  const end = CANONICAL_PHASES.indexOf("create-pr");
  if (fromPhase === undefined) {
    return CANONICAL_PHASES.slice(0, end + 1);
  }
  const start = CANONICAL_PHASES.indexOf(fromPhase);
  if (start === -1 || start > end) {
    return CANONICAL_PHASES.slice(0, end + 1);
  }
  return CANONICAL_PHASES.slice(start, end + 1);
}

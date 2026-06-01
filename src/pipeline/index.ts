/** Phase sequence: tdd → create-pr → review-pr → … → merge. */
export { CANONICAL_PHASES, type CanonicalPhase } from "../prompts/phases.js";
export {
  getNextOrchestratorPhase,
  isCanonicalPhase,
  ORCHESTRATOR_PHASES,
  type OrchestratorPhase,
} from "./sequence.js";
export {
  advanceSlice,
  expectedNextSkill,
  skillForPhase,
  type AdvanceSliceInput,
  type AdvanceSliceOutcome,
} from "./advance.js";
export {
  runLinearSlice,
  type RunLinearSliceBlocked,
  type RunLinearSliceDeps,
  type RunLinearSliceOptions,
  type RunLinearSliceResult,
  type RunLinearSliceSuccess,
} from "./runSlice.js";

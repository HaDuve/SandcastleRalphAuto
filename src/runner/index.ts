/** Sandcastle run invoker — one cold agent per phase. */
export {
  DEFAULT_CURSOR_TRANSIENT_BASE_DELAY_MS,
  DEFAULT_CURSOR_TRANSIENT_MAX_ATTEMPTS,
  DEFAULT_CURSOR_TRANSIENT_MAX_DELAY_MS,
  isTransientCursorError,
  isTransientCursorErrorMessage,
} from "./transientCursorError.js";
export {
  CURSOR_TRUST_SETUP,
  DEFAULT_BABYSIT_MAX_ITERATIONS,
  DEFAULT_TDD_MAX_ITERATIONS,
  PHASE_COMPLETE_SIGNAL,
  resolveOrchestratorRoot,
  runPhase,
  type RunPhaseDeps,
  type RunPhaseOptions,
  type RunPhaseResult,
  type SandcastleCreateSandboxOptions,
  type SandcastleSandboxHandle,
  type SandcastleSandboxRunOptions,
  type SandcastleSandboxRunResult,
} from "./runPhase.js";

export type { AgentStreamEvent } from "@ai-hero/sandcastle";

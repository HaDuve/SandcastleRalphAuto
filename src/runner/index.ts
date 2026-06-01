/** Sandcastle run invoker — one cold agent per phase. */
export {
  CURSOR_TRUST_SETUP,
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

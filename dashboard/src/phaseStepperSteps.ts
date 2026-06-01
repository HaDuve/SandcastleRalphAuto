export const STEPPER_LINEAR_PHASES = [
  "tdd",
  "create-pr",
  "review-pr",
  "review-tdd",
  "merge",
  "next",
] as const;

export type PhaseStepperStepState = "done" | "current" | "pending";

export type PhaseStepperStep = {
  phase: string;
  state: PhaseStepperStepState;
};

export function buildPhaseStepperSteps(currentPhase: string | null): PhaseStepperStep[] {
  const phases =
    currentPhase === "babysit"
      ? [...STEPPER_LINEAR_PHASES.slice(0, 5), "babysit", "next"]
      : [...STEPPER_LINEAR_PHASES];

  if (!currentPhase) {
    return phases.map((phase) => ({ phase, state: "pending" }));
  }

  const currentIndex = phases.indexOf(currentPhase);
  if (currentIndex === -1) {
    return phases.map((phase) => ({ phase, state: "pending" }));
  }

  return phases.map((phase, index) => ({
    phase,
    state:
      index < currentIndex ? "done" : index === currentIndex ? "current" : "pending",
  }));
}

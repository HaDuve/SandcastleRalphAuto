import { PanelHeader } from "./PanelHeader.js";
import { buildPhaseStepperSteps } from "./phaseStepperSteps.js";
import type { Project } from "./types.js";

export type PhaseStepperProps = {
  project: Project | null;
  currentPhase: string | null;
  onRefresh?: () => void;
  refreshError?: string | null;
};

export function PhaseStepper({
  project,
  currentPhase,
  onRefresh,
  refreshError = null,
}: PhaseStepperProps) {
  if (!project) {
    return (
      <div className="panel-placeholder">
        <PanelHeader title="Phase stepper" onRefresh={onRefresh} refreshDisabled />
        <p>Select a project to view the phase stepper.</p>
      </div>
    );
  }

  const steps = buildPhaseStepperSteps(currentPhase);

  return (
    <div className="phase-stepper">
      <PanelHeader
        title="Phase stepper"
        onRefresh={onRefresh}
        error={refreshError}
      />
      <ol className="phase-stepper-track">
        {steps.map((step) => (
          <li
            key={step.phase}
            className="phase-stepper-step"
            data-state={step.state}
            aria-current={step.state === "current" ? "step" : undefined}
            aria-label={step.phase}
          >
            {step.phase}
          </li>
        ))}
      </ol>
    </div>
  );
}

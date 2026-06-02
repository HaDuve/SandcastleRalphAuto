import { PanelHeader } from "./PanelHeader.js";
import { githubIssueUrl, githubPrUrl } from "./linkTargets.js";
import { buildPhaseStepperSteps } from "./phaseStepperSteps.js";
import type { Project, ProjectActiveSummary } from "./types.js";

export type PhaseStepperProps = {
  project: Project | null;
  summary: ProjectActiveSummary | null;
  currentPhase: string | null;
  active?: { debug?: { activeMtimeMs: number | null; workerLockPid: number | null } } | null;
  onRefresh?: () => void;
  refreshError?: string | null;
};

function formatStartedAt(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function formatStateMtime(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined) {
    return null;
  }
  try {
    return new Date(ms).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  } catch {
    return null;
  }
}

export function PhaseStepper({
  project,
  summary,
  currentPhase,
  active = null,
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

  const issueLabel =
    summary && summary.issue > 0
      ? `#${summary.issue} — ${summary.title ?? "(loading title…)"}`
      : null;
  const issueUrl =
    summary && summary.issue > 0 ? githubIssueUrl(project.remote, summary.issue) : null;
  const prUrl = summary?.pr !== undefined ? githubPrUrl(project.remote, summary.pr) : null;

  const actions =
    issueLabel || prUrl || summary?.branch || summary?.startedAt ? (
      <div className="phase-stepper-identity">
        {issueLabel && issueUrl ? (
          <a href={issueUrl} target="_blank" rel="noreferrer">
            {issueLabel}
          </a>
        ) : null}
        {prUrl ? (
          <a href={prUrl} target="_blank" rel="noreferrer">
            PR #{summary!.pr}
          </a>
        ) : null}
        {summary?.branch ? <span>{summary.branch}</span> : null}
        {summary?.startedAt ? <span>{formatStartedAt(summary.startedAt)}</span> : null}
        {active?.debug ? (
          <>
            {formatStateMtime(active.debug.activeMtimeMs) ? (
              <span>state updated {formatStateMtime(active.debug.activeMtimeMs)}</span>
            ) : (
              <span>state updated (missing)</span>
            )}
            <span>
              lock {active.debug.workerLockPid !== null ? `pid ${active.debug.workerLockPid}` : "(none)"}
            </span>
          </>
        ) : null}
      </div>
    ) : null;

  return (
    <div className="phase-stepper">
      <PanelHeader
        title="Phase stepper"
        onRefresh={onRefresh}
        error={refreshError}
        actions={actions}
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

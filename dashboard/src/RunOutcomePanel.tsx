import type { Project, RunOutcome } from "./types.js";

export type RunOutcomePanelProps = {
  project: Project | null;
  lastOutcome: RunOutcome | null;
};

function formatStoppedAt(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function formatOutcomeLabel(outcome: RunOutcome["outcome"]): string {
  switch (outcome) {
    case "queue-empty":
      return "Queue empty";
    case "blocked":
      return "Blocked";
    case "awaiting-human":
      return "Awaiting human";
    case "killed":
      return "Killed";
    case "error":
      return "Error";
  }
}

export function RunOutcomePanel({ project, lastOutcome }: RunOutcomePanelProps) {
  if (!project) {
    return (
      <div className="panel-placeholder">
        <h2>Run outcome</h2>
        <p>Select a project to view the last run outcome.</p>
      </div>
    );
  }

  if (!lastOutcome) {
    return (
      <div className="run-outcome-panel">
        <h2>Run outcome</h2>
        <p className="run-outcome-idle">No run outcome recorded for this project.</p>
      </div>
    );
  }

  return (
    <div className="run-outcome-panel">
      <h2>Run outcome</h2>
      <dl className="run-outcome-details">
        <div>
          <dt>Outcome</dt>
          <dd>{formatOutcomeLabel(lastOutcome.outcome)}</dd>
        </div>
        {lastOutcome.reason ? (
          <div>
            <dt>Reason</dt>
            <dd>{lastOutcome.reason}</dd>
          </div>
        ) : null}
        {lastOutcome.phase ? (
          <div>
            <dt>Phase</dt>
            <dd>{lastOutcome.phase}</dd>
          </div>
        ) : null}
        <div>
          <dt>Stopped</dt>
          <dd>{formatStoppedAt(lastOutcome.stoppedAt)}</dd>
        </div>
      </dl>
    </div>
  );
}

import { PanelHeader } from "./PanelHeader.js";
import { STARTING_PLACEHOLDER_PHASE } from "./optimisticStart.js";
import type { ActiveSlice, Project } from "./types.js";

export type ActivePanelProps = {
  project: Project | null;
  active: ActiveSlice | null;
  onRefresh?: () => void;
  refreshError?: string | null;
};

function formatStartedAt(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

export function ActivePanel({
  project,
  active,
  onRefresh,
  refreshError = null,
}: ActivePanelProps) {
  if (!project) {
    return (
      <div className="panel-placeholder">
        <PanelHeader title="Active slice" onRefresh={onRefresh} refreshDisabled />
        <p>Select a project to view the active slice.</p>
      </div>
    );
  }

  if (!active) {
    return (
      <div className="active-panel">
        <PanelHeader title="Active slice" onRefresh={onRefresh} error={refreshError} />
        <p className="active-idle">No active slice for this project.</p>
      </div>
    );
  }

  if (active.phase === STARTING_PLACEHOLDER_PHASE) {
    return (
      <div className="active-panel">
        <PanelHeader title="Active slice" onRefresh={onRefresh} error={refreshError} />
        <p className="active-starting">Starting worker…</p>
      </div>
    );
  }

  const prUrl =
    active.pr !== undefined
      ? `https://github.com/${project.remote}/pull/${active.pr}`
      : null;

  return (
    <div className="active-panel">
      <PanelHeader title="Active slice" onRefresh={onRefresh} error={refreshError} />
      <dl className="active-details">
        <div>
          <dt>Issue</dt>
          <dd>#{active.issue}</dd>
        </div>
        <div>
          <dt>Phase</dt>
          <dd>{active.phase}</dd>
        </div>
        <div>
          <dt>Branch</dt>
          <dd>{active.branch}</dd>
        </div>
        {prUrl ? (
          <div>
            <dt>PR</dt>
            <dd>
              <a href={prUrl} target="_blank" rel="noreferrer">
                #{active.pr}
              </a>
            </dd>
          </div>
        ) : null}
        {active.startedAt ? (
          <div>
            <dt>Started</dt>
            <dd>{formatStartedAt(active.startedAt)}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

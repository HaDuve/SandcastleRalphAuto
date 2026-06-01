import type { ActiveSlice, Project } from "./types.js";

export type ActivePanelProps = {
  project: Project | null;
  active: ActiveSlice | null;
};

function formatStartedAt(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

export function ActivePanel({ project, active }: ActivePanelProps) {
  if (!project) {
    return (
      <div className="panel-placeholder">
        <h2>Active slice</h2>
        <p>Select a project to view the active slice.</p>
      </div>
    );
  }

  if (!active) {
    return (
      <div className="active-panel">
        <h2>Active slice</h2>
        <p className="active-idle">No active slice for this project.</p>
      </div>
    );
  }

  const prUrl =
    active.pr !== undefined
      ? `https://github.com/${project.remote}/pull/${active.pr}`
      : null;

  return (
    <div className="active-panel">
      <h2>Active slice</h2>
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

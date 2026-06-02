import { PanelHeader } from "./PanelHeader.js";
import { formatPhaseDuration } from "./phaseDuration.js";
import type { HistoryEntry, Project } from "./types.js";

export type HistoryPanelProps = {
  project: Project | null;
  history: HistoryEntry[];
  onRefresh?: () => void;
  refreshError?: string | null;
};

export function HistoryPanel({
  project,
  history,
  onRefresh,
  refreshError = null,
}: HistoryPanelProps) {
  if (!project) {
    return (
      <div className="panel-placeholder">
        <PanelHeader title="History" onRefresh={onRefresh} refreshDisabled />
        <p>Select a project to view merged PR history.</p>
      </div>
    );
  }

  return (
    <div className="history-panel">
      <PanelHeader title="History" onRefresh={onRefresh} error={refreshError} />
      {history.length === 0 ? (
        <p className="history-empty">No merged history for this project yet.</p>
      ) : (
        <ul className="history-list">
          {history.map((entry) => {
            const prUrl = `https://github.com/${project.remote}/pull/${entry.pr}`;
            return (
              <li key={`${entry.pr}-${entry.endedAt}`} className="history-item">
                <div className="history-item-header">
                  <a href={prUrl} target="_blank" rel="noreferrer">
                    #{entry.pr}
                  </a>
                  <span className="history-item-issue">issue #{entry.issue}</span>
                </div>
                <ul className="history-phases">
                  {entry.phases.map((phase) => (
                    <li key={`${entry.pr}-${phase.phase}-${phase.startedAt}`}>
                      <span className="history-phase-name">{phase.phase}</span>
                      <span className="history-phase-duration">
                        {formatPhaseDuration(phase.startedAt, phase.endedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

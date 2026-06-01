import { exclusionReason } from "./queueReason.js";
import type { Project, QueueIssue } from "./types.js";

export type QueuePanelProps = {
  project: Project | null;
  queue: QueueIssue[];
  onSkipToggle: (issue: number, skipped: boolean) => void;
};

export function QueuePanel({ project, queue, onSkipToggle }: QueuePanelProps) {
  if (!project) {
    return (
      <div className="panel-placeholder">
        <h2>Queue</h2>
        <p>Select a project to view the issue queue.</p>
      </div>
    );
  }

  return (
    <div className="queue-panel">
      <h2>Queue</h2>
      {queue.length === 0 ? (
        <p className="queue-empty">No open issues with the AFK label.</p>
      ) : (
        <ul className="queue-list">
          {queue.map((issue) => {
            const reason = exclusionReason(issue, project);
            return (
              <li
                key={issue.number}
                className={issue.eligible ? "queue-item queue-item--eligible" : "queue-item"}
              >
                <label className="queue-item-label">
                  <input
                    type="checkbox"
                    checked={issue.skipped}
                    aria-label={`Skip issue ${issue.number}`}
                    onChange={(event) =>
                      onSkipToggle(issue.number, event.target.checked)
                    }
                  />
                  <span>#{issue.number}</span>
                </label>
                {reason ? <span className="queue-item-reason">{reason}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

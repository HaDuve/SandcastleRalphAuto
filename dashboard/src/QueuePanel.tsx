import { PanelHeader } from "./PanelHeader.js";
import { githubIssueUrl, githubIssuesUrl } from "./linkTargets.js";
import { exclusionReason } from "./queueReason.js";
import { queueIssueNeedsStatusMarker } from "./queueStatusMarker.js";
import type { Project, QueueIssue } from "./types.js";

export type QueuePanelProps = {
  project: Project | null;
  queue: QueueIssue[];
  onSkipToggle: (issue: number, skipped: boolean) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  refreshError?: string | null;
};

function queueIssueLinkText(issue: QueueIssue): string {
  return issue.title ?? `#${issue.number}`;
}

export function QueuePanel({
  project,
  queue,
  onSkipToggle,
  onRefresh,
  refreshing = false,
  refreshError = null,
}: QueuePanelProps) {
  if (!project) {
    return (
      <div className="panel-placeholder">
        <PanelHeader title="Queue" onRefresh={onRefresh} refreshDisabled refreshing={refreshing} />
        <p>Select a project to view the issue queue.</p>
      </div>
    );
  }

  const issuesUrl = githubIssuesUrl(project.remote);

  return (
    <div className="queue-panel">
      <PanelHeader
        title="Queue"
        onRefresh={onRefresh}
        refreshing={refreshing}
        error={refreshError}
        actions={
          <a href={issuesUrl} target="_blank" rel="noreferrer" className="panel-header-link">
            Issues on GitHub
          </a>
        }
      />
      {queue.length === 0 ? (
        <p className="queue-empty">No open issues with the AFK label.</p>
      ) : (
        <ul className="queue-list">
          {queue.map((issue) => {
            const reason = exclusionReason(issue, project);
            const marked = queueIssueNeedsStatusMarker(issue, project);
            const linkText = queueIssueLinkText(issue);
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
                  {marked ? <span className="queue-item-marker">❌ </span> : null}
                  <a
                    href={githubIssueUrl(project.remote, issue.number)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {linkText}
                  </a>
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

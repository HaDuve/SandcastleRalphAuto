import type { FocusedStatus } from "./focusedHeaderStatus.js";
import {
  cursorWorkspaceLink,
  githubIssueUrl,
  githubPrUrl,
  githubRepoUrl,
  truncateRemote,
} from "./linkTargets.js";

export type FocusedHeaderLineProps = {
  status: FocusedStatus;
};

function Separator() {
  return <span className="app-header-focused-sep"> · </span>;
}

export function FocusedHeaderLine({ status }: FocusedHeaderLineProps) {
  if (status.message) {
    return (
      <p className="app-header-focused" aria-label="Focused project">
        {status.message}
      </p>
    );
  }

  const { id, remote, path, worker, phase, issue, pr, outcome, reason, stoppedAt, sinceStop, phaseElapsed } =
    status;

  return (
    <p className="app-header-focused" aria-label="Focused project">
      {id && path ? (
        <a className="app-header-focused-link" href={cursorWorkspaceLink(path)}>
          {id}
        </a>
      ) : (
        id
      )}
      {remote ? (
        <>
          <Separator />
          <a
            className="app-header-focused-link"
            href={githubRepoUrl(remote)}
            target="_blank"
            rel="noreferrer"
            title={remote}
          >
            {truncateRemote(remote)}
          </a>
        </>
      ) : null}
      {issue !== null && remote ? (
        <>
          <Separator />
          <a
            className="app-header-focused-link"
            href={githubIssueUrl(remote, issue)}
            target="_blank"
            rel="noreferrer"
          >
            #{issue}
          </a>
        </>
      ) : null}
      {worker ? (
        <>
          <Separator />
          <span>{worker}</span>
        </>
      ) : null}
      {phase ? (
        <>
          <Separator />
          <span>{phase}</span>
        </>
      ) : null}
      {phaseElapsed ? (
        <>
          <Separator />
          <span>{phaseElapsed}</span>
        </>
      ) : null}
      {pr !== null && remote ? (
        <>
          <Separator />
          <a
            className="app-header-focused-link"
            href={githubPrUrl(remote, pr)}
            target="_blank"
            rel="noreferrer"
          >
            PR #{pr}
          </a>
        </>
      ) : null}
      {outcome ? (
        <>
          <Separator />
          <span>
            {outcome}
            {reason ? ` — ${reason}` : null}
          </span>
        </>
      ) : null}
      {stoppedAt || sinceStop ? (
        <>
          <Separator />
          <span>
            stopped {stoppedAt ?? "(missing)"}
            {sinceStop ? ` (${sinceStop})` : null}
          </span>
        </>
      ) : null}
    </p>
  );
}

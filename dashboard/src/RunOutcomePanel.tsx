import {
  formatOutcomeLabel,
  outcomeBannerClass,
  phaseLogHref,
  phaseLogLinkLabel,
} from "./runOutcomeUi.js";
import type { Project, RunOutcome } from "./types.js";

export type RunOutcomePanelProps = {
  project: Project | null;
  lastOutcome: RunOutcome | null;
};

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

  const bannerClass = `run-outcome-banner ${outcomeBannerClass(lastOutcome.outcome)}`;
  const phaseLog =
    lastOutcome.phase !== undefined
      ? phaseLogHref(project.id, lastOutcome.phase)
      : `/api/projects/${encodeURIComponent(project.id)}/log`;

  if (lastOutcome.outcome === "error") {
    return (
      <div className="run-outcome-panel">
        <h2>Run outcome</h2>
        <div className={bannerClass} role="status">
          <p className="run-outcome-banner-summary">
            Run crashed —{" "}
            <a href={phaseLog}>see log</a>
            {lastOutcome.phase ? (
              <>
                {" — "}
                <span className="run-outcome-banner-phase">{lastOutcome.phase}</span>
              </>
            ) : null}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="run-outcome-panel">
      <h2>Run outcome</h2>
      <div className={bannerClass} role="status">
        <p className="run-outcome-banner-summary">
          <strong>{formatOutcomeLabel(lastOutcome.outcome)}</strong>
          {lastOutcome.reason ? (
            <>
              {" — "}
              <span className="run-outcome-banner-reason">{lastOutcome.reason}</span>
            </>
          ) : null}
          {lastOutcome.phase ? (
            <>
              {" — "}
              <span className="run-outcome-banner-phase">{lastOutcome.phase}</span>
            </>
          ) : null}
          {lastOutcome.phase ? (
            <>
              {" — "}
              <a href={phaseLog}>{phaseLogLinkLabel(lastOutcome.phase)}</a>
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}

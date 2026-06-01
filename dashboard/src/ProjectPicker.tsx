import {
  formatProjectStatusIndicator,
  resolveActiveSummaryForCard,
  resolveWorkerStatusForCard,
} from "./projectStatus.js";
import { projectCardClass } from "./runOutcomeUi.js";
import type { Project, ProjectActiveSummary } from "./types.js";
import type { WorkerState, WorkerStatus } from "./workerStatus.js";
import { canHideProject, isControlReady, stoppedRunOutcome } from "./workerStatus.js";

export type ProjectPickerProps = {
  projects: Project[];
  selectedIds: Set<string>;
  workerStates: Record<string, WorkerState>;
  activeSummaries: Record<string, ProjectActiveSummary | null>;
  hasHiddenProjects: boolean;
  onSelectedChange: (projectId: string, selected: boolean) => void;
  onStart: (projectId: string) => void;
  onPause: (projectId: string) => void;
  onResume: (projectId: string) => void;
  onKill: (projectId: string) => void;
  onHide: (projectId: string) => void;
  onShowAll: () => void;
};

function workerStatusFor(workerStates: Record<string, WorkerState>, projectId: string): WorkerStatus {
  return workerStates[projectId]?.status ?? "unknown";
}

export function ProjectPicker({
  projects,
  selectedIds,
  workerStates,
  activeSummaries,
  hasHiddenProjects,
  onSelectedChange,
  onStart,
  onPause,
  onResume,
  onKill,
  onHide,
  onShowAll,
}: ProjectPickerProps) {
  return (
    <section aria-label="Projects">
      {hasHiddenProjects ? (
        <button type="button" aria-label="Show all hidden projects" onClick={onShowAll}>
          Show all
        </button>
      ) : null}
      <ul>
        {projects.map((project) => {
          const checked = selectedIds.has(project.id);
          const status = workerStatusFor(workerStates, project.id);
          const controlsReady = checked && isControlReady(status);
          const startDisabled = !controlsReady || status !== "idle";
          const pauseDisabled = !controlsReady || status !== "running";
          const resumeDisabled = !controlsReady || status !== "paused";
          const killDisabled = !controlsReady || status === "idle";
          const hideDisabled = !canHideProject(status);
          const cardClass = projectCardClass(stoppedRunOutcome(workerStates[project.id]));
          const statusLabel = formatProjectStatusIndicator(
            resolveWorkerStatusForCard(project, workerStates[project.id]),
            resolveActiveSummaryForCard(project, activeSummaries[project.id]),
          );

          return (
            <li key={project.id} className={cardClass}>
              <span className="project-status-indicator" role="status">
                {statusLabel}
              </span>
              <label>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => onSelectedChange(project.id, event.target.checked)}
                />
                {project.id}
                <span className="project-remote"> ({project.remote})</span>
              </label>
              <button
                type="button"
                disabled={startDisabled}
                onClick={() => onStart(project.id)}
              >
                Start {project.id}
              </button>
              <button
                type="button"
                disabled={pauseDisabled}
                onClick={() => onPause(project.id)}
              >
                Pause {project.id}
              </button>
              <button
                type="button"
                disabled={resumeDisabled}
                onClick={() => onResume(project.id)}
              >
                Resume {project.id}
              </button>
              <button
                type="button"
                disabled={killDisabled}
                onClick={() => onKill(project.id)}
              >
                Kill {project.id}
              </button>
              <button
                type="button"
                disabled={hideDisabled}
                onClick={() => onHide(project.id)}
              >
                Hide {project.id}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

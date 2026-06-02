import { projectCardClass } from "./runOutcomeUi.js";
import type { Project } from "./types.js";
import type { WorkerState, WorkerStatus } from "./workerStatus.js";
import { canHideProject, isControlReady, stoppedRunOutcome } from "./workerStatus.js";

export type ProjectPickerProps = {
  projects: Project[];
  selectedIds: Set<string>;
  workerStates: Record<string, WorkerState>;
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

          return (
            <li key={project.id} className={cardClass}>
              <label>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => onSelectedChange(project.id, event.target.checked)}
                />
                {project.id}
                <span className="project-remote"> ({project.remote})</span>
              </label>
              {!startDisabled ? (
                <button
                  type="button"
                  aria-label={`Start ${project.id}`}
                  onClick={() => onStart(project.id)}
                >
                  Start
                </button>
              ) : null}
              {!pauseDisabled ? (
                <button
                  type="button"
                  aria-label={`Pause ${project.id}`}
                  onClick={() => onPause(project.id)}
                >
                  Pause
                </button>
              ) : null}
              {!resumeDisabled ? (
                <button
                  type="button"
                  aria-label={`Resume ${project.id}`}
                  onClick={() => onResume(project.id)}
                >
                  Resume
                </button>
              ) : null}
              {!killDisabled ? (
                <button
                  type="button"
                  aria-label={`Kill ${project.id}`}
                  onClick={() => onKill(project.id)}
                >
                  Kill
                </button>
              ) : null}
              {!hideDisabled ? (
                <button
                  type="button"
                  aria-label={`Hide ${project.id}`}
                  onClick={() => onHide(project.id)}
                >
                  Hide
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

import type { Project } from "./types.js";
import type { WorkerStatus } from "./workerStatus.js";
import { isControlReady } from "./workerStatus.js";

export type ProjectPickerProps = {
  projects: Project[];
  selectedIds: Set<string>;
  workerStatuses: Record<string, WorkerStatus>;
  onSelectedChange: (projectId: string, selected: boolean) => void;
  onStart: (projectId: string) => void;
  onPause: (projectId: string) => void;
  onResume: (projectId: string) => void;
  onKill: (projectId: string) => void;
};

function workerStatusFor(
  workerStatuses: Record<string, WorkerStatus>,
  projectId: string,
): WorkerStatus {
  return workerStatuses[projectId] ?? "unknown";
}

export function ProjectPicker({
  projects,
  selectedIds,
  workerStatuses,
  onSelectedChange,
  onStart,
  onPause,
  onResume,
  onKill,
}: ProjectPickerProps) {
  return (
    <section aria-label="Projects">
      <ul>
        {projects.map((project) => {
          const checked = selectedIds.has(project.id);
          const status = workerStatusFor(workerStatuses, project.id);
          const controlsReady = checked && isControlReady(status);
          const startDisabled = !controlsReady || status !== "idle";
          const pauseDisabled = !controlsReady || status !== "running";
          const resumeDisabled = !controlsReady || status !== "paused";
          const killDisabled = !controlsReady || status === "idle";

          return (
            <li key={project.id}>
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
            </li>
          );
        })}
      </ul>
    </section>
  );
}

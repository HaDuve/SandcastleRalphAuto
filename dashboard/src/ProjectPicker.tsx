import type { Project } from "./types.js";

export type ProjectPickerProps = {
  projects: Project[];
  selectedIds: Set<string>;
  onSelectedChange: (projectId: string, selected: boolean) => void;
  onStart: (projectId: string) => void;
  onPause: (projectId: string) => void;
};

export function ProjectPicker({
  projects,
  selectedIds,
  onSelectedChange,
  onStart,
  onPause,
}: ProjectPickerProps) {
  return (
    <section aria-label="Projects">
      <ul>
        {projects.map((project) => {
          const checked = selectedIds.has(project.id);
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
                disabled={!checked}
                onClick={() => onStart(project.id)}
              >
                Start {project.id}
              </button>
              <button
                type="button"
                disabled={!checked}
                onClick={() => onPause(project.id)}
              >
                Pause {project.id}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

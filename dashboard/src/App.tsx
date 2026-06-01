import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchProjects, pauseProject, startProject } from "./api.js";
import { DashboardLayout } from "./DashboardLayout.js";
import { ProjectPicker } from "./ProjectPicker.js";
import type { Project } from "./types.js";
import "./app.css";

function PanelPlaceholder({ title, projectId }: { title: string; projectId: string | null }) {
  return (
    <div className="panel-placeholder">
      <h2>{title}</h2>
      <p>{projectId ? `Project: ${projectId}` : "Select a project to view details."}</p>
    </div>
  );
}

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchProjects()
      .then((loaded) => {
        if (!cancelled) {
          setProjects(loaded);
          setLoadError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Failed to load projects");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const focusedProjectId = useMemo(() => {
    const selected = projects.filter((project) => selectedIds.has(project.id));
    return selected[0]?.id ?? null;
  }, [projects, selectedIds]);

  const handleSelectedChange = useCallback((projectId: string, selected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(projectId);
      } else {
        next.delete(projectId);
      }
      return next;
    });
  }, []);

  const runControl = useCallback(async (action: "start" | "pause", projectId: string) => {
    setControlError(null);
    try {
      if (action === "start") {
        await startProject(projectId);
      } else {
        await pauseProject(projectId);
      }
    } catch (error: unknown) {
      setControlError(error instanceof Error ? error.message : "Control request failed");
    }
  }, []);

  return (
    <div className="app-root">
      <header className="app-header">
        <h1>Sandcastle Ralph Auto</h1>
        {loadError ? <p role="alert">{loadError}</p> : null}
        {controlError ? <p role="alert">{controlError}</p> : null}
      </header>
      <DashboardLayout
        picker={
          <ProjectPicker
            projects={projects}
            selectedIds={selectedIds}
            onSelectedChange={handleSelectedChange}
            onStart={(projectId) => void runControl("start", projectId)}
            onPause={(projectId) => void runControl("pause", projectId)}
          />
        }
        queue={<PanelPlaceholder title="Queue" projectId={focusedProjectId} />}
        active={<PanelPlaceholder title="Active slice" projectId={focusedProjectId} />}
        stream={<PanelPlaceholder title="Live stream" projectId={focusedProjectId} />}
        history={<PanelPlaceholder title="History" projectId={focusedProjectId} />}
      />
    </div>
  );
}

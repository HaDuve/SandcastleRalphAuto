import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchActive,
  fetchProjects,
  fetchQueue,
  pauseProject,
  setIssueSkip,
  startProject,
} from "./api.js";
import { ActivePanel } from "./ActivePanel.js";
import { DashboardLayout } from "./DashboardLayout.js";
import { ProjectPicker } from "./ProjectPicker.js";
import { QueuePanel } from "./QueuePanel.js";
import type { ActiveSlice, Project, QueueIssue } from "./types.js";
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
  const [focusedProjectId, setFocusedProjectId] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueIssue[]>([]);
  const [active, setActive] = useState<ActiveSlice | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const focusedProjectIdRef = useRef(focusedProjectId);

  const focusedProject = projects.find((project) => project.id === focusedProjectId) ?? null;

  useEffect(() => {
    focusedProjectIdRef.current = focusedProjectId;
  }, [focusedProjectId]);

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

  const refreshPanels = useCallback(async (projectId: string) => {
    setPanelError(null);
    try {
      const [nextQueue, nextActive] = await Promise.all([
        fetchQueue(projectId),
        fetchActive(projectId),
      ]);
      if (focusedProjectIdRef.current !== projectId) {
        return;
      }
      setQueue(nextQueue);
      setActive(nextActive);
    } catch (error: unknown) {
      if (focusedProjectIdRef.current !== projectId) {
        return;
      }
      setPanelError(error instanceof Error ? error.message : "Failed to load project panels");
    }
  }, []);

  useEffect(() => {
    if (!focusedProjectId) {
      setQueue([]);
      setActive(null);
      return;
    }

    let cancelled = false;
    const projectId = focusedProjectId;

    void (async () => {
      setPanelError(null);
      try {
        const [nextQueue, nextActive] = await Promise.all([
          fetchQueue(projectId),
          fetchActive(projectId),
        ]);
        if (cancelled || focusedProjectIdRef.current !== projectId) {
          return;
        }
        setQueue(nextQueue);
        setActive(nextActive);
      } catch (error: unknown) {
        if (cancelled || focusedProjectIdRef.current !== projectId) {
          return;
        }
        setPanelError(error instanceof Error ? error.message : "Failed to load project panels");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [focusedProjectId]);

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
    setFocusedProjectId((current) => {
      if (selected) {
        return projectId;
      }
      if (current === projectId) {
        return null;
      }
      return current;
    });
  }, []);

  const runControl = useCallback(
    async (action: "start" | "pause", projectId: string) => {
      setControlError(null);
      try {
        if (action === "start") {
          await startProject(projectId);
        } else {
          await pauseProject(projectId);
        }
        if (focusedProjectIdRef.current === projectId) {
          await refreshPanels(projectId);
        }
      } catch (error: unknown) {
        setControlError(error instanceof Error ? error.message : "Control request failed");
      }
    },
    [refreshPanels],
  );

  const handleSkipToggle = useCallback(
    async (issue: number, skipped: boolean) => {
      if (!focusedProjectId) {
        return;
      }
      const projectId = focusedProjectId;
      setPanelError(null);
      setQueue((current) =>
        current.map((entry) =>
          entry.number === issue
            ? { ...entry, skipped, eligible: skipped ? false : entry.eligible }
            : entry,
        ),
      );
      try {
        await setIssueSkip(projectId, issue, skipped);
        await refreshPanels(projectId);
      } catch (error: unknown) {
        if (focusedProjectIdRef.current === projectId) {
          setPanelError(error instanceof Error ? error.message : "Failed to update skip");
          await refreshPanels(projectId);
        }
      }
    },
    [focusedProjectId, refreshPanels],
  );

  return (
    <div className="app-root">
      <header className="app-header">
        <h1>Sandcastle Ralph Auto</h1>
        {loadError ? <p role="alert">{loadError}</p> : null}
        {controlError ? <p role="alert">{controlError}</p> : null}
        {panelError ? <p role="alert">{panelError}</p> : null}
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
        queue={
          <QueuePanel
            project={focusedProject}
            queue={queue}
            onSkipToggle={(issue, skipped) => void handleSkipToggle(issue, skipped)}
          />
        }
        active={<ActivePanel project={focusedProject} active={active} />}
        stream={<PanelPlaceholder title="Live stream" projectId={focusedProjectId} />}
        history={<PanelPlaceholder title="History" projectId={focusedProjectId} />}
      />
    </div>
  );
}

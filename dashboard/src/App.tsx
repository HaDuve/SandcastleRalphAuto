import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchActive,
  fetchHistory,
  fetchProjects,
  fetchQueue,
  killProject,
  NOT_RUNNING_ERROR,
  pauseProject,
  resumeProject,
  setIssueSkip,
  startProject,
  subscribeProjectEvents,
} from "./api.js";
import { ActivePanel } from "./ActivePanel.js";
import { DashboardLayout } from "./DashboardLayout.js";
import { HistoryPanel } from "./HistoryPanel.js";
import { ProjectPicker } from "./ProjectPicker.js";
import { QueuePanel } from "./QueuePanel.js";
import type { ActiveSlice, HistoryEntry, Project, QueueIssue } from "./types.js";
import { readHiddenIds, writeHiddenIds } from "./hiddenProjects.js";
import { applyWorkerEvent, type WorkerStatus } from "./workerStatus.js";
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
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => readHiddenIds());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [workerStatuses, setWorkerStatuses] = useState<Record<string, WorkerStatus>>({});
  const [focusedProjectId, setFocusedProjectId] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueIssue[]>([]);
  const [active, setActive] = useState<ActiveSlice | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const focusedProjectIdRef = useRef(focusedProjectId);

  const focusedProject = projects.find((project) => project.id === focusedProjectId) ?? null;
  const visibleProjects = projects.filter((project) => !hiddenIds.has(project.id));

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

  useEffect(() => {
    const unsubscribes: Array<() => void> = [];
    for (const projectId of selectedIds) {
      unsubscribes.push(
        subscribeProjectEvents(projectId, (event) => {
          setWorkerStatuses((current) => ({
            ...current,
            [projectId]: applyWorkerEvent(current[projectId], event),
          }));
        }),
      );
    }
    return () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    };
  }, [selectedIds]);

  const refreshPanels = useCallback(async (projectId: string) => {
    setPanelError(null);
    try {
      const [nextQueue, nextActive, nextHistory] = await Promise.all([
        fetchQueue(projectId),
        fetchActive(projectId),
        fetchHistory(projectId),
      ]);
      if (focusedProjectIdRef.current !== projectId) {
        return;
      }
      setQueue(nextQueue);
      setActive(nextActive);
      setHistory(nextHistory);
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
      setHistory([]);
      return;
    }

    let cancelled = false;
    const projectId = focusedProjectId;

    void (async () => {
      setPanelError(null);
      try {
        const [nextQueue, nextActive, nextHistory] = await Promise.all([
          fetchQueue(projectId),
          fetchActive(projectId),
          fetchHistory(projectId),
        ]);
        if (cancelled || focusedProjectIdRef.current !== projectId) {
          return;
        }
        setQueue(nextQueue);
        setActive(nextActive);
        setHistory(nextHistory);
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

  const handleHide = useCallback((projectId: string) => {
    setHiddenIds((current) => {
      const next = new Set(current);
      next.add(projectId);
      writeHiddenIds(next);
      return next;
    });
    setSelectedIds((current) => {
      if (!current.has(projectId)) {
        return current;
      }
      const next = new Set(current);
      next.delete(projectId);
      return next;
    });
    setFocusedProjectId((current) => (current === projectId ? null : current));
  }, []);

  const handleShowAll = useCallback(() => {
    setHiddenIds(() => {
      const next = new Set<string>();
      writeHiddenIds(next);
      return next;
    });
  }, []);

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

  const setWorkerStatus = useCallback((projectId: string, status: WorkerStatus) => {
    setWorkerStatuses((current) => ({ ...current, [projectId]: status }));
  }, []);

  const runControl = useCallback(
    async (action: "start" | "pause" | "resume" | "kill", projectId: string) => {
      setControlError(null);
      try {
        if (action === "start") {
          await startProject(projectId);
          setWorkerStatus(projectId, "running");
        } else if (action === "pause") {
          const result = await pauseProject(projectId);
          if (result.status === "not-running") {
            setWorkerStatus(projectId, "idle");
            setControlError(NOT_RUNNING_ERROR);
            return;
          }
          setWorkerStatus(projectId, "paused");
        } else if (action === "resume") {
          const result = await resumeProject(projectId);
          if (result.status === "not-running") {
            setWorkerStatus(projectId, "idle");
            setControlError(NOT_RUNNING_ERROR);
            return;
          }
          setWorkerStatus(projectId, "running");
        } else {
          const result = await killProject(projectId);
          if (result.status === "not-running") {
            setWorkerStatus(projectId, "idle");
            setControlError(NOT_RUNNING_ERROR);
            return;
          }
        }
        if (focusedProjectIdRef.current === projectId) {
          await refreshPanels(projectId);
        }
      } catch (error: unknown) {
        setControlError(error instanceof Error ? error.message : "Control request failed");
      }
    },
    [refreshPanels, setWorkerStatus],
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
            projects={visibleProjects}
            selectedIds={selectedIds}
            workerStatuses={workerStatuses}
            hasHiddenProjects={hiddenIds.size > 0}
            onSelectedChange={handleSelectedChange}
            onStart={(projectId) => void runControl("start", projectId)}
            onPause={(projectId) => void runControl("pause", projectId)}
            onResume={(projectId) => void runControl("resume", projectId)}
            onKill={(projectId) => void runControl("kill", projectId)}
            onHide={handleHide}
            onShowAll={handleShowAll}
          />
        }
        runOutcome={<PanelPlaceholder title="Run outcome" projectId={focusedProjectId} />}
        phaseStepper={<PanelPlaceholder title="Phase stepper" projectId={focusedProjectId} />}
        active={<ActivePanel project={focusedProject} active={active} />}
        log={<PanelPlaceholder title="Log" projectId={focusedProjectId} />}
        queue={
          <QueuePanel
            project={focusedProject}
            queue={queue}
            onSkipToggle={(issue, skipped) => void handleSkipToggle(issue, skipped)}
          />
        }
        history={<HistoryPanel project={focusedProject} history={history} />}
      />
    </div>
  );
}

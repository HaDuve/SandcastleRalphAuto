import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
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
import {
  activeSummariesFromProjects,
  activeSummaryFromSlice,
  withActivePhase,
} from "./activeSummaries.js";
import { ActivePanel } from "./ActivePanel.js";
import { DashboardLayout } from "./DashboardLayout.js";
import { HistoryPanel } from "./HistoryPanel.js";
import { LogPanel } from "./LogPanel.js";
import { ProjectPicker } from "./ProjectPicker.js";
import { QueuePanel } from "./QueuePanel.js";
import { PhaseStepper } from "./PhaseStepper.js";
import { RunOutcomePanel } from "./RunOutcomePanel.js";
import type { ActiveSlice, HistoryEntry, Project, ProjectActiveSummary, QueueIssue } from "./types.js";
import { pruneHiddenIds, readHiddenIds, writeHiddenIds } from "./hiddenProjects.js";
import { workerStatesFromProjects } from "./rehydrateProjects.js";
import {
  pruneSelectedIds,
  readFocusedProjectId,
  readSelectedIds,
  resolveFocusedProjectId,
  writeFocusedProjectId,
  writeSelectedIds,
} from "./selectedProjects.js";
import { applyWorkerEvent, canHideProject, stoppedRunOutcome, type WorkerState } from "./workerStatus.js";
import "./app.css";

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => readHiddenIds());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => readSelectedIds());
  const [workerStates, setWorkerStates] = useState<Record<string, WorkerState>>({});
  const [activeSummaries, setActiveSummaries] = useState<Record<string, ProjectActiveSummary | null>>(
    {},
  );
  const [focusedProjectId, setFocusedProjectId] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueIssue[]>([]);
  const [active, setActive] = useState<ActiveSlice | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [catalogReady, setCatalogReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const focusedProjectIdRef = useRef(focusedProjectId);
  const logPhaseLogHandlerRef = useRef<((chunk: string) => void) | null>(null);

  const focusedProject = projects.find((project) => project.id === focusedProjectId) ?? null;
  const focusedLastOutcome =
    focusedProjectId === null ? null : stoppedRunOutcome(workerStates[focusedProjectId]);
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
          setCatalogReady(true);
          setLoadError(null);
          const knownProjectIds = new Set(loaded.map((project) => project.id));
          setHiddenIds((current) => {
            const next = pruneHiddenIds(current, knownProjectIds);
            if (next.size === current.size) {
              return current;
            }
            writeHiddenIds(next);
            return next;
          });
          let nextSelectedIds!: Set<string>;
          flushSync(() => {
            setSelectedIds((current) => {
              nextSelectedIds = pruneSelectedIds(current, knownProjectIds);
              if (nextSelectedIds.size !== current.size) {
                writeSelectedIds(nextSelectedIds);
              }
              return nextSelectedIds;
            });
          });
          setWorkerStates(workerStatesFromProjects(loaded, nextSelectedIds));
          setActiveSummaries(activeSummariesFromProjects(loaded));
          setFocusedProjectId(
            resolveFocusedProjectId(nextSelectedIds, readFocusedProjectId()),
          );
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

  const syncActiveSummary = useCallback(async (projectId: string) => {
    try {
      const nextActive = await fetchActive(projectId);
      setActiveSummaries((current) => ({
        ...current,
        [projectId]: activeSummaryFromSlice(nextActive),
      }));
      if (focusedProjectIdRef.current === projectId) {
        setActive(nextActive);
      }
    } catch {
      // Sidebar sync is best-effort; panel errors surface on explicit refresh.
    }
  }, []);

  useEffect(() => {
    if (!catalogReady) {
      return;
    }
    const unsubscribes: Array<() => void> = [];
    for (const projectId of selectedIds) {
      unsubscribes.push(
        subscribeProjectEvents(projectId, (event) => {
          setWorkerStates((current) => ({
            ...current,
            [projectId]: applyWorkerEvent(current[projectId], event),
          }));
          if (event.type === "worker-stopped" && event.lastRunOutcome) {
            const lastRunOutcome = event.lastRunOutcome;
            setProjects((current) =>
              current.map((project) =>
                project.id === projectId
                  ? { ...project, workerStatus: "idle", lastRunOutcome }
                  : project,
              ),
            );
          }
          if (event.type === "stream" && event.phase) {
            const nextPhase = event.phase;
            setActiveSummaries((current) => ({
              ...current,
              [projectId]: withActivePhase(current[projectId], nextPhase, event.issue),
            }));
            if (projectId === focusedProjectIdRef.current) {
              setActive((current) =>
                current && current.phase !== nextPhase
                  ? { ...current, phase: nextPhase }
                  : current,
              );
            }
          }
          if (event.type === "worker-stopped") {
            void syncActiveSummary(projectId);
          }
          if (projectId !== focusedProjectIdRef.current) {
            return;
          }
          if (event.type === "phase-log" && event.chunk) {
            logPhaseLogHandlerRef.current?.(event.chunk);
          }
        }),
      );
    }
    return () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    };
  }, [catalogReady, selectedIds, syncActiveSummary]);

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
      setActiveSummaries((current) => ({
        ...current,
        [projectId]: activeSummaryFromSlice(nextActive),
      }));
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
        setActiveSummaries((current) => ({
          ...current,
          [projectId]: activeSummaryFromSlice(nextActive),
        }));
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
    const status = workerStates[projectId]?.status ?? "unknown";
    if (!canHideProject(status)) {
      return;
    }
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
      writeSelectedIds(next);
      return next;
    });
    setFocusedProjectId((current) => {
      const next = current === projectId ? null : current;
      writeFocusedProjectId(next);
      return next;
    });
  }, [workerStates]);

  const handleShowAll = useCallback(() => {
    setHiddenIds(() => {
      const next = new Set<string>();
      writeHiddenIds(next);
      return next;
    });
  }, []);

  const handleSelectedChange = useCallback((projectId: string, selected: boolean) => {
    if (selected) {
      const project = projects.find((entry) => entry.id === projectId);
      if (project) {
        setWorkerStates((current) => ({
          ...current,
          [projectId]: workerStatesFromProjects([project], new Set([projectId]))[projectId]!,
        }));
        setActiveSummaries((current) => ({
          ...current,
          [projectId]: project.active ?? null,
        }));
      }
    }
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(projectId);
      } else {
        next.delete(projectId);
      }
      writeSelectedIds(next);
      return next;
    });
    setFocusedProjectId((current) => {
      const next = selected ? projectId : current === projectId ? null : current;
      writeFocusedProjectId(next);
      return next;
    });
  }, [projects]);

  const setWorkerStatus = useCallback((projectId: string, status: WorkerState["status"]) => {
    setWorkerStates((current) => ({
      ...current,
      [projectId]: { status, lastOutcome: current[projectId]?.lastOutcome ?? null },
    }));
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
            workerStates={workerStates}
            activeSummaries={activeSummaries}
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
        runOutcome={
          <RunOutcomePanel project={focusedProject} lastOutcome={focusedLastOutcome} />
        }
        phaseStepper={
          <PhaseStepper
            project={focusedProject}
            currentPhase={
              focusedProjectId === null
                ? null
                : (activeSummaries[focusedProjectId]?.phase ?? active?.phase ?? null)
            }
          />
        }
        active={<ActivePanel project={focusedProject} active={active} />}
        log={
          <LogPanel
            project={focusedProject}
            activePhase={active?.phase ?? null}
            registerPhaseLogHandler={(handler) => {
              logPhaseLogHandlerRef.current = handler;
            }}
          />
        }
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

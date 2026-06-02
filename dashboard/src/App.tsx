import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  focusedLogIssue,
  focusedPhase,
  optimisticStartContext,
} from "./optimisticStart.js";
import { buildFocusedStatus } from "./focusedHeaderStatus.js";
import { FocusedHeaderLine } from "./FocusedHeaderLine.js";
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
import { formatFleetLine, summarizeFleet } from "./fleetSummary.js";
import { useNow } from "./useNow.js";
import { useAutoRefresh } from "./useAutoRefresh.js";
import {
  AUTO_REFRESH_INTERVAL_MS,
  EMPTY_TILE_ERRORS,
  EMPTY_TILE_REFRESHING,
  type DashboardTile,
  type TileErrors,
  type TileRefreshing,
} from "./dashboardTiles.js";
import type { LogRefreshHandler } from "./LogPanel.js";
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
  const logRefreshHandlerRef = useRef<LogRefreshHandler>(null);
  const [tileErrors, setTileErrors] = useState<TileErrors>(EMPTY_TILE_ERRORS);
  const [tileRefreshing, setTileRefreshingState] = useState<TileRefreshing>(EMPTY_TILE_REFRESHING);

  const focusedProject = projects.find((project) => project.id === focusedProjectId) ?? null;
  const focusedLastOutcome =
    focusedProjectId === null ? null : stoppedRunOutcome(workerStates[focusedProjectId]);
  const visibleProjects = projects.filter((project) => !hiddenIds.has(project.id));
  const now = useNow(10_000);
  const fleetLine = formatFleetLine(
    summarizeFleet(visibleProjects, workerStates, activeSummaries, hiddenIds.size),
  );
  const focusedStatus = buildFocusedStatus(
    focusedProject,
    focusedProjectId === null ? undefined : workerStates[focusedProjectId],
    focusedProjectId === null ? null : activeSummaries[focusedProjectId],
    active,
    now,
  );

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
      setActiveSummaries((current) => {
        if (nextActive === null) {
          return current;
        }
        return {
          ...current,
          [projectId]: activeSummaryFromSlice(nextActive),
        };
      });
      if (focusedProjectIdRef.current === projectId) {
        setActive(nextActive);
      }
    } catch {
      // Sidebar sync is best-effort; panel errors surface on explicit refresh.
    }
  }, []);


  const clearTileError = useCallback((tile: DashboardTile) => {
    setTileErrors((current) => (current[tile] === null ? current : { ...current, [tile]: null }));
  }, []);

  const setTileError = useCallback((tile: DashboardTile, message: string) => {
    setTileErrors((current) => ({ ...current, [tile]: message }));
  }, []);

  const updateTileRefreshing = useCallback((tile: DashboardTile, refreshing: boolean) => {
    setTileRefreshingState((current) =>
      current[tile] === refreshing ? current : { ...current, [tile]: refreshing },
    );
  }, []);

  const runTileRefresh = useCallback(
    async (tile: DashboardTile, refresh: () => Promise<void>) => {
      updateTileRefreshing(tile, true);
      try {
        await refresh();
      } finally {
        updateTileRefreshing(tile, false);
      }
    },
    [updateTileRefreshing],
  );

  const applyActiveRefresh = useCallback(
    async (projectId: string) => {
      const nextActive = await fetchActive(projectId);
      if (focusedProjectIdRef.current !== projectId) {
        return;
      }
      setActive(nextActive);
      setActiveSummaries((current) => {
        if (nextActive === null) {
          return current;
        }
        return {
          ...current,
          [projectId]: activeSummaryFromSlice(nextActive),
        };
      });
      return nextActive;
    },
    [],
  );

  const refreshPhaseStepper = useCallback(async () => {
    await runTileRefresh("phaseStepper", async () => {
      const projectId = focusedProjectIdRef.current;
      if (!projectId) {
        return;
      }
      try {
        await applyActiveRefresh(projectId);
        clearTileError("phaseStepper");
      } catch (error: unknown) {
        if (focusedProjectIdRef.current !== projectId) {
          return;
        }
        setTileError(
          "phaseStepper",
          error instanceof Error ? error.message : "Failed to refresh phase stepper",
        );
      }
    });
  }, [applyActiveRefresh, clearTileError, runTileRefresh, setTileError]);


  const refreshQueue = useCallback(async () => {
    await runTileRefresh("queue", async () => {
      const projectId = focusedProjectIdRef.current;
      if (!projectId) {
        return;
      }
      try {
        const nextQueue = await fetchQueue(projectId);
        if (focusedProjectIdRef.current !== projectId) {
          return;
        }
        setQueue(nextQueue);
        clearTileError("queue");
      } catch (error: unknown) {
        if (focusedProjectIdRef.current !== projectId) {
          return;
        }
        setTileError("queue", error instanceof Error ? error.message : "Failed to refresh queue");
      }
    });
  }, [clearTileError, runTileRefresh, setTileError]);

  const refreshHistory = useCallback(async () => {
    await runTileRefresh("history", async () => {
      const projectId = focusedProjectIdRef.current;
      if (!projectId) {
        return;
      }
      try {
        const nextHistory = await fetchHistory(projectId);
        if (focusedProjectIdRef.current !== projectId) {
          return;
        }
        setHistory(nextHistory);
        clearTileError("history");
      } catch (error: unknown) {
        if (focusedProjectIdRef.current !== projectId) {
          return;
        }
        setTileError(
          "history",
          error instanceof Error ? error.message : "Failed to refresh history",
        );
      }
    });
  }, [clearTileError, runTileRefresh, setTileError]);

  const refreshLog = useCallback(async () => {
    await runTileRefresh("log", async () => {
      const projectId = focusedProjectIdRef.current;
      if (!projectId) {
        return;
      }
      try {
        await logRefreshHandlerRef.current?.();
        if (focusedProjectIdRef.current !== projectId) {
          return;
        }
        clearTileError("log");
      } catch (error: unknown) {
        if (focusedProjectIdRef.current !== projectId) {
          return;
        }
        setTileError("log", error instanceof Error ? error.message : "Failed to refresh log");
      }
    });
  }, [clearTileError, runTileRefresh, setTileError]);

  const refreshAllFocusedTiles = useCallback(async () => {
    await Promise.all([
      refreshPhaseStepper(),
      refreshLog(),
      refreshQueue(),
      refreshHistory(),
    ]);
  }, [refreshHistory, refreshLog, refreshPhaseStepper, refreshQueue]);

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
      setActiveSummaries((current) => {
        if (nextActive === null) {
          return current;
        }
        return {
          ...current,
          [projectId]: activeSummaryFromSlice(nextActive),
        };
      });
    } catch (error: unknown) {
      if (focusedProjectIdRef.current !== projectId) {
        return;
      }
      setPanelError(error instanceof Error ? error.message : "Failed to load project panels");
    }
  }, []);

  const selectedProjectIdsKey = useMemo(
    () => [...selectedIds].sort().join("\0"),
    [selectedIds],
  );
  const refreshPanelsRef = useRef(refreshPanels);
  const syncActiveSummaryRef = useRef(syncActiveSummary);

  useEffect(() => {
    refreshPanelsRef.current = refreshPanels;
  }, [refreshPanels]);

  useEffect(() => {
    syncActiveSummaryRef.current = syncActiveSummary;
  }, [syncActiveSummary]);

  useEffect(() => {
    if (!catalogReady) {
      return;
    }
    const projectIds = selectedProjectIdsKey.split("\0").filter(Boolean);
    const unsubscribes: Array<() => void> = [];
    for (const projectId of projectIds) {
      unsubscribes.push(
        subscribeProjectEvents(projectId, (event) => {
          if (
            event.type === "connected" ||
            event.type.startsWith("worker-")
          ) {
            setWorkerStates((current) => ({
              ...current,
              [projectId]: applyWorkerEvent(current[projectId], event),
            }));
          }
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
            setActiveSummaries((current) => {
              const summary = current[projectId];
              if (summary?.phase === nextPhase) {
                return current;
              }
              return {
                ...current,
                [projectId]: withActivePhase(summary, nextPhase, event.issue),
              };
            });
            if (projectId === focusedProjectIdRef.current) {
              setActive((current) =>
                current && current.phase !== nextPhase
                  ? { ...current, phase: nextPhase }
                  : current,
              );
            }
          }
          if (event.type === "worker-started") {
            if (projectId === focusedProjectIdRef.current) {
              void refreshPanelsRef.current(projectId);
            }
          }
          if (event.type === "worker-stopped") {
            void syncActiveSummaryRef.current(projectId);
            if (projectId === focusedProjectIdRef.current) {
              void refreshPanelsRef.current(projectId);
            }
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
  }, [catalogReady, selectedProjectIdsKey]);

  useAutoRefresh({
    enabled: catalogReady && focusedProjectId !== null,
    intervalMs: AUTO_REFRESH_INTERVAL_MS,
    onRefresh: refreshAllFocusedTiles,
    resetKey: focusedProjectId,
  });

  useEffect(() => {
    if (!focusedProjectId) {
      setQueue([]);
      setActive(null);
      setHistory([]);
      setTileErrors(EMPTY_TILE_ERRORS);
      setTileRefreshingState(EMPTY_TILE_REFRESHING);
      return;
    }

    setTileErrors(EMPTY_TILE_ERRORS);

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
        setActiveSummaries((current) => {
          if (nextActive === null) {
            return current;
          }
          return {
            ...current,
            [projectId]: activeSummaryFromSlice(nextActive),
          };
        });
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
        setWorkerStates((current) => {
          const fromCatalog = workerStatesFromProjects([project], new Set([projectId]))[projectId]!;
          const existing = current[projectId];
          const nextState =
            fromCatalog.lastOutcome === null &&
            existing?.status === "idle" &&
            existing.lastOutcome !== null
              ? existing
              : fromCatalog;
          return { ...current, [projectId]: nextState };
        });
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

  type OptimisticStartSnapshot = {
    workerStatus: WorkerState["status"];
    summary: ProjectActiveSummary | null;
    active: ActiveSlice | null;
  };

  const applyOptimisticStart = useCallback(
    (projectId: string) => {
      const project = projects.find((entry) => entry.id === projectId);
      const context = optimisticStartContext({
        queue: focusedProjectIdRef.current === projectId ? queue : [],
        active: focusedProjectIdRef.current === projectId ? active : null,
        catalogActive: project?.active ?? null,
        summary: activeSummaries[projectId] ?? null,
      });
      setActiveSummaries((current) => ({
        ...current,
        [projectId]: context.summary,
      }));
      if (focusedProjectIdRef.current === projectId) {
        setActive(context.slice);
      }
      setWorkerStatus(projectId, "running");
    },
    [active, activeSummaries, projects, queue],
  );

  const revertOptimisticStart = useCallback(
    (projectId: string, snapshot: OptimisticStartSnapshot) => {
      setWorkerStatus(projectId, snapshot.workerStatus);
      setActiveSummaries((current) => ({
        ...current,
        [projectId]: snapshot.summary,
      }));
      if (focusedProjectIdRef.current === projectId) {
        setActive(snapshot.active);
      }
    },
    [setWorkerStatus],
  );

  const runControl = useCallback(
    async (action: "start" | "pause" | "resume" | "kill", projectId: string) => {
      setControlError(null);
      let startSnapshot: OptimisticStartSnapshot | null = null;
      if (action === "start") {
        startSnapshot = {
          workerStatus: workerStates[projectId]?.status ?? "idle",
          summary: activeSummaries[projectId] ?? null,
          active: focusedProjectIdRef.current === projectId ? active : null,
        };
        flushSync(() => {
          applyOptimisticStart(projectId);
        });
      }
      try {
        if (action === "start") {
          await startProject(projectId);
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
        if (action === "start" && startSnapshot) {
          revertOptimisticStart(projectId, startSnapshot);
        }
        setControlError(error instanceof Error ? error.message : "Control request failed");
      }
    },
    [
      active,
      activeSummaries,
      applyOptimisticStart,
      refreshPanels,
      revertOptimisticStart,
      setWorkerStatus,
      workerStates,
    ],
  );

  const focusedDisplayPhase =
    focusedProjectId === null
      ? null
      : focusedPhase(focusedProjectId, activeSummaries, active);
  const focusedLogIssueNumber = focusedLogIssue(
    focusedProjectId,
    active,
    focusedProject?.active ?? null,
    activeSummaries,
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
        <div className="app-header-title">
          <h1>Sandcastle Ralph Auto</h1>
        </div>
        <div className="app-header-status">
          <FocusedHeaderLine status={focusedStatus} />
          <p className="app-header-fleet" aria-label="Fleet summary">
            {fleetLine}
          </p>
          {loadError ? <p role="alert">{loadError}</p> : null}
          {controlError ? <p role="alert">{controlError}</p> : null}
          {panelError ? <p role="alert">{panelError}</p> : null}
        </div>
      </header>
      <DashboardLayout
        picker={
          <ProjectPicker
            projects={visibleProjects}
            selectedIds={selectedIds}
            workerStates={workerStates}
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
            summary={focusedProjectId === null ? null : activeSummaries[focusedProjectId] ?? null}
            currentPhase={focusedDisplayPhase}
            active={active}
            onRefresh={() => void refreshPhaseStepper()}
            refreshing={tileRefreshing.phaseStepper}
            refreshError={tileErrors.phaseStepper}
          />
        }
        log={
          <LogPanel
            project={focusedProject}
            activePhase={focusedDisplayPhase}
            logIssueFallback={focusedLogIssueNumber}
            registerPhaseLogHandler={(handler) => {
              logPhaseLogHandlerRef.current = handler;
            }}
            registerRefreshHandler={(handler) => {
              logRefreshHandlerRef.current = handler;
            }}
            onRefresh={() => void refreshLog()}
            refreshing={tileRefreshing.log}
            refreshError={tileErrors.log}
          />
        }
        queue={
          <QueuePanel
            project={focusedProject}
            queue={queue}
            onSkipToggle={(issue, skipped) => void handleSkipToggle(issue, skipped)}
            onRefresh={() => void refreshQueue()}
            refreshing={tileRefreshing.queue}
            refreshError={tileErrors.queue}
          />
        }
        history={
          <HistoryPanel
            project={focusedProject}
            history={history}
            onRefresh={() => void refreshHistory()}
            refreshing={tileRefreshing.history}
            refreshError={tileErrors.history}
          />
        }
      />
    </div>
  );
}

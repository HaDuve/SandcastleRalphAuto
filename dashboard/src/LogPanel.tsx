import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { fetchProjectLog } from "./api.js";
import { appendLogChunk, lastLines, scrollLogBodyToTail } from "./logLines.js";
import { PanelHeader } from "./PanelHeader.js";
import type { Project } from "./types.js";

const PREVIEW_LINE_COUNT = 5;

export type PhaseLogHandler = ((chunk: string) => void) | null;
export type LogRefreshHandler = (() => Promise<void>) | null;

export type LogPanelProps = {
  project: Project | null;
  activePhase: string | null;
  /** When `active.json` is cleared mid-run, load logs by issue + phase. */
  logIssueFallback?: number | null;
  registerPhaseLogHandler?: (handler: PhaseLogHandler) => void;
  registerRefreshHandler?: (handler: LogRefreshHandler) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  refreshError?: string | null;
};

function applyProjectLog(
  result: NonNullable<Awaited<ReturnType<typeof fetchProjectLog>>>,
  options: {
    livePhaseRef: MutableRefObject<string | null>;
    viewPhaseRef: MutableRefObject<string | null>;
    reseedView: boolean;
    preserveSseTail: boolean;
    lastFetchedLogRef: MutableRefObject<string>;
    setPhases: (phases: string[]) => void;
    setViewPhase: (phase: string) => void;
    setLogText: (log: string | ((current: string) => string)) => void;
  },
): void {
  options.livePhaseRef.current = result.phase;
  options.setPhases(result.phases);
  const fetchedLog = result.log ?? "";
  if (options.reseedView) {
    options.viewPhaseRef.current = result.phase;
    options.setViewPhase(result.phase);
    options.lastFetchedLogRef.current = fetchedLog;
    options.setLogText(fetchedLog);
    return;
  }
  if (options.preserveSseTail) {
    options.setLogText((current) => {
      const sseSuffix = current.slice(options.lastFetchedLogRef.current.length);
      options.lastFetchedLogRef.current = fetchedLog;
      return fetchedLog + sseSuffix;
    });
    return;
  }
  options.lastFetchedLogRef.current = fetchedLog;
  options.setLogText(fetchedLog);
}

export function LogPanel({
  project,
  activePhase,
  logIssueFallback = null,
  registerPhaseLogHandler,
  registerRefreshHandler,
  onRefresh,
  refreshing = false,
  refreshError = null,
}: LogPanelProps) {
  const [logText, setLogText] = useState("");
  const [phases, setPhases] = useState<string[]>([]);
  const [viewPhase, setViewPhase] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const livePhaseRef = useRef<string | null>(null);
  const viewPhaseRef = useRef<string | null>(null);
  const lastFetchedLogRef = useRef("");
  const expandedBodyRef = useRef<HTMLPreElement>(null);
  const previewBodyRef = useRef<HTMLPreElement>(null);
  const phaseFetchGenerationRef = useRef(0);
  const logLoadGenerationRef = useRef(0);
  const previousActivePhaseRef = useRef<string | null>(null);
  const [hasActiveLog, setHasActiveLog] = useState(false);

  const isViewingLivePhase = useCallback(() => {
    return (
      viewPhaseRef.current !== null &&
      livePhaseRef.current !== null &&
      viewPhaseRef.current === livePhaseRef.current
    );
  }, []);

  const loadProjectLog = useCallback(
    async (options: { phase?: string; reseedView: boolean; preserveSseTail?: boolean }) => {
      if (!project) {
        return null;
      }
      const generation = ++logLoadGenerationRef.current;
      try {
        let result = await fetchProjectLog(project.id, { phase: options.phase });
        if (
          !result &&
          logIssueFallback !== null &&
          logIssueFallback !== undefined &&
          options.phase
        ) {
          result = await fetchProjectLog(project.id, {
            phase: options.phase,
            issue: logIssueFallback,
          });
        }
        if (generation !== logLoadGenerationRef.current) {
          return null;
        }
        if (!result) {
          setHasActiveLog(false);
          setLogText("");
          setPhases([]);
          setViewPhase(null);
          livePhaseRef.current = null;
          viewPhaseRef.current = null;
          lastFetchedLogRef.current = "";
          return null;
        }
        setHasActiveLog(true);
        applyProjectLog(result, {
          livePhaseRef,
          viewPhaseRef,
          reseedView: options.reseedView,
          preserveSseTail: options.preserveSseTail ?? false,
          lastFetchedLogRef,
          setPhases,
          setViewPhase,
          setLogText,
        });
        return result;
      } catch {
        return null;
      }
    },
    [logIssueFallback, project],
  );

  const refreshLog = useCallback(async () => {
    if (!project) {
      return;
    }
    const generation = ++logLoadGenerationRef.current;
    const phase = isViewingLivePhase() ? undefined : viewPhaseRef.current ?? undefined;
    let result = await fetchProjectLog(project.id, { phase });
    if (!result && logIssueFallback !== null && logIssueFallback !== undefined && phase) {
      result = await fetchProjectLog(project.id, { phase, issue: logIssueFallback });
    }
    if (generation !== logLoadGenerationRef.current) {
      return;
    }
    if (!result) {
      throw new Error("Log not found");
    }
    setHasActiveLog(true);
    applyProjectLog(result, {
      livePhaseRef,
      viewPhaseRef,
      reseedView: false,
      preserveSseTail: isViewingLivePhase(),
      lastFetchedLogRef,
      setPhases,
      setViewPhase,
      setLogText,
    });
  }, [isViewingLivePhase, logIssueFallback, project]);

  useEffect(() => {
    viewPhaseRef.current = viewPhase;
  }, [viewPhase]);

  useEffect(() => {
    if (!registerRefreshHandler) {
      return;
    }
    registerRefreshHandler(refreshLog);
    return () => {
      registerRefreshHandler(null);
    };
  }, [refreshLog, registerRefreshHandler]);

  useEffect(() => {
    if (!project) {
      setLogText("");
      setPhases([]);
      setViewPhase(null);
      setHasActiveLog(false);
      setExpanded(false);
      livePhaseRef.current = null;
      viewPhaseRef.current = null;
      lastFetchedLogRef.current = "";
      return;
    }

    setExpanded(false);
    previousActivePhaseRef.current = activePhase;
    void loadProjectLog({ reseedView: true });
  }, [activePhase, project?.id, loadProjectLog]);

  useEffect(() => {
    if (!project || !activePhase) {
      return;
    }

    const previousPhase = previousActivePhaseRef.current;
    previousActivePhaseRef.current = activePhase;
    if (previousPhase === null || previousPhase === activePhase) {
      return;
    }

    void loadProjectLog({ reseedView: isViewingLivePhase() });
  }, [activePhase, isViewingLivePhase, loadProjectLog, project]);

  useEffect(() => {
    if (!registerPhaseLogHandler || !project) {
      return;
    }

    const onChunk = (chunk: string) => {
      if (!isViewingLivePhase() || !chunk) {
        return;
      }
      setLogText((current) => appendLogChunk(current, chunk));
    };

    registerPhaseLogHandler(onChunk);
    return () => {
      registerPhaseLogHandler(null);
    };
  }, [isViewingLivePhase, project?.id, registerPhaseLogHandler]);

  useLayoutEffect(() => {
    const body = expanded ? expandedBodyRef.current : previewBodyRef.current;
    if (!body) {
      return;
    }
    scrollLogBodyToTail(body);
  }, [expanded, logText]);

  const handlePhaseChange = (phase: string) => {
    if (!project) {
      return;
    }
    const generation = ++phaseFetchGenerationRef.current;
    setViewPhase(phase);
    viewPhaseRef.current = phase;
    void (async () => {
      try {
        let result = await fetchProjectLog(project.id, { phase });
        if (!result && logIssueFallback !== null && logIssueFallback !== undefined) {
          result = await fetchProjectLog(project.id, { phase, issue: logIssueFallback });
        }
        if (generation !== phaseFetchGenerationRef.current || !result) {
          return;
        }
        const fetchedLog = result.log ?? "";
        lastFetchedLogRef.current = fetchedLog;
        setLogText(fetchedLog);
      } catch {
        // Keep the previous log visible when a phase fetch fails.
      }
    })();
  };

  const handleRefreshClick = () => {
    onRefresh?.();
  };

  if (!project) {
    return (
      <div className="panel-placeholder">
        <PanelHeader title="Log" onRefresh={onRefresh} refreshDisabled refreshing={refreshing} />
        <p>Select a project to view the agent log.</p>
      </div>
    );
  }

  const previewText = lastLines(logText, PREVIEW_LINE_COUNT);

  if (!hasActiveLog) {
    return (
      <div className="log-panel">
        <PanelHeader
          title="Log"
          onRefresh={handleRefreshClick}
          refreshing={refreshing}
          error={refreshError}
        />
        <p className="log-idle">No active slice — log will appear when an issue is running.</p>
      </div>
    );
  }

  return (
    <div className="log-panel">
      <PanelHeader
        title="Log"
        onRefresh={handleRefreshClick}
        refreshing={refreshing}
        error={refreshError}
        actions={
          <button type="button" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Collapse" : "Expand"}
          </button>
        }
      />
      {expanded ? (
        <>
          {phases.length > 0 ? (
            <label className="log-phase-label">
              Phase
              <select
                aria-label="Phase"
                className="log-phase-select"
                value={viewPhase ?? ""}
                onChange={(event) => handlePhaseChange(event.target.value)}
              >
                {phases.map((phase) => (
                  <option key={phase} value={phase}>
                    {phase}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <pre
            ref={expandedBodyRef}
            className="log-body log-body--expanded"
            data-testid="log-expanded"
          >
            {logText}
          </pre>
        </>
      ) : (
        <pre
          ref={previewBodyRef}
          className="log-body log-body--preview"
          data-testid="log-preview">
          {previewText}
        </pre>
      )}
    </div>
  );
}

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
import type { Project } from "./types.js";

const PREVIEW_LINE_COUNT = 5;

export type PhaseLogHandler = ((chunk: string) => void) | null;

export type LogPanelProps = {
  project: Project | null;
  activePhase: string | null;
  /** When `active.json` is cleared mid-run, load logs by issue + phase. */
  logIssueFallback?: number | null;
  registerPhaseLogHandler?: (handler: PhaseLogHandler) => void;
};

function applyProjectLog(
  result: NonNullable<Awaited<ReturnType<typeof fetchProjectLog>>>,
  options: {
    livePhaseRef: MutableRefObject<string | null>;
    viewPhaseRef: MutableRefObject<string | null>;
    reseedView: boolean;
    setPhases: (phases: string[]) => void;
    setViewPhase: (phase: string) => void;
    setLogText: (log: string) => void;
  },
): void {
  options.livePhaseRef.current = result.phase;
  options.setPhases(result.phases);
  if (options.reseedView) {
    options.viewPhaseRef.current = result.phase;
    options.setViewPhase(result.phase);
    options.setLogText(result.log ?? "");
  }
}

export function LogPanel({
  project,
  activePhase,
  logIssueFallback = null,
  registerPhaseLogHandler,
}: LogPanelProps) {
  const [logText, setLogText] = useState("");
  const [phases, setPhases] = useState<string[]>([]);
  const [viewPhase, setViewPhase] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const livePhaseRef = useRef<string | null>(null);
  const viewPhaseRef = useRef<string | null>(null);
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
    async (options: { phase?: string; reseedView: boolean }) => {
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
          return null;
        }
        setHasActiveLog(true);
        applyProjectLog(result, {
          livePhaseRef,
          viewPhaseRef,
          reseedView: options.reseedView,
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

  useEffect(() => {
    viewPhaseRef.current = viewPhase;
  }, [viewPhase]);

  useEffect(() => {
    if (!project) {
      setLogText("");
      setPhases([]);
      setViewPhase(null);
      setHasActiveLog(false);
      setExpanded(false);
      livePhaseRef.current = null;
      viewPhaseRef.current = null;
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
        setLogText(result.log ?? "");
      } catch {
        // Keep the previous log visible when a phase fetch fails.
      }
    })();
  };

  if (!project) {
    return (
      <div className="panel-placeholder">
        <h2>Log</h2>
        <p>Select a project to view the agent log.</p>
      </div>
    );
  }

  const previewText = lastLines(logText, PREVIEW_LINE_COUNT);

  if (!hasActiveLog) {
    return (
      <div className="log-panel">
        <h2>Log</h2>
        <p className="log-idle">No active slice — log will appear when an issue is running.</p>
      </div>
    );
  }

  return (
    <div className="log-panel">
      <div className="log-panel-header">
        <h2>Log</h2>
        <button type="button" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>
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

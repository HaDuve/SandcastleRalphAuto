import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { fetchProjectLog, subscribeProjectEvents } from "./api.js";
import { appendLogChunk, lastLines } from "./logLines.js";
import type { Project } from "./types.js";

const PREVIEW_LINE_COUNT = 5;

type LogPanelProps = {
  project: Project | null;
};

export function LogPanel({ project }: LogPanelProps) {
  const [logText, setLogText] = useState("");
  const [phases, setPhases] = useState<string[]>([]);
  const [viewPhase, setViewPhase] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const livePhaseRef = useRef<string | null>(null);
  const viewPhaseRef = useRef<string | null>(null);
  const expandedBodyRef = useRef<HTMLPreElement>(null);
  const [hasActiveLog, setHasActiveLog] = useState(false);

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

    let cancelled = false;
    void (async () => {
      const result = await fetchProjectLog(project.id);
      if (cancelled) {
        return;
      }
      if (!result) {
        setLogText("");
        setPhases([]);
        setViewPhase(null);
        setHasActiveLog(false);
        livePhaseRef.current = null;
        viewPhaseRef.current = null;
        return;
      }
      setHasActiveLog(true);
      livePhaseRef.current = result.phase;
      viewPhaseRef.current = result.phase;
      setPhases(result.phases);
      setViewPhase(result.phase);
      setLogText(result.log ?? "");
    })();

    const unsubscribe = subscribeProjectEvents(project.id, (event) => {
      if (event.type !== "phase-log") {
        return;
      }
      if (viewPhaseRef.current !== livePhaseRef.current || !event.chunk) {
        return;
      }
      setLogText((current) => appendLogChunk(current, event.chunk!));
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [project?.id]);

  useEffect(() => {
    viewPhaseRef.current = viewPhase;
  }, [viewPhase]);

  useLayoutEffect(() => {
    if (!expanded) {
      return;
    }
    const body = expandedBodyRef.current;
    if (!body) {
      return;
    }
    body.scrollTop = body.scrollHeight;
  }, [expanded, logText]);

  const handlePhaseChange = (phase: string) => {
    if (!project) {
      return;
    }
    setViewPhase(phase);
    viewPhaseRef.current = phase;
    void (async () => {
      const result = await fetchProjectLog(project.id, phase);
      if (!result) {
        return;
      }
      setLogText(result.log ?? "");
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
        <pre className="log-body log-body--preview" data-testid="log-preview">
          {previewText}
        </pre>
      )}
    </div>
  );
}

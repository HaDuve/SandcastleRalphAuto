import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { fetchProjectLog } from "./api.js";
import {
  appendLogChunk,
  appendServerLogChunkInAllView,
  lastLines,
  LOG_SERVER_SECTION_HEADER,
  scrollLogBodyToTail,
} from "./logLines.js";
import { PanelHeader } from "./PanelHeader.js";
import type { Project } from "./types.js";

const PREVIEW_LINE_COUNT = 5;

export type PhaseLogHandler = ((chunk: string) => void) | null;
export type ServerLogHandler = ((chunk: string) => void) | null;
export type LogRefreshHandler = (() => Promise<void>) | null;

type LogChannel = "all" | "server" | string;

export type LogPanelProps = {
  project: Project | null;
  activePhase: string | null;
  /** When `active.json` is cleared mid-run, load logs by issue + phase. */
  logIssueFallback?: number | null;
  registerPhaseLogHandler?: (handler: PhaseLogHandler) => void;
  registerServerLogHandler?: (handler: ServerLogHandler) => void;
  registerRefreshHandler?: (handler: LogRefreshHandler) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  refreshError?: string | null;
};

function combineAllLogs(options: { serverLog: string; phases: string[]; phaseLogs: string[] }): string {
  const blocks: string[] = [];
  blocks.push(LOG_SERVER_SECTION_HEADER);
  blocks.push(options.serverLog);
  if (!options.serverLog.endsWith("\n")) {
    blocks.push("\n");
  }
  for (const [index, phase] of options.phases.entries()) {
    const log = options.phaseLogs[index] ?? "";
    blocks.push(`\n=== ${phase} ===\n`);
    blocks.push(log);
    if (log && !log.endsWith("\n")) {
      blocks.push("\n");
    }
  }
  return blocks.join("");
}

export function LogPanel({
  project,
  activePhase,
  logIssueFallback = null,
  registerPhaseLogHandler,
  registerServerLogHandler,
  registerRefreshHandler,
  onRefresh,
  refreshing = false,
  refreshError = null,
}: LogPanelProps) {
  const [logText, setLogText] = useState("");
  const [phases, setPhases] = useState<string[]>([]);
  const [channel, setChannel] = useState<LogChannel>("all");
  const [expanded, setExpanded] = useState(false);
  const livePhaseRef = useRef<string | null>(null);
  const channelRef = useRef<LogChannel>("all");
  const lastFetchedLogRef = useRef("");
  const serverSseTailRef = useRef("");
  const expandedBodyRef = useRef<HTMLPreElement>(null);
  const previewBodyRef = useRef<HTMLPreElement>(null);
  const phaseFetchGenerationRef = useRef(0);
  const logLoadGenerationRef = useRef(0);
  const previousActivePhaseRef = useRef<string | null>(null);
  const [hasActiveLog, setHasActiveLog] = useState(false);

  const isViewingLivePhaseLogStream = useCallback(() => {
    if (!livePhaseRef.current) {
      return false;
    }
    const selected = channelRef.current;
    return selected === "all" || selected === livePhaseRef.current;
  }, []);

  const fetchLogWithFallback = useCallback(
    async (options: { projectId: string; phase?: string }) => {
      let result = await fetchProjectLog(options.projectId, { phase: options.phase });
      if (
        !result &&
        logIssueFallback !== null &&
        logIssueFallback !== undefined &&
        options.phase
      ) {
        result = await fetchProjectLog(options.projectId, {
          phase: options.phase,
          issue: logIssueFallback,
        });
      }
      return result;
    },
    [logIssueFallback],
  );

  const loadChannelLog = useCallback(
    async (options: { selectedChannel: LogChannel; reseedView: boolean; preserveSseTail?: boolean }) => {
      if (!project) {
        return null;
      }
      const generation = ++logLoadGenerationRef.current;
      try {
        const meta = await fetchProjectLog(project.id);
        if (generation !== logLoadGenerationRef.current) {
          return null;
        }
        if (!meta) {
          setHasActiveLog(false);
          setLogText("");
          setPhases([]);
          setChannel("all");
          channelRef.current = "all";
          livePhaseRef.current = null;
          lastFetchedLogRef.current = "";
          serverSseTailRef.current = "";
          return null;
        }
        setHasActiveLog(true);
        livePhaseRef.current = meta.phase;
        setPhases(meta.phases);

        const selectedChannel = options.reseedView ? "all" : options.selectedChannel;
        if (options.reseedView) {
          setChannel("all");
          channelRef.current = "all";
        }

        let fetchedLog = "";
        if (selectedChannel === "all") {
          const server = await fetchLogWithFallback({ projectId: project.id, phase: "server" });
          const phaseResults = await Promise.all(
            meta.phases.map((phase) => fetchLogWithFallback({ projectId: project.id, phase })),
          );
          const phaseLogs = phaseResults.map((result) => result?.log ?? "");
          const serverBase = server?.log ?? "";
          const serverLog =
            options.preserveSseTail && serverSseTailRef.current
              ? serverBase + serverSseTailRef.current
              : serverBase;
          fetchedLog = combineAllLogs({
            serverLog,
            phases: meta.phases,
            phaseLogs,
          });
        } else if (selectedChannel === "server") {
          const server = await fetchLogWithFallback({ projectId: project.id, phase: "server" });
          fetchedLog = server?.log ?? "";
        } else {
          const result = await fetchLogWithFallback({ projectId: project.id, phase: selectedChannel });
          fetchedLog = result?.log ?? "";
        }

        if (generation !== logLoadGenerationRef.current) {
          return null;
        }

        if (options.preserveSseTail) {
          setLogText((current) => {
            const sseSuffix = current.slice(lastFetchedLogRef.current.length);
            lastFetchedLogRef.current = fetchedLog;
            return fetchedLog + sseSuffix;
          });
          return meta;
        }

        lastFetchedLogRef.current = fetchedLog;
        serverSseTailRef.current = "";
        setLogText(fetchedLog);
        return meta;
      } catch {
        return null;
      }
    },
    [fetchLogWithFallback, project],
  );

  const refreshLog = useCallback(async () => {
    if (!project) {
      return;
    }
    const generation = ++logLoadGenerationRef.current;
    const selected = channelRef.current;
    const preserveSseTail =
      selected === "server" || selected === "all" ? true : isViewingLivePhaseLogStream();
    const meta = await loadChannelLog({
      selectedChannel: selected,
      reseedView: false,
      preserveSseTail,
    });
    if (generation !== logLoadGenerationRef.current) {
      return;
    }
    if (!meta) {
      throw new Error("Log not found");
    }
  }, [isViewingLivePhaseLogStream, loadChannelLog, project]);

  useEffect(() => {
    channelRef.current = channel;
  }, [channel]);

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
      setChannel("all");
      setHasActiveLog(false);
      setExpanded(false);
      livePhaseRef.current = null;
      channelRef.current = "all";
      lastFetchedLogRef.current = "";
      serverSseTailRef.current = "";
      return;
    }

    setExpanded(false);
    previousActivePhaseRef.current = activePhase;
    void loadChannelLog({ selectedChannel: "all", reseedView: true });
  }, [activePhase, project?.id, loadChannelLog]);

  useEffect(() => {
    if (!project || !activePhase) {
      return;
    }

    const previousPhase = previousActivePhaseRef.current;
    previousActivePhaseRef.current = activePhase;
    if (previousPhase === null || previousPhase === activePhase) {
      return;
    }

    void loadChannelLog({ selectedChannel: channelRef.current, reseedView: false });
  }, [activePhase, loadChannelLog, project]);

  useEffect(() => {
    if (!registerPhaseLogHandler || !project) {
      return;
    }

    const onChunk = (chunk: string) => {
      if (!isViewingLivePhaseLogStream() || !chunk) {
        return;
      }
      setLogText((current) => appendLogChunk(current, chunk));
    };

    registerPhaseLogHandler(onChunk);
    return () => {
      registerPhaseLogHandler(null);
    };
  }, [isViewingLivePhaseLogStream, project?.id, registerPhaseLogHandler]);

  useEffect(() => {
    if (!registerServerLogHandler || !project) {
      return;
    }

    const onChunk = (chunk: string) => {
      const selected = channelRef.current;
      if ((selected !== "server" && selected !== "all") || !chunk) {
        return;
      }
      serverSseTailRef.current += chunk;
      setLogText((current) =>
        selected === "all"
          ? appendServerLogChunkInAllView(current, chunk)
          : appendLogChunk(current, chunk),
      );
    };

    registerServerLogHandler(onChunk);
    return () => {
      registerServerLogHandler(null);
    };
  }, [project?.id, registerServerLogHandler]);

  useLayoutEffect(() => {
    const body = expanded ? expandedBodyRef.current : previewBodyRef.current;
    if (!body) {
      return;
    }
    scrollLogBodyToTail(body);
  }, [expanded, logText]);

  const handleChannelChange = (nextChannel: LogChannel) => {
    if (!project) {
      return;
    }
    const generation = ++phaseFetchGenerationRef.current;
    setChannel(nextChannel);
    channelRef.current = nextChannel;
    void (async () => {
      try {
        const meta = await fetchProjectLog(project.id);
        if (generation !== phaseFetchGenerationRef.current || !meta) {
          return;
        }
        livePhaseRef.current = meta.phase;
        setPhases(meta.phases);

        let fetchedLog = "";
        if (nextChannel === "all") {
          const server = await fetchLogWithFallback({ projectId: project.id, phase: "server" });
          const phaseResults = await Promise.all(
            meta.phases.map((phase) => fetchLogWithFallback({ projectId: project.id, phase })),
          );
          const phaseLogs = phaseResults.map((result) => result?.log ?? "");
          fetchedLog = combineAllLogs({
            serverLog: server?.log ?? "",
            phases: meta.phases,
            phaseLogs,
          });
        } else if (nextChannel === "server") {
          const server = await fetchLogWithFallback({ projectId: project.id, phase: "server" });
          fetchedLog = server?.log ?? "";
        } else {
          const result = await fetchLogWithFallback({ projectId: project.id, phase: nextChannel });
          fetchedLog = result?.log ?? "";
        }

        if (generation !== phaseFetchGenerationRef.current) {
          return;
        }
        lastFetchedLogRef.current = fetchedLog;
        serverSseTailRef.current = "";
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
      {phases.length > 0 ? (
        <label className="log-phase-label">
          Log channel
          <select
            aria-label="Log channel"
            className="log-phase-select"
            value={channel}
            onChange={(event) => handleChannelChange(event.target.value)}
          >
            <option value="all">All</option>
            <option value="server">Server</option>
            {phases.map((phase) => (
              <option key={phase} value={phase}>
                {phase}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {expanded ? (
        <>
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

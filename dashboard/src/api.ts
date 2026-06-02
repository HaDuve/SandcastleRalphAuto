import type { ActiveSlice, HistoryEntry, Project, QueueIssue, RunOutcome } from "./types.js";
import type { WorkerStatus } from "./workerStatus.js";

type ControlStatusBody = { status?: string; error?: string };

export const NOT_RUNNING_ERROR = "Project worker is not running";

export type ProjectEvent = {
  type: string;
  projectId?: string;
  workerStatus?: WorkerStatus;
  lastRunOutcome?: RunOutcome;
  chunk?: string;
  phase?: string;
  issue?: number;
};

const PROJECT_EVENT_TYPES = [
  "connected",
  "worker-started",
  "worker-stopped",
  "worker-paused",
  "worker-resumed",
  "phase-log",
  "server-log",
  "stream",
] as const;

function controlErrorMessage(body: ControlStatusBody, status: number): string {
  if (body.error) {
    return body.error;
  }
  if (body.status === "already-running") {
    return "Project worker is already running";
  }
  if (body.status === "not-running") {
    return NOT_RUNNING_ERROR;
  }
  return `Request failed (${status})`;
}

async function parseJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & ControlStatusBody;
  if (!response.ok) {
    throw new Error(controlErrorMessage(body, response.status));
  }
  return body as T;
}

export async function fetchProjects(): Promise<Project[]> {
  const response = await fetch("/api/projects");
  const body = await parseJson<{ projects: Project[] }>(response);
  return body.projects;
}

export async function startProject(
  projectId: string,
): Promise<{ status: "started" } | { status: "already-running" }> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/start`, {
    method: "POST",
  });
  return parseJson(response);
}

export async function pauseProject(
  projectId: string,
): Promise<{ status: "paused" } | { status: "not-running" }> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/pause`, {
    method: "POST",
  });
  return parseJson(response);
}

export async function resumeProject(
  projectId: string,
): Promise<{ status: "resumed" } | { status: "not-running" }> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/resume`, {
    method: "POST",
  });
  return parseJson(response);
}

export async function killProject(
  projectId: string,
): Promise<{ status: "killed" } | { status: "not-running" }> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/kill`, {
    method: "POST",
  });
  return parseJson(response);
}

export async function fetchQueue(projectId: string): Promise<QueueIssue[]> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/queue`);
  const body = await parseJson<{ queue: QueueIssue[] }>(response);
  return body.queue;
}

export async function fetchActive(projectId: string): Promise<ActiveSlice | null> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/active`);
  const body = await parseJson<{
    active: ActiveSlice | null;
    debug?: ActiveSlice["debug"];
  }>(response);
  if (!body.active) {
    return null;
  }
  return { ...body.active, debug: body.debug };
}

export async function fetchHistory(projectId: string): Promise<HistoryEntry[]> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/history`);
  const body = await parseJson<{ history: HistoryEntry[] }>(response);
  return body.history;
}

export type ProjectLog = {
  issue: number;
  phase: string;
  log: string | null;
  phases: string[];
};

export async function fetchProjectLog(
  projectId: string,
  options?: { phase?: string; issue?: number },
): Promise<ProjectLog | null> {
  const params = new URLSearchParams();
  if (options?.phase) {
    params.set("phase", options.phase);
  }
  if (options?.issue !== undefined) {
    params.set("issue", String(options.issue));
  }
  const query = params.toString();
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/log${query ? `?${query}` : ""}`,
  );
  if (response.status === 404) {
    return null;
  }
  return parseJson(response);
}

export async function setIssueSkip(
  projectId: string,
  issue: number,
  skipped: boolean,
): Promise<{ status: "skipped" | "unskipped"; issue: number }> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/skip`, {
    method: skipped ? "POST" : "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ issue }),
  });
  return parseJson(response);
}

export function subscribeProjectEvents(
  projectId: string,
  onEvent: (event: ProjectEvent) => void,
): () => void {
  const source = new EventSource(`/api/projects/${encodeURIComponent(projectId)}/events`);
  const handler = (event: Event) => {
    const message = event as MessageEvent;
    try {
      onEvent(JSON.parse(message.data) as ProjectEvent);
    } catch {
      // Ignore malformed SSE payloads.
    }
  };

  for (const type of PROJECT_EVENT_TYPES) {
    source.addEventListener(type, handler);
  }

  return () => {
    for (const type of PROJECT_EVENT_TYPES) {
      source.removeEventListener(type, handler);
    }
    source.close();
  };
}

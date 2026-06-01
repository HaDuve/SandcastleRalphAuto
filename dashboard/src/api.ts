import type { ActiveSlice, Project, QueueIssue } from "./types.js";

type ControlStatusBody = { status?: string; error?: string };

function controlErrorMessage(body: ControlStatusBody, status: number): string {
  if (body.error) {
    return body.error;
  }
  if (body.status === "already-running") {
    return "Project worker is already running";
  }
  if (body.status === "not-running") {
    return "Project worker is not running";
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

export async function fetchQueue(projectId: string): Promise<QueueIssue[]> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/queue`);
  const body = await parseJson<{ queue: QueueIssue[] }>(response);
  return body.queue;
}

export async function fetchActive(projectId: string): Promise<ActiveSlice | null> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/active`);
  const body = await parseJson<{ active: ActiveSlice | null }>(response);
  return body.active;
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

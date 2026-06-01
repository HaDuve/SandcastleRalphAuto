import type { Project } from "./types.js";

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

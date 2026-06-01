import type { Project } from "./types.js";

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
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

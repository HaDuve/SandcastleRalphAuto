import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchProjects, pauseProject, startProject } from "../../dashboard/src/api.js";

describe("dashboard API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches registered projects from the local API", async () => {
    const projects = [
      {
        id: "portfolio",
        path: "/tmp/portfolio",
        remote: "HaDuve/Portfolio",
        defaultBase: "main",
        afkLabel: "ready-for-agent",
        blockedLabels: [],
        autoMerge: true,
        concurrency: "single" as const,
        sandbox: "none" as const,
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe("/api/projects");
        return new Response(JSON.stringify({ projects }), { status: 200 });
      }),
    );

    await expect(fetchProjects()).resolves.toEqual(projects);
  });

  it("starts a project worker via POST", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toBe("/api/projects/portfolio/start");
        expect(init?.method).toBe("POST");
        return new Response(JSON.stringify({ status: "started" }), { status: 202 });
      }),
    );

    await expect(startProject("portfolio")).resolves.toEqual({ status: "started" });
  });

  it("reports a clear error when start returns already-running", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ status: "already-running" }), { status: 409 });
      }),
    );

    await expect(startProject("portfolio")).rejects.toThrow(/already running/i);
  });

  it("pauses a project worker via POST", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toBe("/api/projects/portfolio/pause");
        expect(init?.method).toBe("POST");
        return new Response(JSON.stringify({ status: "paused" }), { status: 200 });
      }),
    );

    await expect(pauseProject("portfolio")).resolves.toEqual({ status: "paused" });
  });
});

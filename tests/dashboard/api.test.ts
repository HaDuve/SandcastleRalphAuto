import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchActive,
  fetchProjects,
  fetchQueue,
  pauseProject,
  setIssueSkip,
  startProject,
} from "../../dashboard/src/api.js";

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

  it("fetches queue issues for a project", async () => {
    const queue = [
      { number: 10, labels: ["ready-for-agent"], skipped: false, eligible: true },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe("/api/projects/portfolio/queue");
        return new Response(JSON.stringify({ queue }), { status: 200 });
      }),
    );

    await expect(fetchQueue("portfolio")).resolves.toEqual(queue);
  });

  it("fetches active slice state for a project", async () => {
    const active = {
      issue: 11,
      phase: "tdd",
      branch: "issue-11",
      status: "active" as const,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe("/api/projects/portfolio/active");
        return new Response(JSON.stringify({ active }), { status: 200 });
      }),
    );

    await expect(fetchActive("portfolio")).resolves.toEqual(active);
  });

  it("sets skip state for an issue via POST or DELETE", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/projects/portfolio/skip" && init?.method === "POST") {
        return new Response(JSON.stringify({ status: "skipped", issue: 15 }), {
          status: 200,
        });
      }
      if (url === "/api/projects/portfolio/skip" && init?.method === "DELETE") {
        return new Response(JSON.stringify({ status: "unskipped", issue: 15 }), {
          status: 200,
        });
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(setIssueSkip("portfolio", 15, true)).resolves.toEqual({
      status: "skipped",
      issue: 15,
    });
    await expect(setIssueSkip("portfolio", 15, false)).resolves.toEqual({
      status: "unskipped",
      issue: 15,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

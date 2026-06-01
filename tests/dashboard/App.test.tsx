import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../dashboard/src/App.js";

const portfolio = {
  id: "portfolio",
  path: "/tmp/portfolio",
  remote: "HaDuve/Portfolio",
  defaultBase: "main",
  afkLabel: "ready-for-agent",
  blockedLabels: ["needs-info"] as string[],
  autoMerge: true,
  concurrency: "single" as const,
  sandbox: "none" as const,
};

const other = {
  ...portfolio,
  id: "other",
  path: "/tmp/other",
  remote: "HaDuve/Other",
};

function stubProjectsFetch(projects: typeof portfolio[]) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/projects") {
      return new Response(JSON.stringify({ projects }), { status: 200 });
    }
    if (url.endsWith("/queue")) {
      return new Response(
        JSON.stringify({
          queue: [
            { number: 10, labels: ["ready-for-agent"], skipped: false, eligible: true },
            {
              number: 12,
              labels: ["ready-for-agent", "needs-info"],
              skipped: false,
              eligible: false,
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.endsWith("/active")) {
      return new Response(
        JSON.stringify({
          active: {
            issue: 11,
            phase: "tdd",
            branch: "issue-11",
            status: "active",
            startedAt: "2026-06-01T12:00:00.000Z",
          },
        }),
        { status: 200 },
      );
    }
    if (url.endsWith("/start") && init?.method === "POST") {
      return new Response(JSON.stringify({ status: "started" }), { status: 202 });
    }
    if (url.endsWith("/pause") && init?.method === "POST") {
      return new Response(JSON.stringify({ status: "paused" }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  });
}

describe("App", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads projects from the local API and renders the dashboard shell", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/projects") {
          return new Response(JSON.stringify({ projects: [portfolio] }), { status: 200 });
        }
        if (url === "/api/projects/portfolio/start" && init?.method === "POST") {
          return new Response(JSON.stringify({ status: "started" }), { status: 202 });
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    render(<App />);

    expect(await screen.findByRole("checkbox", { name: /portfolio/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /queue/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /active/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /stream/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /history/i })).toBeInTheDocument();
  });

  it("starts a checked project through the API", async () => {
    const fetchMock = stubProjectsFetch([portfolio]);
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);

    const checkbox = await screen.findByRole("checkbox", { name: /portfolio/i });
    await user.click(checkbox);
    await user.click(screen.getByRole("button", { name: /start portfolio/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/portfolio/start",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("pauses a checked project through the API", async () => {
    const fetchMock = stubProjectsFetch([portfolio]);
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("checkbox", { name: /portfolio/i }));
    await user.click(screen.getByRole("button", { name: /pause portfolio/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/portfolio/pause",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("loads queue and active panels for the focused project", async () => {
    vi.stubGlobal("fetch", stubProjectsFetch([portfolio]));

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("checkbox", { name: /portfolio/i }));

    expect(await screen.findByText(/#10/)).toBeInTheDocument();
    expect(screen.getByText(/Blocked: needs-info/i)).toBeInTheDocument();
    expect(screen.getByText(/#11/)).toBeInTheDocument();
    expect(screen.getByText(/issue-11/i)).toBeInTheDocument();
  });
});

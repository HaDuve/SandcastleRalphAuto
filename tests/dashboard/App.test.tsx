import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../dashboard/src/App.js";
import { HIDDEN_IDS_STORAGE_KEY } from "../../dashboard/src/hiddenProjects.js";
import {
  FOCUSED_PROJECT_ID_STORAGE_KEY,
  SELECTED_IDS_STORAGE_KEY,
} from "../../dashboard/src/selectedProjects.js";
import { installStoppableEventSource } from "./stoppableEventSource.js";

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
    if (url.endsWith("/log")) {
      return new Response(
        JSON.stringify({
          issue: 11,
          phase: "tdd",
          log: "agent log line\n",
          phases: ["tdd"],
        }),
        { status: 200 },
      );
    }
    if (url.endsWith("/history")) {
      return new Response(
        JSON.stringify({
          history: [
            {
              pr: 99,
              issue: 9,
              branch: "issue-9",
              startedAt: "2026-06-01T00:00:00.000Z",
              endedAt: "2026-06-01T01:00:00.000Z",
              phases: [
                {
                  phase: "merge",
                  startedAt: "2026-06-01T00:00:00.000Z",
                  endedAt: "2026-06-01T01:00:00.000Z",
                },
              ],
            },
          ],
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
    if (url.endsWith("/resume") && init?.method === "POST") {
      return new Response(JSON.stringify({ status: "resumed" }), { status: 200 });
    }
    if (url.endsWith("/kill") && init?.method === "POST") {
      return new Response(JSON.stringify({ status: "killed" }), { status: 200 });
    }
    if (url === "/api/projects/portfolio/skip" && init?.method === "POST") {
      return new Response(JSON.stringify({ status: "skipped", issue: 10 }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  });
}

describe("App", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("renders every project in the sidebar when many are configured", async () => {
    const manyProjects = Array.from({ length: 13 }, (_, index) => ({
      ...portfolio,
      id: `project-${index}`,
      path: `/tmp/project-${index}`,
      remote: `HaDuve/Project${index}`,
    }));
    vi.stubGlobal("fetch", stubProjectsFetch(manyProjects));

    render(<App />);

    const sidebar = await screen.findByRole("region", { name: /projects/i });
    const checkboxes = within(sidebar).getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(13);
    for (const project of manyProjects) {
      expect(within(sidebar).getByRole("link", { name: project.id })).toBeInTheDocument();
    }
  });

  it("renders the fleet summary line in the header", async () => {
    const idleOne = {
      ...portfolio,
      id: "idle-one",
      path: "/tmp/idle-one",
      remote: "HaDuve/IdleOne",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/projects") {
          return new Response(
            JSON.stringify({
              projects: [
                {
                  ...portfolio,
                  workerStatus: "running",
                  active: { issue: 11, phase: "tdd", status: "active" },
                },
                { ...other, workerStatus: "paused" },
                idleOne,
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    render(<App />);

    const fleet = await screen.findByLabelText(/fleet summary/i);
    expect(fleet).toHaveTextContent("1 running · 1 paused · 0 blocked · 1 idle");
    expect(fleet.closest(".app-header-status")).toBeTruthy();
  });

  it("appends hidden count to the fleet line when projects are hidden", async () => {
    localStorage.setItem(HIDDEN_IDS_STORAGE_KEY, JSON.stringify(["portfolio"]));
    vi.stubGlobal("fetch", stubProjectsFetch([portfolio, other]));

    render(<App />);

    const fleet = await screen.findByLabelText(/fleet summary/i);
    expect(fleet).toHaveTextContent(/· 1 hidden$/);
  });

  it("renders load errors under the fleet summary in the status column", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/projects") {
          return new Response(JSON.stringify({ error: "catalog down" }), { status: 500 });
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    render(<App />);

    const fleet = await screen.findByLabelText(/fleet summary/i);
    const statusColumn = fleet.closest(".app-header-status");
    expect(statusColumn).toBeTruthy();
    const alert = await within(statusColumn as HTMLElement).findByRole("alert");
    expect(alert).toHaveTextContent(/catalog down|failed to load projects/i);
  });

  it("shows No project selected in the focused header when nothing is focused", async () => {
    vi.stubGlobal("fetch", stubProjectsFetch([portfolio, other]));

    render(<App />);

    const focused = await screen.findByLabelText(/focused project/i);
    expect(focused).toHaveTextContent("No project selected");
  });

  it("shows Connecting in the focused header when the worker state is unknown", async () => {
    installStoppableEventSource();
    localStorage.setItem(SELECTED_IDS_STORAGE_KEY, JSON.stringify(["portfolio"]));
    localStorage.setItem(FOCUSED_PROJECT_ID_STORAGE_KEY, JSON.stringify("portfolio"));
    vi.stubGlobal("fetch", stubProjectsFetch([portfolio]));

    render(<App />);

    const focused = await screen.findByLabelText(/focused project/i);
    expect(focused).toHaveTextContent("Connecting…");
  });

  it("renders the focused project line with links above the fleet summary", async () => {
    installStoppableEventSource({
      connected: { projectId: "portfolio", workerStatus: "running" },
    });
    localStorage.setItem(SELECTED_IDS_STORAGE_KEY, JSON.stringify(["portfolio"]));
    localStorage.setItem(FOCUSED_PROJECT_ID_STORAGE_KEY, JSON.stringify("portfolio"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/projects") {
          return new Response(
            JSON.stringify({
              projects: [
                {
                  ...portfolio,
                  workerStatus: "running",
                  active: { issue: 11, phase: "tdd", status: "active" },
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
                pr: 99,
                status: "active",
                startedAt: "2026-06-01T12:00:00.000Z",
              },
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/queue")) {
          return new Response(JSON.stringify({ queue: [] }), { status: 200 });
        }
        if (url.endsWith("/history")) {
          return new Response(JSON.stringify({ history: [] }), { status: 200 });
        }
        if (url.endsWith("/start") && init?.method === "POST") {
          return new Response(JSON.stringify({ status: "started" }), { status: 202 });
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    render(<App />);

    const focused = await screen.findByLabelText(/focused project/i);
    expect(focused).toHaveTextContent(/portfolio/);
    expect(focused).toHaveTextContent(/running/);
    expect(within(focused).getByRole("link", { name: "portfolio" })).toHaveAttribute(
      "href",
      "cursor://file//tmp/portfolio",
    );

    await waitFor(() => {
      expect(within(focused).getByRole("link", { name: "PR #99" })).toHaveAttribute(
        "href",
        "https://github.com/HaDuve/Portfolio/pull/99",
      );
    });
    expect(focused).toHaveTextContent(/tdd/);

    const fleet = screen.getByLabelText(/fleet summary/i);
    const statusColumn = focused.closest(".app-header-status");
    expect(statusColumn).toContainElement(focused);
    expect(statusColumn).toContainElement(fleet);
    expect(
      Array.from(statusColumn?.querySelectorAll(".app-header-focused, .app-header-fleet") ?? []).map(
        (node) => node.className,
      ),
    ).toEqual(["app-header-focused", "app-header-fleet"]);
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
    expect(screen.getByRole("region", { name: /run outcome/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /phase stepper/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /active/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /^log$/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /queue/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /history/i })).toBeInTheDocument();
  });

  it("orders focused-project regions in the main column", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/projects") {
          return new Response(JSON.stringify({ projects: [portfolio] }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    render(<App />);
    await screen.findByRole("checkbox", { name: /portfolio/i });

    const regions = within(screen.getByRole("main")).getAllByRole("region");
    expect(regions.map((region) => region.getAttribute("aria-label"))).toEqual([
      "Run outcome",
      "Phase stepper",
      "Active",
      "Log",
      "Queue",
      "History",
    ]);
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
    await user.click(screen.getByRole("button", { name: /start portfolio/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /pause portfolio/i })).toBeEnabled();
    });

    await user.click(screen.getByRole("button", { name: /pause portfolio/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/portfolio/pause",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("loads history for the focused project", async () => {
    vi.stubGlobal("fetch", stubProjectsFetch([portfolio]));

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("checkbox", { name: /portfolio/i }));

    expect(await screen.findByRole("link", { name: /#99/i })).toHaveAttribute(
      "href",
      "https://github.com/HaDuve/Portfolio/pull/99",
    );
    expect(screen.getByText(/issue #9/i)).toBeInTheDocument();
    expect(screen.getByText(/1h/i)).toBeInTheDocument();
  });

  it("loads queue and active panels for the focused project", async () => {
    vi.stubGlobal("fetch", stubProjectsFetch([portfolio]));

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("checkbox", { name: /portfolio/i }));

    const queue = await screen.findByRole("region", { name: /queue/i });
    const active = await screen.findByRole("region", { name: /active/i });
    expect(within(queue).getByText(/#10/)).toBeInTheDocument();
    expect(within(queue).getByText(/Blocked: needs-info/i)).toBeInTheDocument();
    expect(within(active).getByText(/#11/)).toBeInTheDocument();
    expect(within(active).getByText(/issue-11/i)).toBeInTheDocument();
  });

  it("ignores stale panel fetches when the focused project changes", async () => {
    let releasePortfolioPanels: (() => void) | undefined;
    const portfolioPanelsGate = new Promise<void>((resolve) => {
      releasePortfolioPanels = resolve;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/projects") {
          return new Response(JSON.stringify({ projects: [portfolio, other] }), {
            status: 200,
          });
        }
        if (url === "/api/projects/portfolio/queue") {
          await portfolioPanelsGate;
          return new Response(
            JSON.stringify({
              queue: [{ number: 10, labels: ["ready-for-agent"], skipped: false, eligible: true }],
            }),
            { status: 200 },
          );
        }
        if (url === "/api/projects/portfolio/active") {
          await portfolioPanelsGate;
          return new Response(
            JSON.stringify({
              active: {
                issue: 11,
                phase: "tdd",
                branch: "issue-11",
                status: "active",
              },
            }),
            { status: 200 },
          );
        }
        if (url === "/api/projects/portfolio/history") {
          await portfolioPanelsGate;
          return new Response(JSON.stringify({ history: [] }), { status: 200 });
        }
        if (url === "/api/projects/other/queue") {
          return new Response(
            JSON.stringify({
              queue: [{ number: 99, labels: ["ready-for-agent"], skipped: false, eligible: true }],
            }),
            { status: 200 },
          );
        }
        if (url === "/api/projects/other/active") {
          return new Response(JSON.stringify({ active: null }), { status: 200 });
        }
        if (url === "/api/projects/other/history") {
          return new Response(JSON.stringify({ history: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("checkbox", { name: /portfolio/i }));
    await user.click(await screen.findByRole("checkbox", { name: /\bother\b/i }));

    expect(await screen.findByText(/#99/)).toBeInTheDocument();

    releasePortfolioPanels?.();
    await waitFor(() => {
      expect(screen.queryByText(/#10\b/)).not.toBeInTheDocument();
    });
    expect(screen.getByText(/#99/)).toBeInTheDocument();
  });

  it("skips an issue through the API and refreshes the queue", async () => {
    let releaseSkip: (() => void) | undefined;
    const skipGate = new Promise<void>((resolve) => {
      releaseSkip = resolve;
    });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/projects") {
        return new Response(JSON.stringify({ projects: [portfolio] }), { status: 200 });
      }
      if (url.endsWith("/queue")) {
        return new Response(
          JSON.stringify({
            queue: [
              { number: 10, labels: ["ready-for-agent"], skipped: false, eligible: true },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/active")) {
        return new Response(JSON.stringify({ active: null }), { status: 200 });
      }
      if (url.endsWith("/history")) {
        return new Response(JSON.stringify({ history: [] }), { status: 200 });
      }
      if (url === "/api/projects/portfolio/skip" && init?.method === "POST") {
        await skipGate;
        return new Response(JSON.stringify({ status: "skipped", issue: 10 }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("checkbox", { name: /portfolio/i }));
    await screen.findByText(/#10/);

    await user.click(screen.getByRole("checkbox", { name: /skip issue 10/i }));

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: /skip issue 10/i })).toBeChecked();
    });

    releaseSkip?.();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/portfolio/skip",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("refreshes queue and active panels after starting a project", async () => {
    const fetchMock = stubProjectsFetch([portfolio]);
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("checkbox", { name: /portfolio/i }));
    await screen.findByText(/#10/);

    const queueCallsBefore = fetchMock.mock.calls.filter((call) =>
      String(call[0]).endsWith("/queue"),
    ).length;

    await user.click(screen.getByRole("button", { name: /start portfolio/i }));

    await waitFor(() => {
      const queueCallsAfter = fetchMock.mock.calls.filter((call) =>
        String(call[0]).endsWith("/queue"),
      ).length;
      expect(queueCallsAfter).toBeGreaterThan(queueCallsBefore);
    });
  });

  it("omits Start after the worker starts successfully", async () => {
    vi.stubGlobal("fetch", stubProjectsFetch([portfolio]));

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("checkbox", { name: /portfolio/i }));
    await user.click(screen.getByRole("button", { name: /start portfolio/i }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /start portfolio/i })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /kill portfolio/i })).toBeInTheDocument();
    });
  });

  it("kills a running project worker through the API", async () => {
    const fetchMock = stubProjectsFetch([portfolio]);
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("checkbox", { name: /portfolio/i }));
    await user.click(screen.getByRole("button", { name: /start portfolio/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /kill portfolio/i })).toBeEnabled();
    });

    await user.click(screen.getByRole("button", { name: /kill portfolio/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/portfolio/kill",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("does not mark the worker paused when pause returns not-running", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/projects") {
        return new Response(JSON.stringify({ projects: [portfolio] }), { status: 200 });
      }
      if (url.endsWith("/queue")) {
        return new Response(JSON.stringify({ queue: [] }), { status: 200 });
      }
      if (url.endsWith("/active")) {
        return new Response(JSON.stringify({ active: null }), { status: 200 });
      }
      if (url.endsWith("/history")) {
        return new Response(JSON.stringify({ history: [] }), { status: 200 });
      }
      if (url.endsWith("/start") && init?.method === "POST") {
        return new Response(JSON.stringify({ status: "started" }), { status: 202 });
      }
      if (url.endsWith("/pause") && init?.method === "POST") {
        return new Response(JSON.stringify({ status: "not-running" }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("checkbox", { name: /portfolio/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /start portfolio/i })).toBeEnabled();
    });

    await user.click(screen.getByRole("button", { name: /start portfolio/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /pause portfolio/i })).toBeEnabled();
    });

    await user.click(screen.getByRole("button", { name: /pause portfolio/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/not running/i);
      expect(screen.getByRole("button", { name: /start portfolio/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /pause portfolio/i })).not.toBeInTheDocument();
    });
  });

  it("resumes a paused project worker through the API", async () => {
    const fetchMock = stubProjectsFetch([portfolio]);
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("checkbox", { name: /portfolio/i }));
    await user.click(screen.getByRole("button", { name: /start portfolio/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /pause portfolio/i })).toBeEnabled();
    });

    await user.click(screen.getByRole("button", { name: /pause portfolio/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /resume portfolio/i })).toBeEnabled();
    });

    await user.click(screen.getByRole("button", { name: /resume portfolio/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/portfolio/resume",
        expect.objectContaining({ method: "POST" }),
      );
      expect(screen.getByRole("button", { name: /pause portfolio/i })).toBeEnabled();
    });
  });

  it("hides a project client-side without mutating the projects API", async () => {
    const user = userEvent.setup();
    const fetchMock = stubProjectsFetch([portfolio, other]);
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await screen.findByRole("checkbox", { name: /portfolio/i });

    await user.click(screen.getByRole("button", { name: /hide portfolio/i }));

    expect(screen.queryByRole("checkbox", { name: /portfolio/i })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /other/i })).toBeInTheDocument();
    expect(localStorage.getItem(HIDDEN_IDS_STORAGE_KEY)).toBe(JSON.stringify(["portfolio"]));
    expect(
      fetchMock.mock.calls.every(([url, init]) => {
        if (url !== "/api/projects") {
          return true;
        }
        return !init?.method || init.method === "GET";
      }),
    ).toBe(true);
  });

  it("prunes stale hidden ids when projects load", async () => {
    localStorage.setItem(
      HIDDEN_IDS_STORAGE_KEY,
      JSON.stringify(["portfolio", "removed-from-config"]),
    );
    vi.stubGlobal("fetch", stubProjectsFetch([portfolio, other]));

    render(<App />);

    await screen.findByRole("checkbox", { name: /other/i });
    expect(screen.queryByRole("checkbox", { name: /portfolio/i })).not.toBeInTheDocument();
    expect(localStorage.getItem(HIDDEN_IDS_STORAGE_KEY)).toBe(JSON.stringify(["portfolio"]));
  });

  it("keeps hidden projects out of the sidebar after reload", async () => {
    localStorage.setItem(HIDDEN_IDS_STORAGE_KEY, JSON.stringify(["portfolio"]));
    vi.stubGlobal("fetch", stubProjectsFetch([portfolio, other]));

    render(<App />);

    await screen.findByRole("checkbox", { name: /other/i });
    expect(screen.queryByRole("checkbox", { name: /portfolio/i })).not.toBeInTheDocument();
  });

  it("restores hidden projects when Show all is clicked", async () => {
    const user = userEvent.setup();
    localStorage.setItem(HIDDEN_IDS_STORAGE_KEY, JSON.stringify(["portfolio"]));
    vi.stubGlobal("fetch", stubProjectsFetch([portfolio, other]));

    render(<App />);
    await screen.findByRole("button", { name: /show all hidden projects/i });

    await user.click(screen.getByRole("button", { name: /show all hidden projects/i }));

    expect(await screen.findByRole("checkbox", { name: /portfolio/i })).toBeInTheDocument();
    expect(localStorage.getItem(HIDDEN_IDS_STORAGE_KEY)).toBe(JSON.stringify([]));
  });

  it("restores selected projects and run data on reload without control calls", async () => {
    const eventSourceUrls: string[] = [];
    class SilentEventSource {
      url: string;
      constructor(url: string) {
        this.url = url;
        eventSourceUrls.push(url);
      }
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
    vi.stubGlobal("EventSource", SilentEventSource as unknown as typeof EventSource);

    localStorage.setItem(SELECTED_IDS_STORAGE_KEY, JSON.stringify(["portfolio"]));
    localStorage.setItem(FOCUSED_PROJECT_ID_STORAGE_KEY, JSON.stringify("portfolio"));
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/projects") {
        return new Response(
          JSON.stringify({
            projects: [
              {
                ...portfolio,
                workerStatus: "idle",
                lastRunOutcome: {
                  outcome: "blocked",
                  reason: "CI failed",
                  phase: "review-pr",
                  stoppedAt: "2026-06-01T12:00:00.000Z",
                },
                active: { issue: 11, phase: "tdd", status: "active" },
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/queue")) {
        return new Response(
          JSON.stringify({
            queue: [{ number: 10, labels: ["ready-for-agent"], skipped: false, eligible: true }],
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
            },
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/history")) {
        return new Response(JSON.stringify({ history: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const checkbox = await screen.findByRole("checkbox", { name: /portfolio/i });
    expect(checkbox).toBeChecked();
    const runOutcome = screen.getByRole("region", { name: /run outcome/i });
    expect(within(runOutcome).getByText(/CI failed/i)).toBeInTheDocument();
    expect(
      within(runOutcome).getByText("review-pr", { selector: ".run-outcome-banner-phase" }),
    ).toBeInTheDocument();
    const queue = await screen.findByRole("region", { name: /queue/i });
    const active = await screen.findByRole("region", { name: /active/i });
    expect(within(queue).getByText(/#10/)).toBeInTheDocument();
    expect(within(active).getByText(/#11/)).toBeInTheDocument();

    const controlCalls = fetchMock.mock.calls.filter(([url, init]) => {
      if (!init?.method || init.method !== "POST") {
        return false;
      }
      return /\/(start|pause|resume|kill)$/.test(String(url));
    });
    expect(controlCalls).toHaveLength(0);
    expect(eventSourceUrls).toContain("/api/projects/portfolio/events");
  });

  it("hides run-outcome banner while the worker is running after reload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/projects") {
          return new Response(
            JSON.stringify({
              projects: [
                {
                  ...portfolio,
                  workerStatus: "running",
                  lastRunOutcome: {
                    outcome: "blocked",
                    reason: "CI failed",
                    phase: "review-pr",
                    stoppedAt: "2026-06-01T12:00:00.000Z",
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/queue")) {
          return new Response(JSON.stringify({ queue: [] }), { status: 200 });
        }
        if (url.endsWith("/active")) {
          return new Response(JSON.stringify({ active: null }), { status: 200 });
        }
        if (url.endsWith("/history")) {
          return new Response(JSON.stringify({ history: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    render(<App />);
    await screen.findByRole("checkbox", { name: /portfolio/i });

    expect(screen.queryByText(/CI failed/i)).not.toBeInTheDocument();
    const runOutcome = screen.getByRole("region", { name: /run outcome/i });
    expect(within(runOutcome).queryByRole("status")).not.toBeInTheDocument();
  });

  it("updates the sidebar status and phase stepper when a stream event advances the phase", async () => {
    const sources: Array<{
      dispatch: (type: string, data: unknown) => void;
    }> = [];
    class StreamableEventSource {
      url: string;
      private listeners = new Map<string, Set<(event: Event) => void>>();

      constructor(url: string) {
        this.url = url;
        sources.push(this);
        queueMicrotask(() => {
          this.emit("connected", {
            type: "connected",
            projectId: "portfolio",
            workerStatus: "running",
          });
        });
      }

      addEventListener(type: string, handler: (event: Event) => void) {
        let typeListeners = this.listeners.get(type);
        if (!typeListeners) {
          typeListeners = new Set();
          this.listeners.set(type, typeListeners);
        }
        typeListeners.add(handler);
      }

      removeEventListener(type: string, handler: (event: Event) => void) {
        this.listeners.get(type)?.delete(handler);
      }

      close() {}

      emit(type: string, data: unknown) {
        const handlers = this.listeners.get(type);
        if (!handlers) {
          return;
        }
        for (const handler of handlers) {
          handler({ data: JSON.stringify(data) } as unknown as Event);
        }
      }
    }
    vi.stubGlobal("EventSource", StreamableEventSource as unknown as typeof EventSource);

    localStorage.setItem(SELECTED_IDS_STORAGE_KEY, JSON.stringify(["portfolio"]));
    localStorage.setItem(FOCUSED_PROJECT_ID_STORAGE_KEY, JSON.stringify("portfolio"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/projects") {
          return new Response(
            JSON.stringify({
              projects: [
                {
                  ...portfolio,
                  workerStatus: "running",
                  active: { issue: 11, phase: "tdd", status: "active" },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/queue")) {
          return new Response(JSON.stringify({ queue: [] }), { status: 200 });
        }
        if (url.endsWith("/active")) {
          return new Response(
            JSON.stringify({
              active: {
                issue: 11,
                phase: "tdd",
                branch: "issue-11",
                status: "active",
              },
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/history")) {
          return new Response(JSON.stringify({ history: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    render(<App />);

    const sidebar = await screen.findByRole("region", { name: /projects/i });
    const stepper = await screen.findByRole("region", { name: /phase stepper/i });
    expect(within(sidebar).queryByText(/running ·/i)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(within(stepper).getByRole("listitem", { current: "step" })).toHaveTextContent("tdd");
    });

    await act(async () => {
      for (const source of sources) {
        source.emit("stream", {
          type: "stream",
          projectId: "portfolio",
          issue: 11,
          phase: "create-pr",
        });
      }
    });

    await waitFor(() => {
      expect(within(sidebar).queryByText(/running ·/i)).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(within(stepper).getByRole("listitem", { current: "step" })).toHaveTextContent(
        "create-pr",
      );
    });
  });

  it("shows blocked card styling in the sidebar after worker-stopped refreshes the active slice", async () => {
    const { sources } = installStoppableEventSource({
      connected: { projectId: "portfolio", workerStatus: "running" },
    });

    localStorage.setItem(SELECTED_IDS_STORAGE_KEY, JSON.stringify(["portfolio"]));
    let activeFetches = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/projects") {
          return new Response(
            JSON.stringify({
              projects: [
                {
                  ...portfolio,
                  workerStatus: "running",
                  active: { issue: 11, phase: "merge", status: "active" },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/queue")) {
          return new Response(JSON.stringify({ queue: [] }), { status: 200 });
        }
        if (url.endsWith("/active")) {
          activeFetches += 1;
          return new Response(
            JSON.stringify({
              active: {
                issue: 11,
                phase: "merge",
                branch: "issue-11",
                status: activeFetches === 1 ? "active" : "blocked",
                reason: activeFetches > 1 ? "Required check ci failed" : undefined,
              },
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/history")) {
          return new Response(JSON.stringify({ history: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    render(<App />);

    const sidebar = await screen.findByRole("region", { name: /projects/i });
    expect(within(sidebar).queryByText(/running · merge/i)).not.toBeInTheDocument();

    await act(async () => {
      for (const source of sources) {
        source.emit("worker-stopped", {
          type: "worker-stopped",
          projectId: "portfolio",
          lastRunOutcome: {
            outcome: "blocked",
            reason: "Required check ci failed",
            phase: "merge",
            stoppedAt: "2026-06-01T12:00:00.000Z",
          },
        });
      }
    });

    await waitFor(() => {
      const card = within(sidebar).getByRole("checkbox", { name: /portfolio/i }).closest("li");
      expect(card).toHaveClass("project-card--blocked");
    });
    expect(within(sidebar).queryByText(/^blocked$/i)).not.toBeInTheDocument();
  });

  it("defers EventSource subscription until fetchProjects completes", async () => {
    const eventSourceUrls: string[] = [];
    class TrackingEventSource {
      url: string;
      constructor(url: string) {
        this.url = url;
        eventSourceUrls.push(url);
      }
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
    vi.stubGlobal("EventSource", TrackingEventSource as unknown as typeof EventSource);

    let resolveProjects!: (response: Response) => void;
    const projectsResponse = new Promise<Response>((resolve) => {
      resolveProjects = resolve;
    });

    localStorage.setItem(SELECTED_IDS_STORAGE_KEY, JSON.stringify(["portfolio"]));
    localStorage.setItem(FOCUSED_PROJECT_ID_STORAGE_KEY, JSON.stringify("portfolio"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/projects") {
          return projectsResponse;
        }
        if (url.endsWith("/queue")) {
          return new Response(JSON.stringify({ queue: [] }), { status: 200 });
        }
        if (url.endsWith("/active")) {
          return new Response(JSON.stringify({ active: null }), { status: 200 });
        }
        if (url.endsWith("/history")) {
          return new Response(JSON.stringify({ history: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    render(<App />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(eventSourceUrls).toHaveLength(0);

    await act(async () => {
      resolveProjects(
        new Response(
          JSON.stringify({
            projects: [
              {
                ...portfolio,
                workerStatus: "idle",
                active: null,
              },
            ],
          }),
          { status: 200 },
        ),
      );
      await projectsResponse;
    });

    await waitFor(() => {
      expect(eventSourceUrls).toContain("/api/projects/portfolio/events");
    });
  });

  it("shows rich run outcome from worker-stopped without reload", async () => {
    const { sources } = installStoppableEventSource({
      connected: { projectId: "portfolio", workerStatus: "running" },
    });

    localStorage.setItem(SELECTED_IDS_STORAGE_KEY, JSON.stringify(["portfolio"]));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/projects") {
          return new Response(
            JSON.stringify({
              projects: [
                {
                  ...portfolio,
                  workerStatus: "running",
                  active: { issue: 11, phase: "merge", status: "active" },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/queue")) {
          return new Response(JSON.stringify({ queue: [] }), { status: 200 });
        }
        if (url.endsWith("/active")) {
          return new Response(JSON.stringify({ active: null }), { status: 200 });
        }
        if (url.endsWith("/history")) {
          return new Response(JSON.stringify({ history: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    render(<App />);

    await screen.findByRole("region", { name: /phase stepper/i });

    await act(async () => {
      for (const source of sources) {
        source.emit("worker-stopped", {
          type: "worker-stopped",
          projectId: "portfolio",
          lastRunOutcome: {
            outcome: "blocked",
            reason: "Required check ci failed",
            phase: "merge",
            stoppedAt: "2026-06-01T12:00:00.000Z",
          },
        });
      }
    });

    await waitFor(() => {
      expect(screen.getByText("Required check ci failed")).toBeInTheDocument();
    });
    expect(screen.getByText("merge", { selector: ".run-outcome-banner-phase" })).toBeInTheDocument();
  });

  it("restores rich run outcome when re-selecting after worker-stopped", async () => {
    const user = userEvent.setup();
    const { sources } = installStoppableEventSource({
      connected: { projectId: "portfolio", workerStatus: "running" },
    });
    const stoppedOutcome = {
      outcome: "blocked" as const,
      reason: "Required check ci failed",
      phase: "merge",
      stoppedAt: "2026-06-01T12:00:00.000Z",
    };

    localStorage.setItem(SELECTED_IDS_STORAGE_KEY, JSON.stringify(["portfolio"]));
    localStorage.setItem(FOCUSED_PROJECT_ID_STORAGE_KEY, JSON.stringify("portfolio"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/projects") {
          return new Response(
            JSON.stringify({
              projects: [
                {
                  ...portfolio,
                  workerStatus: "running",
                  active: { issue: 11, phase: "merge", status: "active" },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/queue")) {
          return new Response(JSON.stringify({ queue: [] }), { status: 200 });
        }
        if (url.endsWith("/active")) {
          return new Response(JSON.stringify({ active: null }), { status: 200 });
        }
        if (url.endsWith("/history")) {
          return new Response(JSON.stringify({ history: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    render(<App />);

    await screen.findByRole("region", { name: /phase stepper/i });

    await act(async () => {
      for (const source of sources) {
        source.emit("worker-stopped", {
          type: "worker-stopped",
          projectId: "portfolio",
          lastRunOutcome: stoppedOutcome,
        });
      }
    });

    await waitFor(() => {
      expect(screen.getByText("Required check ci failed")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("checkbox", { name: /portfolio/i }));
    expect(screen.queryByText("Required check ci failed")).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /portfolio/i }));

    await waitFor(() => {
      expect(screen.getByText("Required check ci failed")).toBeInTheDocument();
    });
    expect(screen.getByText("merge", { selector: ".run-outcome-banner-phase" })).toBeInTheDocument();
  });

  it("reverts optimistic start when Start API rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/projects") {
          return new Response(JSON.stringify({ projects: [portfolio] }), { status: 200 });
        }
        if (url.endsWith("/queue")) {
          return new Response(
            JSON.stringify({
              queue: [{ number: 10, labels: ["ready-for-agent"], skipped: false, eligible: true }],
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/active")) {
          return new Response(JSON.stringify({ active: null }), { status: 200 });
        }
        if (url.endsWith("/history")) {
          return new Response(JSON.stringify({ history: [] }), { status: 200 });
        }
        if (url.endsWith("/start") && init?.method === "POST") {
          return new Response(JSON.stringify({ status: "already-running" }), { status: 409 });
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("checkbox", { name: /portfolio/i }));
    await screen.findByText(/#10/);
    const activeRegion = screen.getByRole("region", { name: /^active$/i });
    expect(within(activeRegion).getByText(/no active slice/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /start portfolio/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/already running/i);
      expect(screen.getByRole("button", { name: /start portfolio/i })).toBeEnabled();
      expect(screen.queryByRole("button", { name: /pause portfolio/i })).not.toBeInTheDocument();
    });
    expect(within(activeRegion).getByText(/no active slice/i)).toBeInTheDocument();
    const stepper = screen.getByRole("region", { name: /phase stepper/i });
    expect(within(stepper).queryByRole("listitem", { current: "step" })).not.toBeInTheDocument();
  });

  it("updates phase stepper and active slice optimistically when Start is clicked", async () => {
    let releaseStart: (() => void) | undefined;
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/projects") {
          return new Response(JSON.stringify({ projects: [portfolio] }), { status: 200 });
        }
        if (url.endsWith("/queue")) {
          return new Response(
            JSON.stringify({
              queue: [{ number: 10, labels: ["ready-for-agent"], skipped: false, eligible: true }],
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/active")) {
          return new Response(JSON.stringify({ active: null }), { status: 200 });
        }
        if (url.endsWith("/history")) {
          return new Response(JSON.stringify({ history: [] }), { status: 200 });
        }
        if (url.endsWith("/start") && init?.method === "POST") {
          await startGate;
          return new Response(JSON.stringify({ status: "started" }), { status: 202 });
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("checkbox", { name: /portfolio/i }));
    await screen.findByText(/#10/);

    await user.click(screen.getByRole("button", { name: /start portfolio/i }));

    const stepper = screen.getByRole("region", { name: /phase stepper/i });
    expect(within(stepper).getByRole("listitem", { current: "step" })).toHaveTextContent("tdd");
    const activeRegion = screen.getByRole("region", { name: /^active$/i });
    expect(within(activeRegion).getByText(/#10/)).toBeInTheDocument();
    expect(within(activeRegion).getByText(/issue-10/i)).toBeInTheDocument();

    releaseStart?.();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /start portfolio/i })).not.toBeInTheDocument();
    });
  });

  it("aligns log panel phase with stream-updated activeSummaries", async () => {
    const sources: Array<{
      dispatch: (type: string, data: unknown) => void;
    }> = [];
    class StreamableEventSource {
      url: string;
      private listeners = new Map<string, Set<(event: Event) => void>>();

      constructor(url: string) {
        this.url = url;
        sources.push(this);
        queueMicrotask(() => {
          this.emit("connected", {
            type: "connected",
            projectId: "portfolio",
            workerStatus: "running",
          });
        });
      }

      addEventListener(type: string, handler: (event: Event) => void) {
        let typeListeners = this.listeners.get(type);
        if (!typeListeners) {
          typeListeners = new Set();
          this.listeners.set(type, typeListeners);
        }
        typeListeners.add(handler);
      }

      removeEventListener(type: string, handler: (event: Event) => void) {
        this.listeners.get(type)?.delete(handler);
      }

      close() {}

      emit(type: string, data: unknown) {
        const handlers = this.listeners.get(type);
        if (!handlers) {
          return;
        }
        for (const handler of handlers) {
          handler({ data: JSON.stringify(data) } as unknown as Event);
        }
      }
    }
    vi.stubGlobal("EventSource", StreamableEventSource as unknown as typeof EventSource);

    let logFetchCount = 0;
    localStorage.setItem(SELECTED_IDS_STORAGE_KEY, JSON.stringify(["portfolio"]));
    localStorage.setItem(FOCUSED_PROJECT_ID_STORAGE_KEY, JSON.stringify("portfolio"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/projects") {
          return new Response(
            JSON.stringify({
              projects: [
                {
                  ...portfolio,
                  workerStatus: "running",
                  active: { issue: 11, phase: "tdd", status: "active" },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/queue")) {
          return new Response(JSON.stringify({ queue: [] }), { status: 200 });
        }
        if (url.endsWith("/active")) {
          return new Response(
            JSON.stringify({
              active: {
                issue: 11,
                phase: "tdd",
                branch: "issue-11",
                status: "active",
              },
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/history")) {
          return new Response(JSON.stringify({ history: [] }), { status: 200 });
        }
        if (url === "/api/projects/portfolio/log") {
          logFetchCount += 1;
          if (logFetchCount === 1) {
            return new Response(
              JSON.stringify({
                issue: 11,
                phase: "tdd",
                log: "tdd output\n",
                phases: ["tdd", "create-pr"],
              }),
              { status: 200 },
            );
          }
          return new Response(
            JSON.stringify({
              issue: 11,
              phase: "create-pr",
              log: "create-pr output\n",
              phases: ["tdd", "create-pr"],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    render(<App />);

    expect(await screen.findByText("tdd output")).toBeInTheDocument();

    await act(async () => {
      for (const source of sources) {
        source.emit("stream", {
          type: "stream",
          projectId: "portfolio",
          issue: 11,
          phase: "create-pr",
        });
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId("log-preview")).toHaveTextContent("create-pr output");
    });
    expect(logFetchCount).toBeGreaterThanOrEqual(2);
  });

  it("omits Hide while the project worker is running", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", stubProjectsFetch([portfolio]));

    render(<App />);
    await screen.findByRole("checkbox", { name: /portfolio/i });
    await user.click(screen.getByRole("checkbox", { name: /portfolio/i }));
    await user.click(screen.getByRole("button", { name: /start portfolio/i }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /hide portfolio/i })).not.toBeInTheDocument();
    });
  });

  it("refreshes the queue tile without updating other panels", async () => {
    let queueFetchCount = 0;
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/projects") {
          return new Response(JSON.stringify({ projects: [portfolio] }), { status: 200 });
        }
        if (url.endsWith("/queue")) {
          queueFetchCount += 1;
          return new Response(
            JSON.stringify({
              queue:
                queueFetchCount <= 1
                  ? [{ number: 10, labels: ["ready-for-agent"], skipped: false, eligible: true }]
                  : [{ number: 20, labels: ["ready-for-agent"], skipped: false, eligible: true }],
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
              },
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/history")) {
          return new Response(JSON.stringify({ history: [] }), { status: 200 });
        }
        if (url.endsWith("/log")) {
          return new Response(
            JSON.stringify({
              issue: 11,
              phase: "tdd",
              log: "log line\n",
              phases: ["tdd"],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    render(<App />);
    await user.click(await screen.findByRole("checkbox", { name: /portfolio/i }));
    expect(await screen.findByText(/#10/)).toBeInTheDocument();

    const queueRegion = screen.getByRole("region", { name: /^queue$/i });
    await user.click(within(queueRegion).getByRole("button", { name: /refresh queue/i }));

    await waitFor(() => {
      expect(within(queueRegion).getByText(/#20/)).toBeInTheDocument();
    });
    expect(within(screen.getByRole("region", { name: /^active$/i })).getByText(/#11/)).toBeInTheDocument();
  });

  it("shows queue refresh errors inside the queue tile only", async () => {
    const user = userEvent.setup();
    let queueFetchCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/projects") {
          return new Response(JSON.stringify({ projects: [portfolio] }), { status: 200 });
        }
        if (url.endsWith("/queue")) {
          queueFetchCount += 1;
          if (queueFetchCount >= 2) {
            return new Response(JSON.stringify({ error: "queue down" }), { status: 500 });
          }
          return new Response(
            JSON.stringify({
              queue: [{ number: 10, labels: ["ready-for-agent"], skipped: false, eligible: true }],
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/active")) {
          return new Response(JSON.stringify({ active: null }), { status: 200 });
        }
        if (url.endsWith("/history")) {
          return new Response(JSON.stringify({ history: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    render(<App />);
    await user.click(await screen.findByRole("checkbox", { name: /portfolio/i }));
    await screen.findByText(/#10/);

    const queueRegion = screen.getByRole("region", { name: /^queue$/i });
    await user.click(within(queueRegion).getByRole("button", { name: /refresh queue/i }));

    await waitFor(() => {
      expect(within(queueRegion).getByRole("alert")).toHaveTextContent("queue down");
    });
    expect(screen.queryByRole("alert")).toBe(within(queueRegion).getByRole("alert"));
  });


  it("refreshes the history tile without updating other panels", async () => {
    let historyFetchCount = 0;
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/projects") {
          return new Response(JSON.stringify({ projects: [portfolio] }), { status: 200 });
        }
        if (url.endsWith("/queue")) {
          return new Response(
            JSON.stringify({
              queue: [{ number: 10, labels: ["ready-for-agent"], skipped: false, eligible: true }],
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
              },
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/history")) {
          historyFetchCount += 1;
          return new Response(
            JSON.stringify({
              history:
                historyFetchCount <= 1
                  ? [
                      {
                        pr: 99,
                        issue: 9,
                        branch: "issue-9",
                        startedAt: "2026-06-01T00:00:00.000Z",
                        endedAt: "2026-06-01T01:00:00.000Z",
                        phases: [
                          {
                            phase: "merge",
                            startedAt: "2026-06-01T00:00:00.000Z",
                            endedAt: "2026-06-01T01:00:00.000Z",
                          },
                        ],
                      },
                    ]
                  : [
                      {
                        pr: 100,
                        issue: 10,
                        branch: "issue-10",
                        startedAt: "2026-06-02T00:00:00.000Z",
                        endedAt: "2026-06-02T01:00:00.000Z",
                        phases: [
                          {
                            phase: "merge",
                            startedAt: "2026-06-02T00:00:00.000Z",
                            endedAt: "2026-06-02T01:00:00.000Z",
                          },
                        ],
                      },
                    ],
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/log")) {
          return new Response(
            JSON.stringify({
              issue: 11,
              phase: "tdd",
              log: "log line\n",
              phases: ["tdd"],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    render(<App />);
    await user.click(await screen.findByRole("checkbox", { name: /portfolio/i }));
    expect(await screen.findByText(/#99/)).toBeInTheDocument();

    const historyRegion = screen.getByRole("region", { name: /^history$/i });
    await user.click(within(historyRegion).getByRole("button", { name: /refresh history/i }));

    await waitFor(() => {
      expect(within(historyRegion).getByText(/#100/)).toBeInTheDocument();
    });
    expect(within(screen.getByRole("region", { name: /^queue$/i })).getByText(/#10/)).toBeInTheDocument();
  });

  it("shows history refresh errors inside the history tile only", async () => {
    const user = userEvent.setup();
    let historyFetchCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/projects") {
          return new Response(JSON.stringify({ projects: [portfolio] }), { status: 200 });
        }
        if (url.endsWith("/queue")) {
          return new Response(
            JSON.stringify({
              queue: [{ number: 10, labels: ["ready-for-agent"], skipped: false, eligible: true }],
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/active")) {
          return new Response(JSON.stringify({ active: null }), { status: 200 });
        }
        if (url.endsWith("/history")) {
          historyFetchCount += 1;
          if (historyFetchCount >= 2) {
            return new Response(JSON.stringify({ error: "history down" }), { status: 500 });
          }
          return new Response(
            JSON.stringify({
              history: [
                {
                  pr: 99,
                  issue: 9,
                  branch: "issue-9",
                  startedAt: "2026-06-01T00:00:00.000Z",
                  endedAt: "2026-06-01T01:00:00.000Z",
                  phases: [
                    {
                      phase: "merge",
                      startedAt: "2026-06-01T00:00:00.000Z",
                      endedAt: "2026-06-01T01:00:00.000Z",
                    },
                  ],
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    render(<App />);
    await user.click(await screen.findByRole("checkbox", { name: /portfolio/i }));
    await screen.findByText(/#99/);

    const historyRegion = screen.getByRole("region", { name: /^history$/i });
    await user.click(within(historyRegion).getByRole("button", { name: /refresh history/i }));

    await waitFor(() => {
      expect(within(historyRegion).getByRole("alert")).toHaveTextContent("history down");
    });
    expect(screen.queryByRole("alert")).toBe(within(historyRegion).getByRole("alert"));
  });

  it("preserves SSE log tail when refreshing the log tile on the live phase", async () => {
    const { sources } = installStoppableEventSource({
      connected: { projectId: "portfolio", workerStatus: "running" },
    });
    let logFetchCount = 0;
    localStorage.setItem(SELECTED_IDS_STORAGE_KEY, JSON.stringify(["portfolio"]));
    localStorage.setItem(FOCUSED_PROJECT_ID_STORAGE_KEY, JSON.stringify("portfolio"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/projects") {
          return new Response(
            JSON.stringify({
              projects: [
                {
                  ...portfolio,
                  workerStatus: "running",
                  active: { issue: 11, phase: "tdd", status: "active" },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/queue")) {
          return new Response(JSON.stringify({ queue: [] }), { status: 200 });
        }
        if (url.endsWith("/active")) {
          return new Response(
            JSON.stringify({
              active: {
                issue: 11,
                phase: "tdd",
                branch: "issue-11",
                status: "active",
              },
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/history")) {
          return new Response(JSON.stringify({ history: [] }), { status: 200 });
        }
        if (url === "/api/projects/portfolio/log") {
          logFetchCount += 1;
          return new Response(
            JSON.stringify({
              issue: 11,
              phase: "tdd",
              log: logFetchCount === 1 ? "seed\n" : "seed\nrefreshed\n",
              phases: ["tdd"],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("seed")).toBeInTheDocument();

    await act(async () => {
      for (const source of sources) {
        source.emit("phase-log", {
          type: "phase-log",
          projectId: "portfolio",
          chunk: "live-tail\n",
        });
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId("log-preview")).toHaveTextContent("live-tail");
    });

    const logRegion = screen.getByRole("region", { name: /^log$/i });
    await user.click(within(logRegion).getByRole("button", { name: /refresh log/i }));

    await waitFor(() => {
      const preview = screen.getByTestId("log-preview");
      expect(preview).toHaveTextContent("refreshed");
      expect(preview).toHaveTextContent("live-tail");
    });
  });

  it("auto-refreshes all focused tiles every 30 seconds while visible", async () => {
    vi.useFakeTimers();
    let activeFetchCount = 0;
    let queueFetchCount = 0;
    let historyFetchCount = 0;
    let logFetchCount = 0;
    localStorage.setItem(SELECTED_IDS_STORAGE_KEY, JSON.stringify(["portfolio"]));
    localStorage.setItem(FOCUSED_PROJECT_ID_STORAGE_KEY, JSON.stringify("portfolio"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/projects") {
          return new Response(
            JSON.stringify({
              projects: [
                {
                  ...portfolio,
                  workerStatus: "running",
                  active: { issue: 11, phase: "tdd", status: "active" },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/queue")) {
          queueFetchCount += 1;
          return new Response(JSON.stringify({ queue: [] }), { status: 200 });
        }
        if (url.endsWith("/active")) {
          activeFetchCount += 1;
          return new Response(
            JSON.stringify({
              active: {
                issue: 11,
                phase: "tdd",
                branch: "issue-11",
                status: "active",
              },
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/history")) {
          historyFetchCount += 1;
          return new Response(JSON.stringify({ history: [] }), { status: 200 });
        }
        if (url === "/api/projects/portfolio/log") {
          logFetchCount += 1;
          return new Response(
            JSON.stringify({
              issue: 11,
              phase: "tdd",
              log: "log\n",
              phases: ["tdd"],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });

    const initialActive = activeFetchCount;
    const initialQueue = queueFetchCount;
    const initialHistory = historyFetchCount;
    const initialLog = logFetchCount;

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });

    expect(activeFetchCount).toBeGreaterThan(initialActive);
    expect(queueFetchCount).toBeGreaterThan(initialQueue);
    expect(historyFetchCount).toBeGreaterThan(initialHistory);
    expect(logFetchCount).toBeGreaterThan(initialLog);

    vi.useRealTimers();
  });

  it("pauses auto-refresh while hidden and catches up on unhide after 30 seconds", async () => {
    vi.useFakeTimers();
    type VisibilityDocument = {
      visibilityState: string;
      dispatchEvent: (event: Event) => boolean;
    };
    const doc = (globalThis as unknown as { document: VisibilityDocument }).document;
    let activeFetchCount = 0;
    localStorage.setItem(SELECTED_IDS_STORAGE_KEY, JSON.stringify(["portfolio"]));
    localStorage.setItem(FOCUSED_PROJECT_ID_STORAGE_KEY, JSON.stringify("portfolio"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/projects") {
          return new Response(
            JSON.stringify({
              projects: [
                {
                  ...portfolio,
                  workerStatus: "running",
                  active: { issue: 11, phase: "tdd", status: "active" },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/queue")) {
          return new Response(JSON.stringify({ queue: [] }), { status: 200 });
        }
        if (url.endsWith("/active")) {
          activeFetchCount += 1;
          return new Response(
            JSON.stringify({
              active: {
                issue: 11,
                phase: "tdd",
                branch: "issue-11",
                status: "active",
              },
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/history")) {
          return new Response(JSON.stringify({ history: [] }), { status: 200 });
        }
        if (url === "/api/projects/portfolio/log") {
          return new Response(
            JSON.stringify({
              issue: 11,
              phase: "tdd",
              log: "log\n",
              phases: ["tdd"],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    const afterFirstTick = activeFetchCount;

    await act(async () => {
      Object.defineProperty(doc, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      doc.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(45_000);
      await Promise.resolve();
    });
    expect(activeFetchCount).toBe(afterFirstTick);

    await act(async () => {
      Object.defineProperty(doc, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      doc.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(activeFetchCount).toBeGreaterThan(afterFirstTick);

    vi.useRealTimers();
  });

  it("stops auto-refresh when the focused project is cleared", async () => {
    vi.useFakeTimers();
    let activeFetchCount = 0;
    localStorage.setItem(SELECTED_IDS_STORAGE_KEY, JSON.stringify(["portfolio"]));
    localStorage.setItem(FOCUSED_PROJECT_ID_STORAGE_KEY, JSON.stringify("portfolio"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/projects") {
          return new Response(JSON.stringify({ projects: [portfolio] }), { status: 200 });
        }
        if (url.endsWith("/queue")) {
          return new Response(JSON.stringify({ queue: [] }), { status: 200 });
        }
        if (url.endsWith("/active")) {
          activeFetchCount += 1;
          return new Response(JSON.stringify({ active: null }), { status: 200 });
        }
        if (url.endsWith("/history")) {
          return new Response(JSON.stringify({ history: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    const whileFocused = activeFetchCount;

    const checkbox = screen.getByRole("checkbox", { name: /portfolio/i });
    await act(async () => {
      fireEvent.click(checkbox);
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });

    expect(activeFetchCount).toBe(whileFocused);
    vi.useRealTimers();
  });

});

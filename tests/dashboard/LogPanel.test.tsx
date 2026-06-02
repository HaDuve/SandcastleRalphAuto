import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LogPanel } from "../../dashboard/src/LogPanel.js";
import type { Project } from "../../dashboard/src/types.js";

const portfolio: Project = {
  id: "portfolio",
  path: "/tmp/portfolio",
  remote: "HaDuve/Portfolio",
  defaultBase: "main",
  afkLabel: "ready-for-agent",
  blockedLabels: [],
  autoMerge: true,
  concurrency: "single",
  sandbox: "none",
};

function stubLogFetch(log: string, phases = ["tdd", "review-pr"], phase = "review-pr") {
  return vi.fn(async (url: string) => {
    if (url === "/api/projects/portfolio/log") {
      return new Response(
        JSON.stringify({ issue: 7, phase, log, phases }),
        { status: 200 },
      );
    }
    if (url === "/api/projects/portfolio/log?phase=tdd") {
      return new Response(
        JSON.stringify({
          issue: 7,
          phase: "tdd",
          log: "tdd-only line\n",
          phases,
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  });
}

describe("LogPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prompts to select a project when none is focused", () => {
    render(<LogPanel project={null} activePhase={null} />);

    expect(screen.getByText(/select a project/i)).toBeInTheDocument();
  });

  it("shows the latest five lines in the collapsed preview", async () => {
    const log = ["line1", "line2", "line3", "line4", "line5", "line6", "line7"].join("\n") + "\n";
    vi.stubGlobal("fetch", stubLogFetch(log));

    render(<LogPanel project={portfolio} activePhase="review-pr" />);

    const preview = await screen.findByTestId("log-preview");
    expect(preview).toHaveTextContent("line3");
    expect(preview).toHaveTextContent("line7");
    expect(preview).not.toHaveTextContent("line2");
  });

  it("reveals the full log when expanded", async () => {
    const log = ["line1", "line2", "line3", "line4", "line5", "line6", "line7"].join("\n") + "\n";
    vi.stubGlobal("fetch", stubLogFetch(log));

    const user = userEvent.setup();
    render(<LogPanel project={portfolio} activePhase="review-pr" />);

    await screen.findByTestId("log-preview");
    await user.click(screen.getByRole("button", { name: /expand/i }));

    const expanded = screen.getByTestId("log-expanded");
    expect(expanded).toHaveTextContent("line1");
    expect(expanded).toHaveTextContent("line7");
  });

  it("re-seeds the log when the active phase advances", async () => {
    let logFetchCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/projects/portfolio/log") {
          logFetchCount += 1;
          if (logFetchCount === 1) {
            return new Response(
              JSON.stringify({
                issue: 7,
                phase: "tdd",
                log: "tdd output\n",
                phases: ["tdd", "review-pr"],
              }),
              { status: 200 },
            );
          }
          return new Response(
            JSON.stringify({
              issue: 7,
              phase: "review-pr",
              log: "review-pr output\n",
              phases: ["tdd", "review-pr"],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    const { rerender } = render(<LogPanel project={portfolio} activePhase="tdd" />);

    expect(await screen.findByText("tdd output")).toBeInTheDocument();

    rerender(<LogPanel project={portfolio} activePhase="review-pr" />);

    await waitFor(() => {
      expect(screen.getByTestId("log-preview")).toHaveTextContent("review-pr output");
    });
    expect(screen.getByTestId("log-preview")).not.toHaveTextContent("tdd output");
    expect(logFetchCount).toBeGreaterThanOrEqual(2);
  });

  it("appends phase-log chunks from the shared events subscription", async () => {
    let tailHandler: ((chunk: string) => void) | null = null;
    vi.stubGlobal("fetch", stubLogFetch("seed\n"));

    render(
      <LogPanel
        project={portfolio}
        activePhase="review-pr"
        registerPhaseLogHandler={(handler) => {
          tailHandler = handler;
        }}
      />,
    );

    await screen.findByText("seed");
    tailHandler!("live");

    await waitFor(() => {
      expect(screen.getByTestId("log-preview")).toHaveTextContent("live");
    });
  });

  it("ignores phase-log chunks while viewing a prior phase", async () => {
    let tailHandler: ((chunk: string) => void) | null = null;
    vi.stubGlobal("fetch", stubLogFetch("review output\n"));

    const user = userEvent.setup();
    render(
      <LogPanel
        project={portfolio}
        activePhase="review-pr"
        registerPhaseLogHandler={(handler) => {
          tailHandler = handler;
        }}
      />,
    );

    await screen.findByTestId("log-preview");
    await user.click(screen.getByRole("button", { name: /expand/i }));
    await user.selectOptions(await screen.findByRole("combobox", { name: /phase/i }), "tdd");

    await waitFor(() => {
      expect(screen.getByTestId("log-expanded")).toHaveTextContent("tdd-only line");
    });

    tailHandler!("stale-tail");

    await waitFor(() => {
      expect(screen.getByTestId("log-expanded")).not.toHaveTextContent("stale-tail");
    });
  });

  it("loads a prior phase log from the dropdown when expanded", async () => {
    const fetchMock = stubLogFetch("review output\n");
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<LogPanel project={portfolio} activePhase="review-pr" />);

    await screen.findByTestId("log-preview");
    await user.click(screen.getByRole("button", { name: /expand/i }));

    const phaseSelect = await screen.findByRole("combobox", { name: /phase/i });
    await user.selectOptions(phaseSelect, "tdd");

    await waitFor(() => {
      expect(screen.getByTestId("log-expanded")).toHaveTextContent("tdd-only line");
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/portfolio/log?phase=tdd");
  });

  it("preserves SSE-appended tail when refreshing the live phase", async () => {
    let tailHandler: ((chunk: string) => void) | null = null;
    let refreshHandler: (() => Promise<void>) | null = null;
    let logFetchCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/projects/portfolio/log") {
          logFetchCount += 1;
          return new Response(
            JSON.stringify({
              issue: 7,
              phase: "review-pr",
              log: logFetchCount === 1 ? "seed\n" : "seed\nrefreshed-base\n",
              phases: ["tdd", "review-pr"],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    render(
      <LogPanel
        project={portfolio}
        activePhase="review-pr"
        registerPhaseLogHandler={(handler) => {
          tailHandler = handler;
        }}
        registerRefreshHandler={(handler) => {
          refreshHandler = handler;
        }}
      />,
    );

    await screen.findByText("seed");
    tailHandler!("live-tail\n");

    await waitFor(() => {
      expect(screen.getByTestId("log-preview")).toHaveTextContent("live-tail");
    });

    await refreshHandler!();

    await waitFor(() => {
      const preview = screen.getByTestId("log-preview");
      expect(preview).toHaveTextContent("refreshed-base");
      expect(preview).toHaveTextContent("live-tail");
    });
  });

  it("fully re-fetches a historical phase on refresh", async () => {
    let refreshHandler: (() => Promise<void>) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/projects/portfolio/log") {
          return new Response(
            JSON.stringify({
              issue: 7,
              phase: "review-pr",
              log: "review output\n",
              phases: ["tdd", "review-pr"],
            }),
            { status: 200 },
          );
        }
        if (url === "/api/projects/portfolio/log?phase=tdd") {
          return new Response(
            JSON.stringify({
              issue: 7,
              phase: "tdd",
              log: "historical tdd\n",
              phases: ["tdd", "review-pr"],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    const user = userEvent.setup();
    render(
      <LogPanel
        project={portfolio}
        activePhase="review-pr"
        registerRefreshHandler={(handler) => {
          refreshHandler = handler;
        }}
      />,
    );

    await screen.findByTestId("log-preview");
    await user.click(screen.getByRole("button", { name: /expand/i }));
    await user.selectOptions(await screen.findByRole("combobox", { name: /phase/i }), "tdd");

    await waitFor(() => {
      expect(screen.getByTestId("log-expanded")).toHaveTextContent("historical tdd");
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/projects/portfolio/log?phase=tdd") {
          return new Response(
            JSON.stringify({
              issue: 7,
              phase: "tdd",
              log: "updated historical tdd\n",
              phases: ["tdd", "review-pr"],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    await refreshHandler!();

    await waitFor(() => {
      expect(screen.getByTestId("log-expanded")).toHaveTextContent("updated historical tdd");
    });
  });
});

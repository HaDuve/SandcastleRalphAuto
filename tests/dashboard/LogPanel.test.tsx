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
    render(<LogPanel project={null} />);

    expect(screen.getByText(/select a project/i)).toBeInTheDocument();
  });

  it("shows the latest five lines in the collapsed preview", async () => {
    const log = ["line1", "line2", "line3", "line4", "line5", "line6", "line7"].join("\n") + "\n";
    vi.stubGlobal("fetch", stubLogFetch(log));

    render(<LogPanel project={portfolio} />);

    const preview = await screen.findByTestId("log-preview");
    expect(preview).toHaveTextContent("line3");
    expect(preview).toHaveTextContent("line7");
    expect(preview).not.toHaveTextContent("line2");
  });

  it("reveals the full log when expanded", async () => {
    const log = ["line1", "line2", "line3", "line4", "line5", "line6", "line7"].join("\n") + "\n";
    vi.stubGlobal("fetch", stubLogFetch(log));

    const user = userEvent.setup();
    render(<LogPanel project={portfolio} />);

    await screen.findByTestId("log-preview");
    await user.click(screen.getByRole("button", { name: /expand/i }));

    const expanded = screen.getByTestId("log-expanded");
    expect(expanded).toHaveTextContent("line1");
    expect(expanded).toHaveTextContent("line7");
  });

  it("appends phase-log chunks from SSE without polling", async () => {
    const listeners = new Map<string, Set<(event: Event) => void>>();
    class ControllableEventSource {
      url: string;
      constructor(url: string) {
        this.url = url;
      }
      addEventListener(type: string, handler: (event: Event) => void) {
        let typeListeners = listeners.get(type);
        if (!typeListeners) {
          typeListeners = new Set();
          listeners.set(type, typeListeners);
        }
        typeListeners.add(handler);
      }
      removeEventListener(type: string, handler: (event: Event) => void) {
        listeners.get(type)?.delete(handler);
      }
      close() {}
    }
    vi.stubGlobal("EventSource", ControllableEventSource as unknown as typeof EventSource);
    vi.stubGlobal("fetch", stubLogFetch("seed\n"));

    render(<LogPanel project={portfolio} />);

    await screen.findByText("seed");

    listeners.get("phase-log")!.forEach((handler) =>
      handler({
        data: JSON.stringify({ type: "phase-log", projectId: "portfolio", chunk: "live" }),
      } as unknown as Event),
    );

    await waitFor(() => {
      expect(screen.getByTestId("log-preview")).toHaveTextContent("live");
    });
  });

  it("loads a prior phase log from the dropdown when expanded", async () => {
    const fetchMock = stubLogFetch("review output\n");
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<LogPanel project={portfolio} />);

    await screen.findByTestId("log-preview");
    await user.click(screen.getByRole("button", { name: /expand/i }));

    const phaseSelect = await screen.findByRole("combobox", { name: /phase/i });
    await user.selectOptions(phaseSelect, "tdd");

    await waitFor(() => {
      expect(screen.getByTestId("log-expanded")).toHaveTextContent("tdd-only line");
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/portfolio/log?phase=tdd");
  });
});

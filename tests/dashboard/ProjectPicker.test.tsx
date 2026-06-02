import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProjectPicker } from "../../dashboard/src/ProjectPicker.js";
import type { Project } from "../../dashboard/src/types.js";
import type { WorkerState, WorkerStatus } from "../../dashboard/src/workerStatus.js";

function workerState(status: WorkerStatus): WorkerState {
  return { status, lastOutcome: null };
}

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

const other: Project = {
  ...portfolio,
  id: "other",
  path: "/tmp/other",
  remote: "HaDuve/Other",
};

function renderPicker(
  overrides: Partial<{
    projects: Project[];
    selectedIds: Set<string>;
    workerStates: Record<string, WorkerState>;
    onStart: (projectId: string) => void;
    onPause: (projectId: string) => void;
    onResume: (projectId: string) => void;
    onKill: (projectId: string) => void;
    onHide: (projectId: string) => void;
    onShowAll: () => void;
    hasHiddenProjects: boolean;
  }> = {},
) {
  return render(
    <ProjectPicker
      projects={overrides.projects ?? [portfolio]}
      selectedIds={overrides.selectedIds ?? new Set()}
      workerStates={overrides.workerStates ?? {}}
      hasHiddenProjects={overrides.hasHiddenProjects ?? false}
      onSelectedChange={() => {}}
      onStart={overrides.onStart ?? (() => {})}
      onPause={overrides.onPause ?? (() => {})}
      onResume={overrides.onResume ?? (() => {})}
      onKill={overrides.onKill ?? (() => {})}
      onHide={overrides.onHide ?? (() => {})}
      onShowAll={overrides.onShowAll ?? (() => {})}
    />,
  );
}

describe("ProjectPicker", () => {
  it("renders a checkbox per registered project", () => {
    renderPicker();

    expect(screen.getByRole("checkbox", { name: /portfolio/i })).toBeInTheDocument();
  });

  it("does not render a per-card status string", () => {
    renderPicker({
      workerStates: { portfolio: workerState("running") },
    });

    expect(screen.queryByText("running · create-pr")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not show blocked text on the card when worker is running", () => {
    renderPicker({
      workerStates: { portfolio: workerState("running") },
    });

    expect(screen.queryByText(/running ·/i)).not.toBeInTheDocument();
    expect(screen.queryByText("blocked")).not.toBeInTheDocument();
  });

  it("calls start only for checked projects", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    renderPicker({
      selectedIds: new Set(["portfolio"]),
      workerStates: { portfolio: workerState("idle") },
      onStart,
    });

    await user.click(screen.getByRole("button", { name: "Start portfolio" }));

    expect(onStart).toHaveBeenCalledWith("portfolio");
  });

  it("calls pause only for checked projects", async () => {
    const user = userEvent.setup();
    const onPause = vi.fn();
    renderPicker({
      selectedIds: new Set(["portfolio"]),
      workerStates: { portfolio: workerState("running") },
      onPause,
    });

    await user.click(screen.getByRole("button", { name: "Pause portfolio" }));

    expect(onPause).toHaveBeenCalledWith("portfolio");
  });

  it("omits Start and shows Pause and Kill when the worker is running", () => {
    renderPicker({
      selectedIds: new Set(["portfolio"]),
      workerStates: { portfolio: workerState("running") },
    });

    expect(screen.queryByRole("button", { name: "Start portfolio" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kill portfolio" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause portfolio" })).toBeInTheDocument();
  });

  it("uses short visible labels with project id in aria-label only", () => {
    renderPicker({
      selectedIds: new Set(["portfolio"]),
      workerStates: { portfolio: workerState("idle") },
    });

    const start = screen.getByRole("button", { name: "Start portfolio" });
    expect(start).toHaveTextContent("Start");
    expect(start).not.toHaveTextContent("portfolio");
  });

  it("calls kill for a checked running project", async () => {
    const user = userEvent.setup();
    const onKill = vi.fn();
    renderPicker({
      selectedIds: new Set(["portfolio"]),
      workerStates: { portfolio: workerState("running") },
      onKill,
    });

    await user.click(screen.getByRole("button", { name: "Kill portfolio" }));

    expect(onKill).toHaveBeenCalledWith("portfolio");
  });

  it("shows Resume and omits Pause when the worker is paused", async () => {
    const user = userEvent.setup();
    const onResume = vi.fn();
    renderPicker({
      selectedIds: new Set(["portfolio"]),
      workerStates: { portfolio: workerState("paused") },
      onResume,
    });

    expect(screen.getByRole("button", { name: "Resume portfolio" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause portfolio" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Resume portfolio" }));

    expect(onResume).toHaveBeenCalledWith("portfolio");
  });

  it("omits all controls while worker status is unknown", () => {
    renderPicker({ selectedIds: new Set(["portfolio"]) });

    expect(screen.queryByRole("button", { name: /start portfolio/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pause portfolio/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /resume portfolio/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /kill portfolio/i })).not.toBeInTheDocument();
  });

  it("removes a project from the list when Hide is clicked", async () => {
    const user = userEvent.setup();
    const onHide = vi.fn();
    const { rerender } = renderPicker({
      projects: [portfolio, other],
      onHide,
    });

    expect(screen.getByRole("checkbox", { name: /portfolio/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hide portfolio" }));

    expect(onHide).toHaveBeenCalledWith("portfolio");
    rerender(
      <ProjectPicker
        projects={[other]}
        selectedIds={new Set()}
        workerStates={{}}
        hasHiddenProjects
        onSelectedChange={() => {}}
        onStart={() => {}}
        onPause={() => {}}
        onResume={() => {}}
        onKill={() => {}}
        onHide={onHide}
        onShowAll={() => {}}
      />,
    );

    expect(screen.queryByRole("checkbox", { name: /portfolio/i })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /other/i })).toBeInTheDocument();
  });

  it("omits Hide while the project worker is running", () => {
    renderPicker({
      selectedIds: new Set(["portfolio"]),
      workerStates: { portfolio: workerState("running") },
    });

    expect(screen.queryByRole("button", { name: /hide portfolio/i })).not.toBeInTheDocument();
  });

  it("does not color-code the sidebar while the worker is running", () => {
    renderPicker({
      workerStates: {
        portfolio: {
          status: "running",
          lastOutcome: {
            outcome: "blocked",
            reason: "CI failed",
            phase: "review-pr",
            stoppedAt: "2026-06-01T12:00:00.000Z",
          },
        },
      },
    });

    const card = screen.getByRole("checkbox", { name: /portfolio/i }).closest("li");
    expect(card).toHaveClass("project-card");
    expect(card).not.toHaveClass("project-card--blocked");
  });

  it("color-codes the sidebar card from the last run outcome", () => {
    renderPicker({
      workerStates: {
        portfolio: {
          status: "idle",
          lastOutcome: {
            outcome: "blocked",
            reason: "CI failed",
            phase: "review-pr",
            stoppedAt: "2026-06-01T12:00:00.000Z",
          },
        },
      },
    });

    const card = screen.getByRole("checkbox", { name: /portfolio/i }).closest("li");
    expect(card).toHaveClass("project-card--blocked");
  });

  it("restores hidden projects when Show all is clicked", async () => {
    const user = userEvent.setup();
    const onShowAll = vi.fn();
    renderPicker({ hasHiddenProjects: true, onShowAll });

    await user.click(screen.getByRole("button", { name: /show all hidden projects/i }));

    expect(onShowAll).toHaveBeenCalled();
  });
});

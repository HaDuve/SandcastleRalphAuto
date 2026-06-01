import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProjectPicker } from "../../dashboard/src/ProjectPicker.js";
import type { Project } from "../../dashboard/src/types.js";
import type { WorkerStatus } from "../../dashboard/src/workerStatus.js";

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
    workerStatuses: Record<string, WorkerStatus>;
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
      workerStatuses={overrides.workerStatuses ?? {}}
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

  it("calls start only for checked projects", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    renderPicker({
      selectedIds: new Set(["portfolio"]),
      workerStatuses: { portfolio: "idle" },
      onStart,
    });

    await user.click(screen.getByRole("button", { name: /start portfolio/i }));

    expect(onStart).toHaveBeenCalledWith("portfolio");
  });

  it("calls pause only for checked projects", async () => {
    const user = userEvent.setup();
    const onPause = vi.fn();
    renderPicker({
      selectedIds: new Set(["portfolio"]),
      workerStatuses: { portfolio: "running" },
      onPause,
    });

    await user.click(screen.getByRole("button", { name: /pause portfolio/i }));

    expect(onPause).toHaveBeenCalledWith("portfolio");
  });

  it("disables Start and enables Kill when the project worker is running", () => {
    renderPicker({
      selectedIds: new Set(["portfolio"]),
      workerStatuses: { portfolio: "running" },
    });

    expect(screen.getByRole("button", { name: /start portfolio/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /kill portfolio/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /pause portfolio/i })).toBeEnabled();
  });

  it("calls kill for a checked running project", async () => {
    const user = userEvent.setup();
    const onKill = vi.fn();
    renderPicker({
      selectedIds: new Set(["portfolio"]),
      workerStatuses: { portfolio: "running" },
      onKill,
    });

    await user.click(screen.getByRole("button", { name: /kill portfolio/i }));

    expect(onKill).toHaveBeenCalledWith("portfolio");
  });

  it("enables Resume when the worker is paused", async () => {
    const user = userEvent.setup();
    const onResume = vi.fn();
    renderPicker({
      selectedIds: new Set(["portfolio"]),
      workerStatuses: { portfolio: "paused" },
      onResume,
    });

    expect(screen.getByRole("button", { name: /resume portfolio/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /pause portfolio/i })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /resume portfolio/i }));

    expect(onResume).toHaveBeenCalledWith("portfolio");
  });

  it("disables all controls while worker status is unknown", () => {
    renderPicker({ selectedIds: new Set(["portfolio"]) });

    expect(screen.getByRole("button", { name: /start portfolio/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /pause portfolio/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /resume portfolio/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /kill portfolio/i })).toBeDisabled();
  });

  it("removes a project from the list when Hide is clicked", async () => {
    const user = userEvent.setup();
    const onHide = vi.fn();
    const { rerender } = renderPicker({
      projects: [portfolio, other],
      onHide,
    });

    expect(screen.getByRole("checkbox", { name: /portfolio/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /hide portfolio/i }));

    expect(onHide).toHaveBeenCalledWith("portfolio");
    rerender(
      <ProjectPicker
        projects={[other]}
        selectedIds={new Set()}
        workerStatuses={{}}
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

  it("disables Hide while the project worker is running", () => {
    renderPicker({
      selectedIds: new Set(["portfolio"]),
      workerStatuses: { portfolio: "running" },
    });

    expect(screen.getByRole("button", { name: /hide portfolio/i })).toBeDisabled();
  });

  it("restores hidden projects when Show all is clicked", async () => {
    const user = userEvent.setup();
    const onShowAll = vi.fn();
    renderPicker({ hasHiddenProjects: true, onShowAll });

    await user.click(screen.getByRole("button", { name: /show all/i }));

    expect(onShowAll).toHaveBeenCalled();
  });
});

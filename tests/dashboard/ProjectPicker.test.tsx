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

function renderPicker(
  overrides: Partial<{
    selectedIds: Set<string>;
    workerStatuses: Record<string, WorkerStatus>;
    onStart: (projectId: string) => void;
    onPause: (projectId: string) => void;
    onResume: (projectId: string) => void;
    onKill: (projectId: string) => void;
  }> = {},
) {
  return render(
    <ProjectPicker
      projects={[portfolio]}
      selectedIds={overrides.selectedIds ?? new Set()}
      workerStatuses={overrides.workerStatuses ?? {}}
      onSelectedChange={() => {}}
      onStart={overrides.onStart ?? (() => {})}
      onPause={overrides.onPause ?? (() => {})}
      onResume={overrides.onResume ?? (() => {})}
      onKill={overrides.onKill ?? (() => {})}
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
    renderPicker({ selectedIds: new Set(["portfolio"]), onStart });

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
});

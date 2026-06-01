import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProjectPicker } from "../../dashboard/src/ProjectPicker.js";
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

describe("ProjectPicker", () => {
  it("renders a checkbox per registered project", () => {
    render(
      <ProjectPicker
        projects={[portfolio]}
        selectedIds={new Set()}
        onSelectedChange={() => {}}
        onStart={() => {}}
        onPause={() => {}}
      />,
    );

    expect(screen.getByRole("checkbox", { name: /portfolio/i })).toBeInTheDocument();
  });

  it("calls start only for checked projects", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(
      <ProjectPicker
        projects={[portfolio]}
        selectedIds={new Set(["portfolio"])}
        onSelectedChange={() => {}}
        onStart={onStart}
        onPause={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: /start portfolio/i }));

    expect(onStart).toHaveBeenCalledWith("portfolio");
  });

  it("calls pause only for checked projects", async () => {
    const user = userEvent.setup();
    const onPause = vi.fn();
    render(
      <ProjectPicker
        projects={[portfolio]}
        selectedIds={new Set(["portfolio"])}
        onSelectedChange={() => {}}
        onStart={() => {}}
        onPause={onPause}
      />,
    );

    await user.click(screen.getByRole("button", { name: /pause portfolio/i }));

    expect(onPause).toHaveBeenCalledWith("portfolio");
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActivePanel } from "../../dashboard/src/ActivePanel.js";
import type { ActiveSlice, Project } from "../../dashboard/src/types.js";

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

const activeSlice: ActiveSlice = {
  issue: 11,
  phase: "tdd",
  branch: "issue-11",
  pr: 42,
  status: "active",
  startedAt: "2026-06-01T12:00:00.000Z",
};

describe("ActivePanel", () => {
  it("prompts to select a project when none is focused", () => {
    render(<ActivePanel project={null} active={null} />);

    expect(screen.getByText(/select a project/i)).toBeInTheDocument();
  });

  it("shows idle when the project has no active slice", () => {
    render(<ActivePanel project={portfolio} active={null} />);

    expect(screen.getByText(/no active slice/i)).toBeInTheDocument();
  });

  it("renders active slice details including PR link and startedAt", () => {
    render(<ActivePanel project={portfolio} active={activeSlice} />);

    expect(screen.getByText(/#11/)).toBeInTheDocument();
    expect(screen.getByText(/tdd/i)).toBeInTheDocument();
    expect(screen.getByText(/issue-11/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /#42/i })).toHaveAttribute(
      "href",
      "https://github.com/HaDuve/Portfolio/pull/42",
    );
    expect(screen.getByText(/2026-06-01/i)).toBeInTheDocument();
  });
});

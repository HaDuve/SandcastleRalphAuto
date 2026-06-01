import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HistoryPanel } from "../../dashboard/src/HistoryPanel.js";
import type { HistoryEntry, Project } from "../../dashboard/src/types.js";

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

const mergedEntry: HistoryEntry = {
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
};

describe("HistoryPanel", () => {
  it("prompts to select a project when none is focused", () => {
    render(<HistoryPanel project={null} history={[]} />);

    expect(screen.getByText(/select a project/i)).toBeInTheDocument();
  });

  it("shows empty state when there is no archived history", () => {
    render(<HistoryPanel project={portfolio} history={[]} />);

    expect(screen.getByText(/no merged history/i)).toBeInTheDocument();
  });

  it("renders merged PRs with per-phase duration", () => {
    render(<HistoryPanel project={portfolio} history={[mergedEntry]} />);

    expect(screen.getByRole("link", { name: /#99/i })).toHaveAttribute(
      "href",
      "https://github.com/HaDuve/Portfolio/pull/99",
    );
    expect(screen.getByText(/issue #9/i)).toBeInTheDocument();
    expect(screen.getByText(/merge/i)).toBeInTheDocument();
    expect(screen.getByText(/1h/i)).toBeInTheDocument();
  });
});

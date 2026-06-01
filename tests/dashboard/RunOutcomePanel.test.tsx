import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RunOutcomePanel } from "../../dashboard/src/RunOutcomePanel.js";
import type { Project, RunOutcome } from "../../dashboard/src/types.js";

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

const blockedOutcome: RunOutcome = {
  outcome: "blocked",
  reason: "CI failed",
  phase: "review-pr",
  stoppedAt: "2026-06-01T12:00:00.000Z",
};

describe("RunOutcomePanel", () => {
  it("prompts to select a project when none is focused", () => {
    render(<RunOutcomePanel project={null} lastOutcome={null} />);

    expect(screen.getByText(/select a project/i)).toBeInTheDocument();
  });

  it("shows idle when the project has no recorded run outcome", () => {
    render(<RunOutcomePanel project={portfolio} lastOutcome={null} />);

    expect(screen.getByText(/no run outcome recorded/i)).toBeInTheDocument();
  });

  it("surfaces the last run outcome for the focused project", () => {
    render(<RunOutcomePanel project={portfolio} lastOutcome={blockedOutcome} />);

    expect(screen.getByText(/blocked/i)).toBeInTheDocument();
    expect(screen.getByText(/CI failed/i)).toBeInTheDocument();
    expect(screen.getByText(/review-pr/i)).toBeInTheDocument();
    expect(screen.getByText(/2026-06-01/i)).toBeInTheDocument();
  });
});

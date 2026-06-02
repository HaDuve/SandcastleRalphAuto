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
    render(<RunOutcomePanel project={null} lastOutcome={null} workerStatus={null} />);

    expect(screen.getByText(/select a project/i)).toBeInTheDocument();
  });

  it("shows idle when the project has no recorded run outcome", () => {
    render(<RunOutcomePanel project={portfolio} lastOutcome={null} workerStatus="idle" />);

    expect(screen.getByText(/no run outcome recorded/i)).toBeInTheDocument();
  });

  it('shows running when the worker is running and there is no terminal outcome yet', () => {
    render(<RunOutcomePanel project={portfolio} lastOutcome={null} workerStatus="running" />);

    expect(screen.getByText(/running…/i)).toBeInTheDocument();
  });

  it('shows running when the worker is paused and there is no terminal outcome yet', () => {
    render(<RunOutcomePanel project={portfolio} lastOutcome={null} workerStatus="paused" />);

    expect(screen.getByText(/running…/i)).toBeInTheDocument();
  });

  it("surfaces the last run outcome for the focused project", () => {
    render(<RunOutcomePanel project={portfolio} lastOutcome={blockedOutcome} workerStatus="idle" />);

    expect(screen.getByRole("status")).toHaveClass("run-outcome-banner--blocked");
    expect(screen.getByText(/blocked/i)).toBeInTheDocument();
    expect(screen.getByText(/CI failed/i)).toBeInTheDocument();
    expect(screen.getByText("review-pr", { selector: ".run-outcome-banner-phase" })).toBeInTheDocument();
  });

  it("links to the phase log endpoint for the stopped phase", () => {
    render(<RunOutcomePanel project={portfolio} lastOutcome={blockedOutcome} workerStatus="idle" />);

    const logLink = screen.getByRole("link", { name: /review-pr log/i });
    expect(logLink).toHaveAttribute(
      "href",
      "/api/projects/portfolio/log?phase=review-pr",
    );
  });

  it.each([
    {
      label: "queue-empty",
      lastOutcome: {
        outcome: "queue-empty" as const,
        stoppedAt: "2026-06-01T12:00:00.000Z",
      },
      className: "run-outcome-banner--queue-empty",
      text: /queue empty/i,
    },
    {
      label: "awaiting-human",
      lastOutcome: {
        outcome: "awaiting-human" as const,
        reason: "Needs approval",
        phase: "merge",
        stoppedAt: "2026-06-01T12:00:00.000Z",
      },
      className: "run-outcome-banner--awaiting-human",
      text: /awaiting human/i,
      logHref: "/api/projects/portfolio/log?phase=merge",
    },
    {
      label: "killed",
      lastOutcome: {
        outcome: "killed" as const,
        stoppedAt: "2026-06-01T12:00:00.000Z",
      },
      className: "run-outcome-banner--killed",
      text: /killed/i,
    },
  ])("renders a $label outcome banner", ({ lastOutcome, className, text, logHref }) => {
    render(<RunOutcomePanel project={portfolio} lastOutcome={lastOutcome} workerStatus="idle" />);

    expect(screen.getByRole("status")).toHaveClass(className);
    expect(screen.getByText(text)).toBeInTheDocument();
    if (logHref) {
      expect(screen.getByRole("link", { name: /merge log/i })).toHaveAttribute("href", logHref);
    }
  });

  it('shows crash copy with a log link instead of the raw error reason', () => {
    const errorOutcome: RunOutcome = {
      outcome: "error",
      reason: "TypeError: Cannot read properties of undefined (reading 'map')",
      phase: "tdd",
      stoppedAt: "2026-06-01T12:00:00.000Z",
    };
    render(<RunOutcomePanel project={portfolio} lastOutcome={errorOutcome} workerStatus="idle" />);

    expect(screen.getByText(/run crashed/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /see log/i })).toBeInTheDocument();
    expect(
      screen.queryByText(/Cannot read properties of undefined/i),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /see log/i })).toHaveAttribute(
      "href",
      "/api/projects/portfolio/log?phase=tdd",
    );
  });
});

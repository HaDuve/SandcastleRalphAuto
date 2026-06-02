import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PhaseStepper } from "../../dashboard/src/PhaseStepper.js";
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

describe("PhaseStepper", () => {
  it("prompts to select a project when none is focused", () => {
    render(<PhaseStepper project={null} summary={null} currentPhase={null} />);

    expect(screen.getByText(/select a project/i)).toBeInTheDocument();
  });

  it("marks the current phase in the horizontal stepper", () => {
    render(
      <PhaseStepper
        project={portfolio}
        summary={{ issue: 12, phase: "merge", status: "active" }}
        currentPhase="merge"
      />,
    );

    const current = screen.getByRole("listitem", { current: "step" });
    expect(current).toHaveTextContent("merge");
    expect(screen.getByRole("listitem", { name: /^tdd/ })).toHaveAttribute(
      "data-state",
      "done",
    );
    expect(screen.getByRole("listitem", { name: /^next/ })).toHaveAttribute(
      "data-state",
      "pending",
    );
  });

  it("shows issue title and identity links when available", () => {
    render(
      <PhaseStepper
        project={portfolio}
        summary={{
          issue: 95,
          title: "Phase stepper identity",
          phase: "tdd",
          status: "active",
          branch: "issue-95",
          pr: 42,
          startedAt: "2026-06-01T12:00:00.000Z",
        }}
        currentPhase="tdd"
      />,
    );

    expect(screen.getByRole("link", { name: /#95/i })).toHaveAttribute(
      "href",
      "https://github.com/HaDuve/Portfolio/issues/95",
    );
    expect(screen.getByRole("link", { name: /pr #42/i })).toHaveAttribute(
      "href",
      "https://github.com/HaDuve/Portfolio/pull/42",
    );
    expect(screen.getByText(/issue-95/)).toBeInTheDocument();
    expect(screen.getByText(/2026-06-01/)).toBeInTheDocument();
    expect(screen.queryByText(/T12:00:00\.000Z/)).toBeNull();
  });
});

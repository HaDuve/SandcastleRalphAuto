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
    render(<PhaseStepper project={null} currentPhase={null} />);

    expect(screen.getByText(/select a project/i)).toBeInTheDocument();
  });

  it("marks the current phase in the horizontal stepper", () => {
    render(<PhaseStepper project={portfolio} currentPhase="merge" />);

    const current = screen.getByRole("listitem", { current: "step" });
    expect(current).toHaveTextContent("merge");
    expect(screen.getByRole("listitem", { name: /^tdd/ })).toHaveAttribute("data-state", "done");
    expect(screen.getByRole("listitem", { name: /^next/ })).toHaveAttribute("data-state", "pending");
  });
});

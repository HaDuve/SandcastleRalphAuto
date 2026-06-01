import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QueuePanel } from "../../dashboard/src/QueuePanel.js";
import type { Project, QueueIssue } from "../../dashboard/src/types.js";

const portfolio: Project = {
  id: "portfolio",
  path: "/tmp/portfolio",
  remote: "HaDuve/Portfolio",
  defaultBase: "main",
  afkLabel: "ready-for-agent",
  blockedLabels: ["needs-info"],
  autoMerge: true,
  concurrency: "single",
  sandbox: "none",
};

const sampleQueue: QueueIssue[] = [
  { number: 10, labels: ["ready-for-agent"], skipped: false, eligible: true },
  {
    number: 12,
    labels: ["ready-for-agent", "needs-info"],
    skipped: false,
    eligible: false,
  },
  { number: 15, labels: ["ready-for-agent"], skipped: true, eligible: false },
];

describe("QueuePanel", () => {
  it("prompts to select a project when none is focused", () => {
    render(<QueuePanel project={null} queue={[]} onSkipToggle={() => {}} />);

    expect(screen.getByText(/select a project/i)).toBeInTheDocument();
  });

  it("renders eligible and excluded issues with exclusion reasons", () => {
    render(
      <QueuePanel project={portfolio} queue={sampleQueue} onSkipToggle={() => {}} />,
    );

    expect(screen.getByText(/#10/)).toBeInTheDocument();
    expect(screen.getByText(/Blocked: needs-info/i)).toBeInTheDocument();
    expect(screen.getByText(/skipped by operator/i)).toBeInTheDocument();
  });

  it("calls onSkipToggle when the skip checkbox changes", async () => {
    const onSkipToggle = vi.fn();
    const user = userEvent.setup();

    render(
      <QueuePanel
        project={portfolio}
        queue={[sampleQueue[0]!]}
        onSkipToggle={onSkipToggle}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: /skip issue 10/i }));

    expect(onSkipToggle).toHaveBeenCalledWith(10, true);
  });
});

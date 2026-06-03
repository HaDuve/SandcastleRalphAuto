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
  {
    number: 10,
    title: "Add dashboard links",
    labels: ["ready-for-agent"],
    skipped: false,
    eligible: true,
  },
  {
    number: 12,
    title: "Blocked feature",
    labels: ["ready-for-agent", "needs-info"],
    skipped: false,
    eligible: false,
  },
  {
    number: 15,
    title: "Skipped by operator",
    labels: ["ready-for-agent"],
    skipped: true,
    eligible: false,
  },
];

describe("QueuePanel", () => {
  it("prompts to select a project when none is focused", () => {
    render(<QueuePanel project={null} queue={[]} onSkipToggle={() => {}} />);

    expect(screen.getByText(/select a project/i)).toBeInTheDocument();
  });

  it("links the Queue header to the repo GitHub issues page", () => {
    render(
      <QueuePanel project={portfolio} queue={sampleQueue} onSkipToggle={() => {}} />,
    );

    const headerLink = screen.getByRole("link", { name: /issues on github/i });
    expect(headerLink).toHaveAttribute(
      "href",
      "https://github.com/HaDuve/Portfolio/issues",
    );
    expect(headerLink).toHaveAttribute("target", "_blank");
  });

  it("renders GitHub issue links with titles and status markers", () => {
    render(
      <QueuePanel project={portfolio} queue={sampleQueue} onSkipToggle={() => {}} />,
    );

    const eligibleLink = screen.getByRole("link", { name: "Add dashboard links" });
    expect(eligibleLink).toHaveAttribute(
      "href",
      "https://github.com/HaDuve/Portfolio/issues/10",
    );
    expect(eligibleLink).toHaveAttribute("target", "_blank");
    expect(eligibleLink.closest("li")?.textContent ?? "").not.toMatch(/❌/);

    const blockedLink = screen.getByRole("link", { name: "Blocked feature" });
    expect(blockedLink).toHaveAttribute(
      "href",
      "https://github.com/HaDuve/Portfolio/issues/12",
    );
    expect(blockedLink.closest("li")?.querySelector(".queue-item-marker")).toHaveTextContent(
      "❌",
    );
    expect(screen.getByText(/Blocked: needs-info/i)).toBeInTheDocument();

    const skippedLink = screen.getByRole("link", { name: "Skipped by operator" });
    expect(skippedLink).toHaveAttribute(
      "href",
      "https://github.com/HaDuve/Portfolio/issues/15",
    );
    expect(skippedLink.closest("li")?.querySelector(".queue-item-marker")).toHaveTextContent(
      "❌",
    );
    expect(skippedLink.closest("li")?.querySelector(".queue-item-reason")).toHaveTextContent(
      "Skipped by operator",
    );
  });

  it("calls onSkipToggle when the skip checkbox changes", async () => {
    const onSkipToggle = vi.fn();
    const user = userEvent.setup();

    render(
      <QueuePanel
        project={portfolio}
        queue={[
          {
            number: 10,
            title: "Add dashboard links",
            labels: ["ready-for-agent"],
            skipped: false,
            eligible: true,
          },
        ]}
        onSkipToggle={onSkipToggle}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: /skip issue 10/i }));

    expect(onSkipToggle).toHaveBeenCalledWith(10, true);
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FocusedHeaderLine } from "../../dashboard/src/FocusedHeaderLine.js";
import type { FocusedStatus } from "../../dashboard/src/focusedHeaderStatus.js";

const baseLine: FocusedStatus = {
  message: null,
  id: "portfolio",
  remote: "HaDuve/Portfolio",
  path: "/tmp/portfolio",
  worker: "running",
  phase: "tdd",
  issue: 11,
  pr: 42,
  outcome: null,
  reason: null,
  sinceStop: null,
  phaseElapsed: "12m",
};

describe("FocusedHeaderLine", () => {
  it("renders the empty state message", () => {
    render(
      <FocusedHeaderLine
        status={{
          message: "No project selected",
          id: null,
          remote: null,
          path: null,
          worker: null,
          phase: null,
          issue: null,
          pr: null,
          outcome: null,
          reason: null,
          sinceStop: null,
          phaseElapsed: null,
        }}
      />,
    );

    expect(screen.getByText("No project selected")).toBeTruthy();
  });

  it("renders connecting state message", () => {
    render(
      <FocusedHeaderLine
        status={{
          ...baseLine,
          message: "Connecting…",
          worker: null,
          phase: null,
          issue: null,
          pr: null,
          phaseElapsed: null,
        }}
      />,
    );

    expect(screen.getByText("Connecting…")).toBeTruthy();
  });

  it("links id, remote, issue, and PR with GitHub opening in a new tab", () => {
    render(<FocusedHeaderLine status={baseLine} />);

    const idLink = screen.getByRole("link", { name: "portfolio" });
    expect(idLink.getAttribute("href")).toBe("cursor://file//tmp/portfolio");

    const remoteLink = screen.getByRole("link", { name: "HaDuve/Por..." });
    expect(remoteLink.getAttribute("href")).toBe("https://github.com/HaDuve/Portfolio");
    expect(remoteLink.getAttribute("target")).toBe("_blank");

    const issueLink = screen.getByRole("link", { name: "#11" });
    expect(issueLink.getAttribute("href")).toBe("https://github.com/HaDuve/Portfolio/issues/11");
    expect(issueLink.getAttribute("target")).toBe("_blank");

    const prLink = screen.getByRole("link", { name: "PR #42" });
    expect(prLink.getAttribute("href")).toBe("https://github.com/HaDuve/Portfolio/pull/42");
    expect(prLink.getAttribute("target")).toBe("_blank");
  });

  it("appends run outcome and stopped duration when idle", () => {
    render(
      <FocusedHeaderLine
        status={{
          ...baseLine,
          worker: "idle",
          phase: null,
          pr: null,
          phaseElapsed: null,
          outcome: "Blocked",
          reason: "CI failing",
          sinceStop: "15m ago",
        }}
      />,
    );

    expect(screen.getByText(/Blocked — CI failing/)).toBeTruthy();
    expect(screen.getByText(/stopped 15m ago/)).toBeTruthy();
  });
});

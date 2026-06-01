import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardLayout } from "../../dashboard/src/DashboardLayout.js";

describe("DashboardLayout", () => {
  it("exposes shell regions for queue, active, stream, and history", () => {
    render(
      <DashboardLayout
        picker={<div>picker</div>}
        queue={<div>queue body</div>}
        active={<div>active body</div>}
        stream={<div>stream body</div>}
        history={<div>history body</div>}
      />,
    );

    expect(screen.getByRole("region", { name: /queue/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /active/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /stream/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /history/i })).toBeInTheDocument();
  });
});

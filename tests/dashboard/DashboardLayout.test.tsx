import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardLayout } from "../../dashboard/src/DashboardLayout.js";

describe("DashboardLayout", () => {
  it("orders focused-project regions banner, stepper, active, log, queue, then history", () => {
    render(
      <DashboardLayout
        picker={<div>picker</div>}
        runOutcome={<div>banner</div>}
        phaseStepper={<div>stepper</div>}
        active={<div>active body</div>}
        log={<div>log body</div>}
        queue={<div>queue body</div>}
        history={<div>history body</div>}
      />,
    );

    const regions = within(screen.getByRole("main")).getAllByRole("region");
    expect(regions.map((region) => region.getAttribute("aria-label"))).toEqual([
      "Run outcome",
      "Phase stepper",
      "Active",
      "Log",
      "Queue",
      "History",
    ]);
  });
});

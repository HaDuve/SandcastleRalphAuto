import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardLayout } from "../../dashboard/src/DashboardLayout.js";

describe("DashboardLayout", () => {
  it("orders focused-project regions banner, stepper, log, queue, then history", () => {
    render(
      <DashboardLayout
        picker={<div>picker</div>}
        runOutcome={<div>banner</div>}
        phaseStepper={<div>stepper</div>}
        log={<div>log body</div>}
        queue={<div>queue body</div>}
        history={<div>history body</div>}
      />,
    );

    const regions = within(screen.getByRole("main")).getAllByRole("region");
    expect(regions.map((region) => region.getAttribute("aria-label"))).toEqual([
      "Run outcome",
      "Phase stepper",
      "Log",
      "Queue",
      "History",
    ]);
  });
});

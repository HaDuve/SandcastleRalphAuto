import { describe, expect, it } from "vitest";
import { formatProjectStatusIndicator } from "../../dashboard/src/projectStatus.js";
import type { ProjectActiveSummary } from "../../dashboard/src/types.js";
import type { WorkerStatus } from "../../dashboard/src/workerStatus.js";

const active: ProjectActiveSummary = {
  issue: 11,
  phase: "review-pr",
  status: "active",
};

describe("formatProjectStatusIndicator", () => {
  it("shows idle when the worker is idle and there is no blocked slice", () => {
    expect(formatProjectStatusIndicator("idle", null)).toBe("idle");
  });

  it("shows running with the current phase when the worker is running", () => {
    expect(formatProjectStatusIndicator("running", active)).toBe("running · review-pr");
  });

  it("shows paused when the worker is paused", () => {
    expect(formatProjectStatusIndicator("paused", active)).toBe("paused");
  });

  it("shows blocked when the active slice is blocked", () => {
    expect(
      formatProjectStatusIndicator("idle", { ...active, status: "blocked" }),
    ).toBe("blocked");
  });

  it("shows running with babysit when the recovery phase is active", () => {
    expect(
      formatProjectStatusIndicator("running", { ...active, phase: "babysit" }),
    ).toBe("running · babysit");
  });
});

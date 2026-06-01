import { describe, expect, it } from "vitest";
import { formatPhaseDuration } from "../../dashboard/src/phaseDuration.js";

describe("formatPhaseDuration", () => {
  it("formats sub-minute durations", () => {
    expect(
      formatPhaseDuration("2026-06-01T00:00:00.000Z", "2026-06-01T00:00:30.000Z"),
    ).toBe("<1m");
  });

  it("formats minute-only durations", () => {
    expect(
      formatPhaseDuration("2026-06-01T00:00:00.000Z", "2026-06-01T00:45:00.000Z"),
    ).toBe("45m");
  });

  it("formats hour-only durations", () => {
    expect(
      formatPhaseDuration("2026-06-01T00:00:00.000Z", "2026-06-01T01:00:00.000Z"),
    ).toBe("1h");
  });

  it("formats mixed hour and minute durations", () => {
    expect(
      formatPhaseDuration("2026-06-01T00:00:00.000Z", "2026-06-01T01:30:00.000Z"),
    ).toBe("1h 30m");
  });

  it("returns em dash for invalid or negative ranges", () => {
    expect(formatPhaseDuration("not-a-date", "2026-06-01T01:00:00.000Z")).toBe("—");
    expect(
      formatPhaseDuration("2026-06-01T02:00:00.000Z", "2026-06-01T01:00:00.000Z"),
    ).toBe("—");
  });
});

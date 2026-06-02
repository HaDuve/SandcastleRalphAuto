import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNow } from "../../dashboard/src/useNow.js";

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the current time and ticks on the default interval", () => {
    const { result } = renderHook(() => useNow());

    expect(result.current).toBe("2026-06-01T00:00:00.000Z");

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(result.current).toBe("2026-06-01T00:00:10.000Z");
  });

  it("respects a custom interval", () => {
    const { result } = renderHook(() => useNow(5000));

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(result.current).toBe("2026-06-01T00:00:05.000Z");
  });
});

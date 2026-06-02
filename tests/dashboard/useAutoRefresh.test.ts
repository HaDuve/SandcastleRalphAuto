import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoRefresh } from "../../dashboard/src/useAutoRefresh.js";

type VisibilityDocument = {
  visibilityState: string;
  dispatchEvent: (event: Event) => boolean;
};

function testDocument(): VisibilityDocument {
  return (globalThis as unknown as { document: VisibilityDocument }).document;
}

describe("useAutoRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(testDocument(), "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not poll when disabled", () => {
    const onRefresh = vi.fn();
    renderHook(() =>
      useAutoRefresh({
        enabled: false,
        intervalMs: 30_000,
        onRefresh,
      }),
    );

    act(() => {
      vi.advanceTimersByTime(90_000);
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("refreshes on the interval while the tab is visible", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    renderHook(() =>
      useAutoRefresh({
        enabled: true,
        intervalMs: 30_000,
        onRefresh,
      }),
    );

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it("pauses while hidden and resumes on visible", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    renderHook(() =>
      useAutoRefresh({
        enabled: true,
        intervalMs: 30_000,
        onRefresh,
      }),
    );

    act(() => {
      Object.defineProperty(testDocument(), "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      testDocument().dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(60_000);
    });
    expect(onRefresh).not.toHaveBeenCalled();

    act(() => {
      Object.defineProperty(testDocument(), "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      testDocument().dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(onRefresh).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("runs an immediate refresh on unhide when the last refresh was more than 30s ago", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    renderHook(() =>
      useAutoRefresh({
        enabled: true,
        intervalMs: 30_000,
        onRefresh,
      }),
    );

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    act(() => {
      Object.defineProperty(testDocument(), "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      testDocument().dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(45_000);
    });

    act(() => {
      Object.defineProperty(testDocument(), "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      testDocument().dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it("clears the interval when disabled", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ enabled }) =>
        useAutoRefresh({
          enabled,
          intervalMs: 30_000,
          onRefresh,
        }),
      { initialProps: { enabled: true } },
    );

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    rerender({ enabled: false });

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

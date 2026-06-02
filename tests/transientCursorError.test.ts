import { describe, expect, it } from "vitest";
import {
  DEFAULT_CURSOR_TRANSIENT_BASE_DELAY_MS,
  DEFAULT_CURSOR_TRANSIENT_MAX_DELAY_MS,
  DEFAULT_CURSOR_TRANSIENT_JITTER_RATIO,
  formatTransientCursorExhaustedMessage,
  isTransientCursorError,
  isTransientCursorErrorMessage,
  isTransientCursorRetriesExhaustedMessage,
  jitterDelayMs,
  transientCursorBackoffDelayMs,
} from "../src/runner/transientCursorError.js";

describe("transientCursorError", () => {
  it("detects resource_exhausted variants", () => {
    expect(
      isTransientCursorErrorMessage(
        "cursor exited with code 1:\nT: [resource_exhausted] Error\n",
      ),
    ).toBe(true);
    expect(isTransientCursorErrorMessage('{"error":"ERROR_RESOURCE_EXHAUSTED"}')).toBe(
      true,
    );
    expect(isTransientCursorErrorMessage("Phase did not emit PHASE_COMPLETE")).toBe(
      false,
    );
    expect(
      isTransientCursorError(
        new Error("cursor exited with code 1:\nT: [resource_exhausted] Error\n"),
      ),
    ).toBe(true);
  });

  it("uses exponential backoff capped at max delay", () => {
    expect(transientCursorBackoffDelayMs(1)).toBe(0);
    expect(transientCursorBackoffDelayMs(2)).toBe(DEFAULT_CURSOR_TRANSIENT_BASE_DELAY_MS);
    expect(transientCursorBackoffDelayMs(3)).toBe(
      DEFAULT_CURSOR_TRANSIENT_BASE_DELAY_MS * 2,
    );
    expect(transientCursorBackoffDelayMs(3, 1_000, 1_500)).toBe(1_500);
    expect(transientCursorBackoffDelayMs(10, 5_000, DEFAULT_CURSOR_TRANSIENT_MAX_DELAY_MS)).toBe(
      DEFAULT_CURSOR_TRANSIENT_MAX_DELAY_MS,
    );
  });

  it("formats exhausted retry message", () => {
    expect(
      formatTransientCursorExhaustedMessage("cursor exited with code 1", 5),
    ).toContain("exhausted 5 Sandcastle attempts");
    expect(
      isTransientCursorRetriesExhaustedMessage(
        formatTransientCursorExhaustedMessage("cursor exited with code 1", 5),
      ),
    ).toBe(true);
  });

  it("applies jitter deterministically when rng is provided", () => {
    expect(jitterDelayMs(1000, 0, () => 0.5)).toBe(1000);
    expect(jitterDelayMs(1000, DEFAULT_CURSOR_TRANSIENT_JITTER_RATIO, () => 0)).toBe(
      800,
    );
    expect(jitterDelayMs(1000, DEFAULT_CURSOR_TRANSIENT_JITTER_RATIO, () => 1)).toBe(
      1200,
    );
  });
});

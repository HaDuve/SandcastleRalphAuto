import { describe, expect, it } from "vitest";
import { appendLogChunk, lastLines, scrollLogBodyToTail } from "../../dashboard/src/logLines.js";

describe("logLines", () => {
  it("returns the last N non-empty trailing lines", () => {
    const text = "a\nb\nc\nd\ne\nf\ng\n";
    expect(lastLines(text, 5)).toBe("c\nd\ne\nf\ng");
  });

  it("appends SSE chunks to existing log text", () => {
    expect(appendLogChunk("seed\n", "live")).toBe("seed\nlive");
  });

  it("sets scrollTop to scrollHeight for tail anchoring", () => {
    const element = { scrollTop: 0, scrollHeight: 320 };
    scrollLogBodyToTail(element);
    expect(element.scrollTop).toBe(320);
  });
});

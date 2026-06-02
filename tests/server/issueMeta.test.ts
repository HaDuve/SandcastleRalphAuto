import { describe, expect, it } from "vitest";
import { fetchGhIssueMeta } from "../../src/server/issueMeta.js";

describe("fetchGhIssueMeta", () => {
  it("returns the issue title from gh issue view", async () => {
    const meta = await fetchGhIssueMeta(
      async () => JSON.stringify({ title: "Phase stepper identity" }),
      "HaDuve/Portfolio",
      95,
    );

    expect(meta).toEqual({ title: "Phase stepper identity" });
  });

  it("returns null when gh output is not valid JSON", async () => {
    await expect(
      fetchGhIssueMeta(async () => "not json", "HaDuve/Portfolio", 1),
    ).resolves.toBeNull();
  });
});

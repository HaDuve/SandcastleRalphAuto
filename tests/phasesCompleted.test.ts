import { describe, expect, it } from "vitest";
import { phasesCompletedThroughCreatePr } from "../src/pipeline/phasesCompleted.js";

describe("phasesCompletedThroughCreatePr", () => {
  it("includes tdd and create-pr for a full slice", () => {
    expect(phasesCompletedThroughCreatePr()).toEqual(["tdd", "create-pr"]);
  });

  it("includes only create-pr when resuming at create-pr", () => {
    expect(phasesCompletedThroughCreatePr("create-pr")).toEqual(["create-pr"]);
  });
});

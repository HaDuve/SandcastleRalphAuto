import { describe, expect, it } from "vitest";
import { CliError, parseCliArgs } from "../src/cli/index.js";

describe("parseCliArgs", () => {
  it("parses run --project <id> --issue <n>", () => {
    expect(
      parseCliArgs(["run", "--project", "portfolio", "--issue", "10"]),
    ).toEqual({
      command: "run",
      projectId: "portfolio",
      issue: 10,
    });
  });

  it("parses loop --project <id> --issue <n>", () => {
    expect(
      parseCliArgs(["loop", "--project", "portfolio", "--issue", "10"]),
    ).toEqual({
      command: "loop",
      projectId: "portfolio",
      issue: 10,
    });
  });

  it("rejects invalid commands", () => {
    expect(() => parseCliArgs(["status"])).toThrow(CliError);
  });

  it("rejects non-numeric issue numbers", () => {
    expect(() =>
      parseCliArgs(["run", "--project", "portfolio", "--issue", "abc"]),
    ).toThrow(/Invalid issue number/);
  });
});

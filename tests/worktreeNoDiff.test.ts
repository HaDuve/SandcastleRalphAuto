import { describe, expect, it } from "vitest";
import {
  worktreeHasNoDiffVsOriginMain,
  type GitRunner,
} from "../src/handoff/worktreeNoDiff.js";

describe("worktreeHasNoDiffVsOriginMain", () => {
  it("returns true when there are zero commits and no tree diff vs origin/main", async () => {
    const git: GitRunner = async (args) => {
      if (args[0] === "rev-list") {
        return { stdout: "0\n", exitCode: 0 };
      }
      if (args[0] === "diff") {
        return { stdout: "", exitCode: 0 };
      }
      return { stdout: "", exitCode: 1 };
    };

    expect(await worktreeHasNoDiffVsOriginMain("/tmp/worktree", git)).toBe(true);
  });

  it("returns false when the branch has commits ahead of origin/main", async () => {
    const git: GitRunner = async (args) => {
      if (args[0] === "rev-list") {
        return { stdout: "2\n", exitCode: 0 };
      }
      return { stdout: "", exitCode: 0 };
    };

    expect(await worktreeHasNoDiffVsOriginMain("/tmp/worktree", git)).toBe(
      false,
    );
  });
});

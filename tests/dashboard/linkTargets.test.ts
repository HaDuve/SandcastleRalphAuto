import { describe, expect, it } from "vitest";
import {
  cursorWorkspaceLink,
  githubIssueUrl,
  githubPrUrl,
  githubRepoUrl,
  truncateRemote,
} from "../../dashboard/src/linkTargets.js";

describe("linkTargets", () => {
  describe("githubRepoUrl", () => {
    it("builds the repo root URL", () => {
      expect(githubRepoUrl("HaDuve/Portfolio")).toBe("https://github.com/HaDuve/Portfolio");
    });
  });

  describe("githubIssueUrl", () => {
    it("builds the issue URL", () => {
      expect(githubIssueUrl("HaDuve/Portfolio", 42)).toBe(
        "https://github.com/HaDuve/Portfolio/issues/42",
      );
    });
  });

  describe("githubPrUrl", () => {
    it("builds the pull request URL", () => {
      expect(githubPrUrl("HaDuve/Portfolio", 7)).toBe(
        "https://github.com/HaDuve/Portfolio/pull/7",
      );
    });
  });

  describe("truncateRemote", () => {
    it("leaves remotes at or below max length unchanged", () => {
      expect(truncateRemote("HaDuve/Po", 10)).toBe("HaDuve/Po");
      expect(truncateRemote("1234567890", 10)).toBe("1234567890");
    });

    it("truncates remotes longer than max to max chars plus ellipsis", () => {
      expect(truncateRemote("12345678901", 10)).toBe("1234567890...");
    });
  });

  describe("cursorWorkspaceLink", () => {
    it("builds a cursor file URL for the workspace path", () => {
      expect(cursorWorkspaceLink("/tmp/my project")).toBe("cursor://file//tmp/my project");
    });
  });
});

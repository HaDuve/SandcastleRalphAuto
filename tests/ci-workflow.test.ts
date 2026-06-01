import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = resolve(".github/workflows/ci.yml");

function workflowContent(): string {
  return readFileSync(WORKFLOW_PATH, "utf8");
}

function ciJobBody(content: string): string {
  const match = content.match(/^  ci:\n([\s\S]*?)(?=^\S|\s*$)/m);
  if (!match) {
    throw new Error("missing job ci");
  }
  return match[1];
}

describe("CI workflow contract", () => {
  it("exists at .github/workflows/ci.yml", () => {
    expect(existsSync(WORKFLOW_PATH)).toBe(true);
  });

  it("triggers on pull_request and push to main", () => {
    const content = workflowContent();
    expect(content).toContain("pull_request:");
    expect(content).toMatch(/push:[\s\S]*?branches:[\s\S]*?- main/);
  });

  it("defines job ci without a job-level name override", () => {
    const jobBody = ciJobBody(workflowContent());
    expect(jobBody).not.toMatch(/^\s+name:\s/m);
    expect(jobBody).toContain("runs-on:");
  });

  it("checks out the repository before installing dependencies", () => {
    const content = workflowContent();
    expect(content).toContain("actions/checkout@v4");
    expect(content.indexOf("actions/checkout@v4")).toBeLessThan(
      content.indexOf("actions/setup-node@v4"),
    );
  });

  it("installs node 22 and runs typecheck, test, and dashboard build", () => {
    const content = workflowContent();
    expect(content).toContain("actions/setup-node@v4");
    expect(content).toContain("node-version: 22");
    expect(content).toContain("cache: npm");
    expect(content).toContain("npm ci");
    expect(content).toContain("npm run typecheck");
    expect(content).toContain("npm test");
    expect(content).toContain("npm run build:dashboard");
  });

  it("fails the job when typecheck or test steps exit non-zero", () => {
    const jobBody = ciJobBody(workflowContent());
    expect(jobBody).not.toContain("continue-on-error: true");
  });
});

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadRegistry, RegistryError, checkGhAuth } from "../src/registry/index.js";

describe("loadRegistry", () => {
  let tempDir: string;

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  async function writeConfig(body: unknown): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "registry-test-"));
    const configPath = join(tempDir, "projects.json");
    await writeFile(configPath, JSON.stringify(body, null, 2));
    return configPath;
  }

  const validProject = {
    id: "portfolio",
    path: "/Users/dev/Portfolio",
    remote: "HaDuve/Portfolio",
    defaultBase: "main",
    afkLabel: "ready-for-agent",
    blockedLabels: ["needs-info", "ready-for-human"],
  };

  const defaultDeps = {
    pathExists: () => true,
    checkGhAuth: async () => {},
  };

  it("loads a valid projects.json and applies default fields", async () => {
    const configPath = await writeConfig({ projects: [validProject] });

    const projects = await loadRegistry({
      configPath,
      ...defaultDeps,
    });

    expect(projects).toHaveLength(1);
    expect(projects[0]).toEqual({
      ...validProject,
      autoMerge: true,
      concurrency: "single",
      sandbox: "none",
    });
  });

  it("rejects invalid config with a clear RegistryError", async () => {
    const configPath = await writeConfig({
      projects: [{ ...validProject, remote: "not-a-valid-remote" }],
    });

    await expect(
      loadRegistry({ configPath, ...defaultDeps }),
    ).rejects.toThrow(RegistryError);

    await expect(
      loadRegistry({ configPath, ...defaultDeps }),
    ).rejects.toThrow(/remote must be owner\/repo/);
  });

  it("rejects when a project path does not exist", async () => {
    const configPath = await writeConfig({ projects: [validProject] });

    await expect(
      loadRegistry({
        configPath,
        pathExists: (path) => path !== validProject.path,
        checkGhAuth: defaultDeps.checkGhAuth,
      }),
    ).rejects.toThrow(RegistryError);

    await expect(
      loadRegistry({
        configPath,
        pathExists: (path) => path !== validProject.path,
        checkGhAuth: defaultDeps.checkGhAuth,
      }),
    ).rejects.toThrow(/path does not exist/);
  });

  it("rejects when gh auth is not working", async () => {
    const configPath = await writeConfig({ projects: [validProject] });

    await expect(
      loadRegistry({
        configPath,
        ...defaultDeps,
        checkGhAuth: async () => {
          throw new RegistryError(
            "gh auth is not working. Run `gh auth login`.",
          );
        },
      }),
    ).rejects.toThrow(/gh auth is not working/);
  });

  it("uses default gh auth check when none is injected", async () => {
    await expect(
      checkGhAuth(async () => {
        throw new Error("not logged in");
      }),
    ).rejects.toThrow(/gh auth is not working/);

    await expect(
      checkGhAuth(async () => undefined),
    ).resolves.toBeUndefined();
  });

  it("preserves explicit optional fields when provided", async () => {
    const configPath = await writeConfig({
      projects: [
        {
          ...validProject,
          autoMerge: false,
          concurrency: "single",
          sandbox: "none",
        },
      ],
    });

    const projects = await loadRegistry({ configPath, ...defaultDeps });

    expect(projects[0]?.autoMerge).toBe(false);
    expect(projects[0]?.concurrency).toBe("single");
    expect(projects[0]?.sandbox).toBe("none");
  });

  it("rejects config missing required fields", async () => {
    const configPath = await writeConfig({
      projects: [{ id: "portfolio", path: "/tmp/portfolio" }],
    });

    await expect(
      loadRegistry({ configPath, ...defaultDeps }),
    ).rejects.toThrow(RegistryError);
  });

  it("rejects malformed JSON", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "registry-test-"));
    const configPath = join(tempDir, "projects.json");
    await writeFile(configPath, "{ not json");

    await expect(
      loadRegistry({ configPath, ...defaultDeps }),
    ).rejects.toThrow(/Invalid JSON/);
  });
});

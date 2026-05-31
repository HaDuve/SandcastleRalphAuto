import { execFile } from "node:child_process";
import { accessSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ProjectsConfigSchema, type Project } from "./schema.js";

const execFileAsync = promisify(execFile);

export const PROJECTS_CONFIG_FILENAME = "projects.json";

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryError";
  }
}

export type GhAuthRunner = () => Promise<void>;

export async function checkGhAuth(
  run: GhAuthRunner = defaultGhAuthRunner,
): Promise<void> {
  try {
    await run();
  } catch {
    throw new RegistryError(
      "gh auth is not working. Run `gh auth login`.",
    );
  }
}

async function defaultGhAuthRunner(): Promise<void> {
  await execFileAsync("gh", ["auth", "status"]);
}

function assertProjectPathValid(
  project: { id: string; path: string },
  pathExists?: (path: string) => boolean,
): void {
  if (pathExists) {
    if (!pathExists(project.path)) {
      throw new RegistryError(
        `Project "${project.id}" path does not exist: ${project.path}`,
      );
    }
    return;
  }

  try {
    accessSync(project.path);
  } catch {
    throw new RegistryError(
      `Project "${project.id}" path does not exist: ${project.path}`,
    );
  }

  if (!statSync(project.path).isDirectory()) {
    throw new RegistryError(
      `Project "${project.id}" path is not a directory: ${project.path}`,
    );
  }
}

export function resolveProjectsConfigPath(rootDir: string = process.cwd()): string {
  return join(rootDir, PROJECTS_CONFIG_FILENAME);
}

export type LoadRegistryOptions = {
  configPath: string;
  pathExists?: (path: string) => boolean;
  checkGhAuth?: () => Promise<void>;
};

export type LoadRegistryFromRootOptions = Omit<
  LoadRegistryOptions,
  "configPath"
>;

export async function loadRegistryFromRoot(
  rootDir: string = process.cwd(),
  options: LoadRegistryFromRootOptions = {},
): Promise<Project[]> {
  return loadRegistry({
    configPath: resolveProjectsConfigPath(rootDir),
    ...options,
  });
}

async function readConfigFile(configPath: string): Promise<string> {
  try {
    return await readFile(configPath, "utf8");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      throw new RegistryError(
        `Projects config not found: ${configPath}`,
      );
    }

    throw new RegistryError(
      `Cannot read projects config: ${configPath}`,
    );
  }
}

export async function loadRegistry(
  options: LoadRegistryOptions,
): Promise<Project[]> {
  const raw = await readConfigFile(options.configPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RegistryError(
      `Invalid JSON in projects config: ${options.configPath}`,
    );
  }

  const result = ProjectsConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new RegistryError(
      `Invalid projects config: ${result.error.message}`,
    );
  }

  const checkGhAuthFn = options.checkGhAuth ?? (() => checkGhAuth());

  for (const project of result.data.projects) {
    assertProjectPathValid(project, options.pathExists);
  }

  await checkGhAuthFn();

  return result.data.projects;
}

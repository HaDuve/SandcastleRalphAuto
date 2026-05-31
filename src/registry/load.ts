import { execFile } from "node:child_process";
import { accessSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { ProjectsConfigSchema, type Project } from "./schema.js";

const execFileAsync = promisify(execFile);

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

function defaultPathExists(path: string): boolean {
  try {
    accessSync(path);
    return true;
  } catch {
    return false;
  }
}

export type LoadRegistryOptions = {
  configPath: string;
  pathExists?: (path: string) => boolean;
  checkGhAuth?: () => Promise<void>;
};

export async function loadRegistry(
  options: LoadRegistryOptions,
): Promise<Project[]> {
  const raw = await readFile(options.configPath, "utf8");
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

  const pathExists = options.pathExists ?? defaultPathExists;
  const checkGhAuthFn = options.checkGhAuth ?? (() => checkGhAuth());

  for (const project of result.data.projects) {
    if (!pathExists(project.path)) {
      throw new RegistryError(
        `Project "${project.id}" path does not exist: ${project.path}`,
      );
    }
  }

  await checkGhAuthFn();

  return result.data.projects;
}

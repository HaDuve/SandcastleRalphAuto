import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { branchForIssue } from "../next/index.js";
import { RUNNABLE_PHASES, type RunnablePhase } from "../prompts/phases.js";
import { loadRegistryFromRoot, type Project } from "../registry/index.js";

export function sanitizeBranchForFilename(branch: string): string {
  return branch.replace(/[/\\:*?"<>|]/g, "-");
}

export function resolvePhaseLogPath(input: {
  projectPath: string;
  branch: string;
  phase: RunnablePhase;
}): string {
  const sanitizedBranch = sanitizeBranchForFilename(input.branch);
  return join(
    input.projectPath,
    ".sandcastle",
    "logs",
    `${sanitizedBranch}-${input.phase}.log`,
  );
}

export type ProjectLogChannel = RunnablePhase | "server";

export function resolveServerLogPath(input: {
  projectPath: string;
  branch: string;
}): string {
  const sanitizedBranch = sanitizeBranchForFilename(input.branch);
  return join(input.projectPath, ".sandcastle", "logs", `${sanitizedBranch}-server.log`);
}

async function resolveProjectByRemoteOrId(
  rootDir: string,
  projectId: string,
  deps: { loadRegistryFromRoot: typeof loadRegistryFromRoot },
): Promise<Project> {
  const projects = await deps.loadRegistryFromRoot(rootDir, {
    checkGhAuth: async () => {},
  });
  const byRemote = projects.find((p) => p.remote === projectId);
  if (byRemote) return byRemote;
  const byId = projects.find((p) => p.id === projectId);
  if (byId) return byId;
  throw new Error(`Unknown project: ${projectId}`);
}

export async function listPhaseLogs(
  projectId: string,
  issue: number,
  options: {
    rootDir?: string;
    accessFile?: (path: string) => Promise<void>;
    loadRegistryFromRoot?: typeof loadRegistryFromRoot;
  } = {},
): Promise<RunnablePhase[]> {
  const rootDir = options.rootDir ?? process.cwd();
  const accessFile = options.accessFile ?? (async (path: string) => access(path));
  const deps = {
    loadRegistryFromRoot: options.loadRegistryFromRoot ?? loadRegistryFromRoot,
  };

  const project = await resolveProjectByRemoteOrId(rootDir, projectId, deps);
  const branch = branchForIssue(issue);

  const phasesWithLogs: RunnablePhase[] = [];
  for (const phase of RUNNABLE_PHASES) {
    const path = resolvePhaseLogPath({
      projectPath: project.path,
      branch,
      phase,
    });
    try {
      await accessFile(path);
      phasesWithLogs.push(phase);
    } catch {
      // Missing log is normal; skip.
    }
  }

  return phasesWithLogs;
}

export async function listProjectLogs(
  projectId: string,
  issue: number,
  options: {
    rootDir?: string;
    accessFile?: (path: string) => Promise<void>;
    loadRegistryFromRoot?: typeof loadRegistryFromRoot;
  } = {},
): Promise<ProjectLogChannel[]> {
  const rootDir = options.rootDir ?? process.cwd();
  const accessFile = options.accessFile ?? (async (path: string) => access(path));
  const deps = {
    loadRegistryFromRoot: options.loadRegistryFromRoot ?? loadRegistryFromRoot,
  };

  const project = await resolveProjectByRemoteOrId(rootDir, projectId, deps);
  const branch = branchForIssue(issue);

  const channels: ProjectLogChannel[] = [];
  const serverPath = resolveServerLogPath({ projectPath: project.path, branch });
  try {
    await accessFile(serverPath);
    channels.push("server");
  } catch {
    // Missing log is normal; skip.
  }

  channels.push(...(await listPhaseLogs(projectId, issue, options)));
  return channels;
}

export async function readPhaseLog(
  projectId: string,
  issue: number,
  phase: RunnablePhase,
  options: {
    rootDir?: string;
    readTextFile?: (path: string) => Promise<string>;
    loadRegistryFromRoot?: typeof loadRegistryFromRoot;
  } = {},
): Promise<string | null> {
  const rootDir = options.rootDir ?? process.cwd();
  const readTextFile =
    options.readTextFile ?? (async (path: string) => readFile(path, "utf8"));
  const deps = {
    loadRegistryFromRoot: options.loadRegistryFromRoot ?? loadRegistryFromRoot,
  };

  const project = await resolveProjectByRemoteOrId(rootDir, projectId, deps);
  const branch = branchForIssue(issue);
  const path = resolvePhaseLogPath({ projectPath: project.path, branch, phase });

  try {
    return await readTextFile(path);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

export async function readProjectLog(
  projectId: string,
  issue: number,
  channel: ProjectLogChannel,
  options: {
    rootDir?: string;
    readTextFile?: (path: string) => Promise<string>;
    loadRegistryFromRoot?: typeof loadRegistryFromRoot;
  } = {},
): Promise<string | null> {
  if (channel !== "server") {
    return readPhaseLog(projectId, issue, channel, options);
  }

  const rootDir = options.rootDir ?? process.cwd();
  const readTextFile =
    options.readTextFile ?? (async (path: string) => readFile(path, "utf8"));
  const deps = {
    loadRegistryFromRoot: options.loadRegistryFromRoot ?? loadRegistryFromRoot,
  };

  const project = await resolveProjectByRemoteOrId(rootDir, projectId, deps);
  const branch = branchForIssue(issue);
  const path = resolveServerLogPath({ projectPath: project.path, branch });

  try {
    return await readTextFile(path);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}


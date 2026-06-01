import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { branchForIssue } from "../next/index.js";
import { CANONICAL_PHASES, type CanonicalPhase } from "../prompts/phases.js";
import { loadRegistryFromRoot, type Project } from "../registry/index.js";

export function sanitizeBranchForFilename(branch: string): string {
  return branch.replace(/[/\\:*?"<>|]/g, "-");
}

export function resolvePhaseLogPath(input: {
  projectPath: string;
  branch: string;
  phase: CanonicalPhase;
}): string {
  const sanitizedBranch = sanitizeBranchForFilename(input.branch);
  return join(
    input.projectPath,
    ".sandcastle",
    "logs",
    `${sanitizedBranch}-${input.phase}.log`,
  );
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
): Promise<CanonicalPhase[]> {
  const rootDir = options.rootDir ?? process.cwd();
  const accessFile = options.accessFile ?? (async (path: string) => access(path));
  const deps = {
    loadRegistryFromRoot: options.loadRegistryFromRoot ?? loadRegistryFromRoot,
  };

  const project = await resolveProjectByRemoteOrId(rootDir, projectId, deps);
  const branch = branchForIssue(issue);

  const phasesWithLogs: CanonicalPhase[] = [];
  for (const phase of CANONICAL_PHASES) {
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

export async function readPhaseLog(
  projectId: string,
  issue: number,
  phase: CanonicalPhase,
  options: {
    rootDir?: string;
    readTextFile?: (path: string) => Promise<string>;
    accessFile?: (path: string) => Promise<void>;
    loadRegistryFromRoot?: typeof loadRegistryFromRoot;
  } = {},
): Promise<string | null> {
  const rootDir = options.rootDir ?? process.cwd();
  const accessFile = options.accessFile ?? (async (path: string) => access(path));
  const readTextFile =
    options.readTextFile ?? (async (path: string) => readFile(path, "utf8"));
  const deps = {
    loadRegistryFromRoot: options.loadRegistryFromRoot ?? loadRegistryFromRoot,
  };

  const project = await resolveProjectByRemoteOrId(rootDir, projectId, deps);
  const branch = branchForIssue(issue);
  const path = resolvePhaseLogPath({ projectPath: project.path, branch, phase });

  try {
    await accessFile(path);
  } catch {
    return null;
  }

  return readTextFile(path);
}


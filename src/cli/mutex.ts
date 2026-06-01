import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { resolveProjectStateDir } from "../state/index.js";
import { CliError } from "./errors.js";

export type ProjectMutex = {
  acquire: (projectId: string) => Promise<void>;
  release: (projectId: string) => Promise<void>;
};

function resolveLockPath(stateRoot: string, projectId: string): string {
  return join(resolveProjectStateDir(stateRoot, projectId), ".worker.lock");
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    ) {
      return false;
    }
    return true;
  }
}

async function readLockPid(lockPath: string): Promise<number | null> {
  try {
    const raw = await readFile(lockPath, "utf8");
    const pid = Number.parseInt(raw.trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function createLockFile(lockPath: string): Promise<void> {
  await mkdir(join(lockPath, ".."), { recursive: true });
  const handle = await open(lockPath, "wx");
  await handle.writeFile(String(process.pid));
  await handle.close();
}

export function createInMemoryProjectMutex(): ProjectMutex {
  const held = new Set<string>();

  return {
    async acquire(projectId: string): Promise<void> {
      if (held.has(projectId)) {
        throw new CliError(`Project ${projectId} is already running`);
      }
      held.add(projectId);
    },
    async release(projectId: string): Promise<void> {
      held.delete(projectId);
    },
  };
}

export function createFileProjectMutex(stateRoot: string): ProjectMutex {
  async function acquireWithStaleRecovery(
    projectId: string,
    lockPath: string,
  ): Promise<void> {
    try {
      await createLockFile(lockPath);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        const pid = await readLockPid(lockPath);
        if (pid !== null && !isProcessAlive(pid)) {
          await unlink(lockPath);
          await acquireWithStaleRecovery(projectId, lockPath);
          return;
        }
        throw new CliError(`Project ${projectId} is already running`);
      }
      throw error;
    }
  }

  return {
    async acquire(projectId: string): Promise<void> {
      await acquireWithStaleRecovery(
        projectId,
        resolveLockPath(stateRoot, projectId),
      );
    },
    async release(projectId: string): Promise<void> {
      try {
        await unlink(resolveLockPath(stateRoot, projectId));
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return;
        }
        throw error;
      }
    },
  };
}

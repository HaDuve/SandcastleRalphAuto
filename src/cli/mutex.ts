import { open, unlink } from "node:fs/promises";
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
  return {
    async acquire(projectId: string): Promise<void> {
      const lockPath = resolveLockPath(stateRoot, projectId);
      try {
        const handle = await open(lockPath, "wx");
        await handle.writeFile(String(process.pid));
        await handle.close();
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "EEXIST"
        ) {
          throw new CliError(`Project ${projectId} is already running`);
        }
        throw error;
      }
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

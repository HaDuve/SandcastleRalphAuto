import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFileProjectMutex } from "../src/cli/mutex.js";
import { resolveProjectStateDir } from "../src/state/index.js";

describe("createFileProjectMutex", () => {
  it("acquires a lock when no worker is running", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "mutex-test-"));
    const projectId = "HaDuve/Portfolio";
    const mutex = createFileProjectMutex(stateRoot);

    await expect(mutex.acquire(projectId)).resolves.toBeUndefined();
    await mutex.release(projectId);
  });

  it("reclaims a stale lock when the owning process is dead", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "mutex-stale-"));
    const projectId = "HaDuve/Portfolio";
    const lockPath = join(
      resolveProjectStateDir(stateRoot, projectId),
      ".worker.lock",
    );
    await mkdir(resolveProjectStateDir(stateRoot, projectId), {
      recursive: true,
    });
    await writeFile(lockPath, "999999999");

    const mutex = createFileProjectMutex(stateRoot);
    await expect(mutex.acquire(projectId)).resolves.toBeUndefined();
    await mutex.release(projectId);
  });
});

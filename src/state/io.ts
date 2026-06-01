import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ActiveStateSchema, SkipsSchema, type ActiveState } from "./schema.js";

export class StateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateError";
  }
}

export function resolveProjectStateDir(
  stateRoot: string,
  projectId: string,
): string {
  return join(stateRoot, projectId);
}

export function resolveSkipsPath(stateRoot: string, projectId: string): string {
  return join(resolveProjectStateDir(stateRoot, projectId), "skips.json");
}

export function resolveActivePath(stateRoot: string, projectId: string): string {
  return join(resolveProjectStateDir(stateRoot, projectId), "active.json");
}

export async function readActive(
  projectId: string,
  stateRoot: string = join(process.cwd(), "state"),
): Promise<ActiveState | null> {
  const path = resolveActivePath(stateRoot, projectId);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw new StateError(`Cannot read active state: ${path}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new StateError(`Invalid JSON in active state: ${path}`);
  }

  const result = ActiveStateSchema.safeParse(parsed);
  if (!result.success) {
    throw new StateError(
      `Invalid active state schema: ${result.error.message}`,
    );
  }

  return result.data;
}

export async function writeActive(
  projectId: string,
  active: ActiveState,
  stateRoot: string = join(process.cwd(), "state"),
): Promise<void> {
  const validated = ActiveStateSchema.safeParse(active);
  if (!validated.success) {
    throw new StateError(
      `Invalid active state: ${validated.error.message}`,
    );
  }

  const path = resolveActivePath(stateRoot, projectId);
  const stateDir = join(path, "..");
  await mkdir(stateDir, { recursive: true });

  const content = JSON.stringify(validated.data, null, 2) + "\n";
  const tempPath = join(stateDir, ".active.json.tmp");
  await writeFile(tempPath, content);
  await rename(tempPath, path);
}

export async function readSkips(
  projectId: string,
  stateRoot: string = join(process.cwd(), "state"),
): Promise<number[]> {
  const path = resolveSkipsPath(stateRoot, projectId);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw new StateError(`Cannot read skips: ${path}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new StateError(`Invalid JSON in skips: ${path}`);
  }

  const result = SkipsSchema.safeParse(parsed);
  if (!result.success) {
    throw new StateError(
      `Invalid skips schema: ${result.error.message}`,
    );
  }

  return result.data;
}

export async function writeSkips(
  projectId: string,
  skips: number[],
  stateRoot: string = join(process.cwd(), "state"),
): Promise<void> {
  const validated = SkipsSchema.safeParse(skips);
  if (!validated.success) {
    throw new StateError(
      `Invalid skips: ${validated.error.message}`,
    );
  }

  const path = resolveSkipsPath(stateRoot, projectId);
  const stateDir = join(path, "..");
  await mkdir(stateDir, { recursive: true });

  const content = JSON.stringify(validated.data, null, 2) + "\n";
  const tempPath = join(stateDir, ".skips.json.tmp");
  await writeFile(tempPath, content);
  await rename(tempPath, path);
}

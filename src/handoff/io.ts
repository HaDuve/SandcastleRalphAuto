import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HandoffSchema, type Handoff } from "./schema.js";

export class HandoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandoffError";
  }
}

export function resolveCurrentHandoffPath(rootDir: string): string {
  return join(rootDir, ".sandcastle-ralph", "handoff", "current.json");
}

export function resolveHandoffHistoryDir(rootDir: string): string {
  return join(rootDir, ".sandcastle-ralph", "handoff", "history");
}

function isoTimestampForFilename(date: Date): string {
  return date.toISOString().replaceAll(":", "-");
}

export function resolveArchiveHandoffPath(
  rootDir: string,
  pr: number,
  date: Date = new Date(),
): string {
  const filename = `${pr}-${isoTimestampForFilename(date)}.json`;
  return join(resolveHandoffHistoryDir(rootDir), filename);
}

export async function writeHandoff(
  handoff: Handoff,
  rootDir: string = process.cwd(),
): Promise<void> {
  const validated = HandoffSchema.safeParse(handoff);
  if (!validated.success) {
    throw new HandoffError(
      `Invalid handoff: ${validated.error.message}`,
    );
  }

  const path = resolveCurrentHandoffPath(rootDir);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(validated.data, null, 2) + "\n");
}

export async function readHandoff(
  rootDir: string = process.cwd(),
): Promise<Handoff> {
  const path = resolveCurrentHandoffPath(rootDir);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      throw new HandoffError(`Handoff not found: ${path}`);
    }
    throw new HandoffError(`Cannot read handoff: ${path}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HandoffError(`Invalid JSON in handoff: ${path}`);
  }

  const result = HandoffSchema.safeParse(parsed);
  if (!result.success) {
    throw new HandoffError(
      `Invalid handoff schema: ${result.error.message}`,
    );
  }

  return result.data;
}

export async function archiveHandoff(
  rootDir: string = process.cwd(),
  now: () => Date = () => new Date(),
): Promise<string> {
  const handoff = await readHandoff(rootDir);
  if (handoff.pr === undefined) {
    throw new HandoffError(
      "Cannot archive handoff without a pr number",
    );
  }

  const currentPath = resolveCurrentHandoffPath(rootDir);
  const archivePath = resolveArchiveHandoffPath(rootDir, handoff.pr, now());
  await mkdir(resolveHandoffHistoryDir(rootDir), { recursive: true });
  await rename(currentPath, archivePath);

  return archivePath;
}

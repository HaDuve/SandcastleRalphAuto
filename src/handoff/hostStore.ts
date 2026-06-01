import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveProjectStateDir } from "../state/io.js";
import { HandoffSchema, type Handoff } from "./schema.js";
import { HandoffError } from "./io.js";

export function resolveHostHandoffDir(
  stateRoot: string,
  projectId: string,
): string {
  return join(resolveProjectStateDir(stateRoot, projectId), "handoff");
}

export function resolveHostCurrentHandoffPath(
  stateRoot: string,
  projectId: string,
): string {
  return join(resolveHostHandoffDir(stateRoot, projectId), "current.json");
}

export function resolveHostHandoffHistoryDir(
  stateRoot: string,
  projectId: string,
): string {
  return join(resolveHostHandoffDir(stateRoot, projectId), "history");
}

function isoTimestampForFilename(date: Date): string {
  return date.toISOString().replaceAll(":", "-");
}

export function resolveHostArchiveHandoffPath(
  stateRoot: string,
  projectId: string,
  pr: number,
  date: Date = new Date(),
): string {
  const filename = `${pr}-${isoTimestampForFilename(date)}.json`;
  return join(resolveHostHandoffHistoryDir(stateRoot, projectId), filename);
}

export async function writeHostHandoff(
  input: {
    stateRoot: string;
    projectId: string;
    handoff: Handoff;
  },
): Promise<void> {
  const validated = HandoffSchema.safeParse(input.handoff);
  if (!validated.success) {
    throw new HandoffError(`Invalid handoff: ${validated.error.message}`);
  }

  const path = resolveHostCurrentHandoffPath(input.stateRoot, input.projectId);
  const dir = join(path, "..");
  await mkdir(dir, { recursive: true });

  const content = JSON.stringify(validated.data, null, 2) + "\n";
  const tempPath = join(dir, ".current.json.tmp");
  await writeFile(tempPath, content);
  await rename(tempPath, path);
}

export async function readHostHandoff(input: {
  stateRoot: string;
  projectId: string;
}): Promise<Handoff> {
  const path = resolveHostCurrentHandoffPath(input.stateRoot, input.projectId);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
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
    throw new HandoffError(`Invalid handoff schema: ${result.error.message}`);
  }

  return result.data;
}

export async function archiveHostHandoff(
  input: { stateRoot: string; projectId: string },
  now: () => Date = () => new Date(),
): Promise<string> {
  const handoff = await readHostHandoff(input);
  if (handoff.pr === undefined) {
    throw new HandoffError("Cannot archive handoff without a pr number");
  }

  const currentPath = resolveHostCurrentHandoffPath(input.stateRoot, input.projectId);
  const archivePath = resolveHostArchiveHandoffPath(
    input.stateRoot,
    input.projectId,
    handoff.pr,
    now(),
  );
  await mkdir(resolveHostHandoffHistoryDir(input.stateRoot, input.projectId), {
    recursive: true,
  });
  await rename(currentPath, archivePath);
  return archivePath;
}


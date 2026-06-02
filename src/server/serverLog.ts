import { mkdir, appendFile } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "node:path";
import { sanitizeBranchForFilename } from "../phaseLogs/phaseLogs.js";
import { type EventBus } from "./eventBus.js";

export type ServerLogContext = {
  projectId: string;
  projectPath: string;
  branch: string | null;
};

type CaptureDeps = {
  eventBus: EventBus;
  now?: () => Date;
};

type InstalledCapture = {
  storage: AsyncLocalStorage<ServerLogContext>;
  runWithProject: <T>(
    ctx: Omit<ServerLogContext, "branch">,
    fn: () => Promise<T>,
  ) => Promise<T>;
  runWithBranch: <T>(branch: string, fn: () => Promise<T>) => Promise<T>;
};

let installed: InstalledCapture | null = null;

function safeToString(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    try {
      return String(value);
    } catch {
      return "[unprintable]";
    }
  }
}

function formatConsoleLine(args: unknown[]): string {
  const line = args.map((a) => safeToString(a)).join(" ");
  return line.endsWith("\n") ? line : `${line}\n`;
}

async function appendServerLogLine(
  ctx: ServerLogContext,
  line: string,
): Promise<void> {
  if (!ctx.branch) {
    return;
  }
  const sanitizedBranch = sanitizeBranchForFilename(ctx.branch);
  const dir = join(ctx.projectPath, ".sandcastle", "logs");
  const path = join(dir, `${sanitizedBranch}-server.log`);
  try {
    await mkdir(dir, { recursive: true });
    await appendFile(path, line, "utf8");
  } catch {
    // Never throw into Sandcastle's execution path.
  }
}

export function installServerConsoleCapture(deps: CaptureDeps): InstalledCapture {
  if (installed) {
    return installed;
  }

  const storage = new AsyncLocalStorage<ServerLogContext>();
  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);

  function captureWrite(args: unknown[]): void {
    const ctx = storage.getStore();
    if (!ctx) {
      return;
    }
    const line = formatConsoleLine(args);
    void appendServerLogLine(ctx, line);
    deps.eventBus.emit({ type: "server-log", projectId: ctx.projectId, chunk: line });
  }

  console.log = (...args: unknown[]) => {
    try {
      captureWrite(args);
    } catch {
      // ignore capture failures
    }
    originalLog(...args);
  };

  console.warn = (...args: unknown[]) => {
    try {
      captureWrite(args);
    } catch {
      // ignore capture failures
    }
    originalWarn(...args);
  };

  installed = {
    storage,
    runWithProject: async (ctx, fn) => storage.run({ ...ctx, branch: null }, fn),
    runWithBranch: async (branch, fn) => {
      const current = storage.getStore();
      if (!current) {
        return fn();
      }
      return storage.run({ ...current, branch }, fn);
    },
  };

  void deps.now;
  return installed;
}


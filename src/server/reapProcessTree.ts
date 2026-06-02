import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ProcessInfo = {
  pid: number;
  ppid: number;
  command: string;
};

export type ReapDeps = {
  /** List every process as { pid, ppid, command }. Defaults to `ps`. */
  listProcesses?: () => Promise<ProcessInfo[]>;
  /** Send a signal to a pid. Throws if the pid no longer exists. */
  kill?: (pid: number, signal: NodeJS.Signals | 0) => void;
  sleep?: (ms: number) => Promise<void>;
};

export type ReapOptions = {
  /** Milliseconds to wait after SIGTERM before escalating to SIGKILL. */
  graceMs?: number;
  /**
   * Only reap descendants whose command matches. Defaults to undefined,
   * which reaps the entire descendant subtree.
   */
  match?: RegExp;
  deps?: ReapDeps;
};

const DEFAULT_GRACE_MS = 3_000;

async function defaultListProcesses(): Promise<ProcessInfo[]> {
  if (process.platform === "win32") {
    return [];
  }
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,command="], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const processes: ProcessInfo[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const match = trimmed.match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) {
      continue;
    }
    processes.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      command: match[3],
    });
  }
  return processes;
}

function defaultKill(pid: number, signal: NodeJS.Signals | 0): void {
  process.kill(pid, signal);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Collect every transitive descendant of `rootPid` (excluding root itself). */
export function collectDescendants(
  processes: ProcessInfo[],
  rootPid: number,
): ProcessInfo[] {
  const childrenByParent = new Map<number, ProcessInfo[]>();
  for (const proc of processes) {
    const siblings = childrenByParent.get(proc.ppid) ?? [];
    siblings.push(proc);
    childrenByParent.set(proc.ppid, siblings);
  }

  const descendants: ProcessInfo[] = [];
  const seen = new Set<number>([rootPid]);
  const queue = [rootPid];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const child of childrenByParent.get(parent) ?? []) {
      if (seen.has(child.pid)) {
        continue;
      }
      seen.add(child.pid);
      descendants.push(child);
      queue.push(child.pid);
    }
  }
  return descendants;
}

/**
 * Terminate the descendant process subtree of `rootPid`. Sends SIGTERM, waits
 * `graceMs`, then SIGKILLs any survivors. Sandcastle only best-effort SIGTERMs
 * the agent process group on abort, which leaves heavy grandchildren (e.g.
 * `vitest` fork-pool workers) orphaned and holding their heaps. This sweep
 * guarantees they are reaped.
 *
 * NOTE: descendants cannot be attributed to a specific project (all project
 * loops share one orchestrator process), so reaping during a multi-project run
 * also terminates sibling projects' in-flight subprocesses.
 *
 * @returns the pids that were targeted for termination.
 */
export async function reapProcessTree(
  rootPid: number,
  options: ReapOptions = {},
): Promise<number[]> {
  if (process.platform === "win32") {
    return [];
  }
  const listProcesses = options.deps?.listProcesses ?? defaultListProcesses;
  const kill = options.deps?.kill ?? defaultKill;
  const sleep = options.deps?.sleep ?? defaultSleep;
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;

  const processes = await listProcesses();
  let targets = collectDescendants(processes, rootPid);
  if (options.match) {
    targets = targets.filter((proc) => options.match!.test(proc.command));
  }
  if (targets.length === 0) {
    return [];
  }

  const targetPids = targets.map((proc) => proc.pid);
  for (const pid of targetPids) {
    try {
      kill(pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }

  await sleep(graceMs);

  for (const pid of targetPids) {
    try {
      // Throws if the process is already gone.
      kill(pid, 0);
      kill(pid, "SIGKILL");
    } catch {
      // Exited within the grace window.
    }
  }

  return targetPids;
}

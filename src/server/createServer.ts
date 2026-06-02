import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join, extname, resolve } from "node:path";
import { findProjectById, type RunProjectDeps } from "../cli/index.js";
import { listHandoffHistory } from "../handoff/index.js";
import { type GhRunner } from "../merge/index.js";
import { listPhaseLogs, readPhaseLog } from "../phaseLogs/index.js";
import { loadRegistryFromRoot, type Project } from "../registry/index.js";
import { parseRunnablePhase } from "../prompts/phases.js";
import { readActive, readRunOutcome, readSkips, writeSkips } from "../state/index.js";
import {
  enrichActiveState,
  enrichActiveSummary,
  workerStatusFor,
} from "./projectSnapshot.js";
import { createEventBus, type EventBus } from "./eventBus.js";
import { fetchProjectQueue } from "./queue.js";
import { createWorkerManager, type WorkerManager } from "./workerManager.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function readStateDebug(
  stateRoot: string,
  projectId: string,
): Promise<{
  activePath: string;
  activeMtimeMs: number | null;
  activeBytes: number | null;
  workerLockPath: string;
  workerLockPid: number | null;
}> {
  const activePath = join(stateRoot, projectId, "active.json");
  const workerLockPath = join(stateRoot, projectId, ".worker.lock");

  let activeMtimeMs: number | null = null;
  let activeBytes: number | null = null;
  try {
    const info = await stat(activePath);
    activeMtimeMs = info.mtimeMs;
    activeBytes = info.size;
  } catch {
    // ignore missing active.json
  }

  let workerLockPid: number | null = null;
  try {
    const raw = await readFile(workerLockPath, "utf8");
    const pid = Number.parseInt(raw.trim(), 10);
    workerLockPid = Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    // ignore missing/invalid lock file
  }

  return { activePath, activeMtimeMs, activeBytes, workerLockPath, workerLockPid };
}

export type DashboardServerOptions = {
  rootDir: string;
  stateRoot?: string;
  staticDir?: string;
  loadRegistry?: (rootDir: string) => Promise<Project[]>;
  readActive?: typeof readActive;
  readRunOutcome?: typeof readRunOutcome;
  readSkips?: typeof readSkips;
  writeSkips?: typeof writeSkips;
  fetchQueue?: typeof fetchProjectQueue;
  listPhaseLogs?: typeof listPhaseLogs;
  readPhaseLog?: typeof readPhaseLog;
  listHistory?: typeof listHandoffHistory;
  gh?: GhRunner;
  workerManager?: WorkerManager;
  eventBus?: EventBus;
  runProjectDeps?: RunProjectDeps;
};

function requestPathname(req: IncomingMessage): string {
  const raw = req.url ?? "/";
  return raw.split("?")[0]?.split("#")[0] ?? "/";
}

function requestSearchParams(req: IncomingMessage): URLSearchParams {
  const raw = req.url ?? "/";
  const queryStart = raw.indexOf("?");
  const query = queryStart === -1 ? "" : raw.slice(queryStart);
  return new URL(query || "?", "http://localhost").searchParams;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function matchProjectRoute(pathname: string): { projectId: string; action: string } | null {
  const match = pathname.match(/^\/api\/projects\/([^/]+)(?:\/(.+))?$/);
  if (!match) {
    return null;
  }
  return { projectId: decodeURIComponent(match[1]!), action: match[2] ?? "" };
}

async function serveStaticFile(
  staticDir: string,
  pathname: string,
  res: ServerResponse,
): Promise<boolean> {
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  if (relativePath.includes("..")) {
    return false;
  }
  const filePath = resolve(staticDir, relativePath);
  if (!filePath.startsWith(resolve(staticDir))) {
    return false;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return false;
    }
    const content = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream" });
    res.end(content);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT" &&
      !relativePath.endsWith(".html")
    ) {
      const indexPath = join(staticDir, "index.html");
      try {
        const content = await readFile(indexPath);
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(content);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

function writeSseEvent(res: ServerResponse, event: string, data: unknown): void {
  if (res.destroyed || res.writableEnded) {
    return;
  }
  try {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    if (!res.write(payload)) {
      // Drop events for slow clients instead of applying backpressure to publishers.
    }
  } catch {
    // Ignore write failures from disconnected clients.
  }
}

export function createDashboardServer(options: DashboardServerOptions): Server {
  const rootDir = options.rootDir;
  const stateRoot = options.stateRoot ?? join(rootDir, "state");
  const staticDir = options.staticDir ?? join(rootDir, "dashboard", "dist");
  const loadRegistry =
    options.loadRegistry ??
    ((rootDir: string) =>
      loadRegistryFromRoot(rootDir, { checkGhAuth: async () => {} }));
  const readActiveFn = options.readActive ?? readActive;
  const readRunOutcomeFn = options.readRunOutcome ?? readRunOutcome;
  const readSkipsFn = options.readSkips ?? readSkips;
  const writeSkipsFn = options.writeSkips ?? writeSkips;
  const fetchQueueFn = options.fetchQueue ?? fetchProjectQueue;
  const listPhaseLogsFn = options.listPhaseLogs ?? listPhaseLogs;
  const readPhaseLogFn = options.readPhaseLog ?? readPhaseLog;
  const listHistoryFn = options.listHistory ?? listHandoffHistory;
  const eventBus = options.eventBus ?? createEventBus();
  const workerManager =
    options.workerManager ??
    createWorkerManager({ eventBus });

  async function resolveProject(projectId: string): Promise<Project> {
    const projects = await loadRegistry(rootDir);
    return findProjectById(projects, projectId);
  }

  const resolveGh = async (): Promise<GhRunner> => {
    if (options.gh) {
      return options.gh;
    }
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    return async (args) => {
      const { stdout } = await promisify(execFile)("gh", args);
      return stdout;
    };
  };

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const pathname = requestPathname(req);

      if (req.method === "GET" && pathname === "/api/projects") {
        const projects = await loadRegistry(rootDir);
        const gh = await resolveGh();
        const enriched = await Promise.all(
          projects.map(async (project) => {
            const [active, lastRunOutcome] = await Promise.all([
              readActiveFn(project.remote, stateRoot),
              readRunOutcomeFn(project.remote, stateRoot),
            ]);
            return {
              ...project,
              workerStatus: workerStatusFor(workerManager, project.id),
              lastRunOutcome,
              active: await enrichActiveSummary(active, project.remote, gh),
            };
          }),
        );
        sendJson(res, 200, { projects: enriched });
        return;
      }

      const projectRoute = matchProjectRoute(pathname);
      if (projectRoute) {
        const project = await resolveProject(projectRoute.projectId);

        if (req.method === "GET" && projectRoute.action === "active") {
          const active = await readActiveFn(project.remote, stateRoot);
          const gh = await resolveGh();
          sendJson(res, 200, {
            active: await enrichActiveState(active, project.remote, gh),
            debug: await readStateDebug(stateRoot, project.remote),
          });
          return;
        }

        if (req.method === "GET" && projectRoute.action === "log") {
          const active = await readActiveFn(project.remote, stateRoot);
          const searchParams = requestSearchParams(req);
          const phaseParam = searchParams.get("phase");
          const issueParam = searchParams.get("issue");

          if (phaseParam !== null && parseRunnablePhase(phaseParam) === null) {
            sendJson(res, 400, { error: "Invalid phase" });
            return;
          }

          let issue: number | undefined;
          let phase =
            phaseParam === null ? null : parseRunnablePhase(phaseParam);

          if (active) {
            issue = active.issue;
            if (!phase) {
              phase = parseRunnablePhase(active.phase);
            }
          } else if (issueParam !== null && phaseParam !== null) {
            issue = Number(issueParam);
            if (!Number.isFinite(issue) || issue <= 0) {
              sendJson(res, 400, { error: "Invalid issue" });
              return;
            }
          } else {
            sendJson(res, 404, { error: "No active slice" });
            return;
          }

          if (!phase || issue === undefined) {
            sendJson(res, 400, { error: "Invalid phase" });
            return;
          }

          const phases = await listPhaseLogsFn(project.remote, issue, {
            rootDir,
          });
          const log = await readPhaseLogFn(project.remote, issue, phase, {
            rootDir,
          });
          sendJson(res, 200, { issue, phase, log, phases });
          return;
        }

        if (req.method === "GET" && projectRoute.action === "queue") {
          const gh = await resolveGh();
          const queue = await fetchQueueFn(project, stateRoot, gh, readSkipsFn);
          sendJson(res, 200, { queue });
          return;
        }

        if (req.method === "GET" && projectRoute.action === "history") {
          const history = await listHistoryFn({
            stateRoot,
            projectId: project.remote,
          });
          sendJson(res, 200, { history });
          return;
        }

        if (req.method === "GET" && projectRoute.action === "events") {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          writeSseEvent(res, "connected", {
            type: "connected",
            projectId: project.id,
            workerStatus: workerStatusFor(workerManager, project.id),
          });
          const unsubscribe = eventBus.subscribe(project.id, (event) => {
            writeSseEvent(res, event.type, event);
          });
          req.on("close", () => {
            unsubscribe();
          });
          return;
        }

        if (req.method === "POST" && projectRoute.action === "start") {
          const result = await workerManager.start(project, {
            rootDir,
            stateRoot,
            deps: options.runProjectDeps,
          });
          sendJson(res, result.status === "started" ? 202 : 409, result);
          return;
        }

        if (req.method === "POST" && projectRoute.action === "pause") {
          sendJson(res, 200, workerManager.pause(project.id));
          return;
        }

        if (req.method === "POST" && projectRoute.action === "resume") {
          sendJson(res, 200, workerManager.resume(project.id));
          return;
        }

        if (req.method === "POST" && projectRoute.action === "kill") {
          sendJson(res, 200, workerManager.kill(project.id));
          return;
        }

        if (req.method === "POST" && projectRoute.action === "skip") {
          const body = (await readJsonBody(req)) as { issue?: number };
          if (typeof body.issue !== "number") {
            sendJson(res, 400, { error: "issue number required" });
            return;
          }
          const skips = await readSkipsFn(project.remote, stateRoot);
          if (!skips.includes(body.issue)) {
            await writeSkipsFn(project.remote, [...skips, body.issue].sort((a, b) => a - b), stateRoot);
          }
          sendJson(res, 200, { status: "skipped", issue: body.issue });
          return;
        }

        if (req.method === "DELETE" && projectRoute.action === "skip") {
          const body = (await readJsonBody(req)) as { issue?: number };
          if (typeof body.issue !== "number") {
            sendJson(res, 400, { error: "issue number required" });
            return;
          }
          const skips = await readSkipsFn(project.remote, stateRoot);
          const nextSkips = skips.filter((n) => n !== body.issue);
          if (nextSkips.length !== skips.length) {
            await writeSkipsFn(project.remote, nextSkips, stateRoot);
          }
          sendJson(res, 200, { status: "unskipped", issue: body.issue });
          return;
        }
      }

      if (req.method === "GET" && !pathname.startsWith("/api/")) {
        const served = await serveStaticFile(staticDir, pathname, res);
        if (served) {
          return;
        }
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal server error";
      const status = message.startsWith("Unknown project:") ? 404 : 500;
      sendJson(res, status, { error: message });
    }
  });
}

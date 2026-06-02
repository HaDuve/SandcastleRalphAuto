import { HandoffError, type Handoff } from "../handoff/index.js";
import { type GhRunner } from "../merge/index.js";
import { type Project } from "../registry/index.js";
import { runPhase } from "../runner/index.js";
import { type ActiveState } from "../state/index.js";
import { selectNextIssue, type GhIssue } from "./select.js";

/** Dashboard idle signal (PRD §4); host result uses this as `RunNextQueueEmpty.status`. */
export const QUEUE_EMPTY = "queue-empty" as const;

export type RunNextInput = {
  project: Project;
  projectPath: string;
  stateRoot: string;
  /** Omitted when the prior slice ended at create-pr with no diff (no PR to merge). */
  pr?: number;
  /** When advancing without `pr`, record operator skip so the empty slice is not re-queued. */
  emptySliceIssue?: number;
};

export type RunNextStarted = {
  status: "started";
  issue: number;
  branch: string;
};

export type RunNextQueueEmpty = {
  status: typeof QUEUE_EMPTY;
};

export type RunNextBlocked = {
  status: "blocked";
  reason: string;
};

export type RunNextResult =
  | RunNextStarted
  | RunNextQueueEmpty
  | RunNextBlocked;

export type StartTddInput = {
  project: Project;
  issue: number;
  branch: string;
  projectPath: string;
  stateRoot: string;
  handoff: Handoff;
};

export type RunNextDeps = {
  gh: GhRunner;
  readSkips: (projectId: string, stateRoot: string) => Promise<number[]>;
  writeSkips: (
    projectId: string,
    skips: number[],
    stateRoot: string,
  ) => Promise<void>;
  archiveHandoff: (projectId: string) => Promise<string>;
  writeActive: (
    projectId: string,
    active: ActiveState,
    stateRoot: string,
  ) => Promise<void>;
  startTdd: (input: StartTddInput) => Promise<void>;
  now?: () => Date;
};

export function branchForIssue(issue: number): string {
  return `issue-${issue}`;
}

function blocked(reason: string): RunNextBlocked {
  return { status: "blocked", reason };
}

function parsePrState(raw: string): string | RunNextBlocked {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "state" in parsed &&
      typeof (parsed as { state: unknown }).state === "string"
    ) {
      return (parsed as { state: string }).state;
    }
    return blocked("Could not parse PR state from gh");
  } catch {
    return blocked("Could not parse PR state from gh");
  }
}

function parseIssueList(raw: string): GhIssue[] | RunNextBlocked {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return blocked("Could not parse issues from gh");
    }
    return parsed as GhIssue[];
  } catch {
    return blocked("Could not parse issues from gh");
  }
}

export function seedTddHandoff(
  project: Project,
  issue: number,
  branch: string,
  now: Date,
): Handoff {
  const iso = now.toISOString();
  return {
    project: project.remote,
    issue,
    branch,
    phase: "tdd",
    acceptanceState: "in-progress",
    blockers: [],
    mergeReady: false,
    nextSkill: "/create-pr",
    startedAt: iso,
    endedAt: iso,
  };
}

export async function runNext(
  input: RunNextInput,
  deps: RunNextDeps,
): Promise<RunNextResult> {
  const { project, projectPath, stateRoot, pr, emptySliceIssue } = input;
  const now = deps.now ?? (() => new Date());

  if (pr !== undefined) {
    const prStateRaw = await deps.gh([
      "pr",
      "view",
      String(pr),
      "--repo",
      project.remote,
      "--json",
      "state",
    ]);
    const prState = parsePrState(prStateRaw);
    if (typeof prState !== "string") {
      return prState;
    }
    if (prState !== "MERGED") {
      return blocked(`PR #${pr} is not merged (state: ${prState})`);
    }
  }

  // Only archive when we have a PR-numbered slice to archive.
  // Empty slices (create-pr no diff) intentionally omit `pr`.
  if (pr !== undefined) {
    try {
      await deps.archiveHandoff(project.remote);
    } catch (error) {
      const reason =
        error instanceof HandoffError
          ? error.message
          : "Could not archive handoff";
      return blocked(reason);
    }
  }

  const issuesRaw = await deps.gh([
    "issue",
    "list",
    "--repo",
    project.remote,
    "--state",
    "open",
    "--label",
    project.afkLabel,
    "--json",
    "number,labels,state",
  ]);
  const parsedIssues = parseIssueList(issuesRaw);
  if (!Array.isArray(parsedIssues)) {
    return parsedIssues;
  }

  let skips = await deps.readSkips(project.remote, stateRoot);
  if (
    pr === undefined &&
    emptySliceIssue !== undefined &&
    !skips.includes(emptySliceIssue)
  ) {
    skips = [...skips, emptySliceIssue].sort((a, b) => a - b);
    await deps.writeSkips(project.remote, skips, stateRoot);
  }

  const nextIssue = selectNextIssue(parsedIssues, project, skips);
  if (nextIssue === null) {
    return { status: QUEUE_EMPTY };
  }

  const branch = branchForIssue(nextIssue);
  const handoff = seedTddHandoff(project, nextIssue, branch, now());

  await deps.writeActive(
    project.remote,
    {
      issue: nextIssue,
      phase: "tdd",
      branch,
      status: "active",
      startedAt: handoff.startedAt,
    },
    stateRoot,
  );
  await deps.startTdd({
    project,
    issue: nextIssue,
    branch,
    projectPath,
    stateRoot,
    handoff,
  });

  return { status: "started", issue: nextIssue, branch };
}

export async function startTddViaRunPhase(input: StartTddInput): Promise<void> {
  await runPhase({
    phase: "tdd",
    branch: input.branch,
    projectPath: input.projectPath,
    projectId: input.project.remote,
    stateRoot: input.stateRoot,
    seedHandoff: input.handoff,
  });
}

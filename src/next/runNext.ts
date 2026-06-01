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
  pr: number;
  handoffRoot?: string;
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
  archiveHandoff: (rootDir: string) => Promise<string>;
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
  const {
    project,
    projectPath,
    stateRoot,
    pr,
    handoffRoot = projectPath,
  } = input;
  const now = deps.now ?? (() => new Date());

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

  try {
    await deps.archiveHandoff(handoffRoot);
  } catch (error) {
    const reason =
      error instanceof HandoffError
        ? error.message
        : "Could not archive handoff";
    return blocked(reason);
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

  const skips = await deps.readSkips(project.remote, stateRoot);
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
    seedHandoff: input.handoff,
  });
}

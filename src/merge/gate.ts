import { type Handoff } from "../handoff/index.js";
import { type Project } from "../registry/index.js";
import { type ActiveState } from "../state/index.js";

/** Pre-flight input for the host merge gate (D3/D4). */
export type RunMergeGateInput = {
  /**
   * Handoff snapshot for pre-flight. Per D3, `verdict` must be `approve` from
   * `/review-pr`. Callers should pass the review handoff or preserve that
   * verdict through the slice — a merge-phase handoff with `n/a` will block.
   */
  handoff: Handoff;
  project: Pick<Project, "autoMerge">;
  pr: number;
};

export type RunMergeGateSuccess = {
  status: "auto-merge-queued";
};

export type RunMergeGateAwaitingHuman = {
  status: "awaiting-human";
  reason: string;
};

export type RunMergeGateBlocked = {
  status: "blocked";
  reason: string;
  resumeSkill: "/merge";
};

export type RunMergeGateResult =
  | RunMergeGateSuccess
  | RunMergeGateAwaitingHuman
  | RunMergeGateBlocked;

export type GhRunner = (args: string[]) => Promise<string>;

export type RunMergeGateDeps = {
  gh: GhRunner;
};

type PrCheck = {
  name: string;
  state: string;
  bucket: string;
  link: string;
};

function blocked(reason: string): RunMergeGateBlocked {
  return { status: "blocked", reason, resumeSkill: "/merge" };
}

function allRequiredChecksGreen(checks: PrCheck[]): boolean {
  return checks.every(
    (check) => check.bucket === "pass" || check.bucket === "skipping",
  );
}

function parseRequiredChecks(raw: string): PrCheck[] | RunMergeGateBlocked {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return blocked("Could not parse required checks from gh");
    }
    return parsed as PrCheck[];
  } catch {
    return blocked("Could not parse required checks from gh");
  }
}

export async function runMergeGate(
  input: RunMergeGateInput,
  deps: RunMergeGateDeps,
): Promise<RunMergeGateResult> {
  const { handoff, project, pr } = input;

  if (!project.autoMerge) {
    return {
      status: "awaiting-human",
      reason: "autoMerge is disabled for this project",
    };
  }

  if (handoff.verdict !== "approve") {
    return blocked("Merge gate requires a clean Approve verdict");
  }

  if (handoff.blockers.length > 0) {
    return blocked(`Open blockers: ${handoff.blockers.join(", ")}`);
  }

  const checksRaw = await deps.gh([
    "pr",
    "checks",
    String(pr),
    "--required",
    "--json",
    "name,state,bucket,link",
  ]);
  const parsedChecks = parseRequiredChecks(checksRaw);
  if ("status" in parsedChecks) {
    return parsedChecks;
  }

  if (!allRequiredChecksGreen(parsedChecks)) {
    const failing = parsedChecks
      .filter((check) => check.bucket !== "pass" && check.bucket !== "skipping")
      .map((check) => check.name)
      .join(", ");
    return blocked(`Required checks not green: ${failing}`);
  }

  await deps.gh(["pr", "merge", String(pr), "--squash", "--auto"]);

  return { status: "auto-merge-queued" };
}

export type MergeGateSliceContext = {
  issue: number;
  branch: string;
  pr?: number;
};

export function activeStateFromMergeGate(
  context: MergeGateSliceContext,
  result: RunMergeGateResult,
): ActiveState | null {
  const base = {
    issue: context.issue,
    phase: "merge" as const,
    branch: context.branch,
    pr: context.pr,
  };

  if (result.status === "auto-merge-queued") {
    return null;
  }

  if (result.status === "awaiting-human") {
    return {
      ...base,
      status: "awaiting-human",
      reason: result.reason,
    };
  }

  return {
    ...base,
    status: "blocked",
    reason: result.reason,
    resumeSkill: result.resumeSkill,
  };
}

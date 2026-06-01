import { type Handoff } from "../handoff/index.js";
import { type Project } from "../registry/index.js";
import { type ActiveState } from "../state/index.js";
import {
  type MergeGateBlockKind,
} from "./blockKinds.js";

/** Pre-flight input for the host merge gate (D3/D4). */
export type RunMergeGateInput = {
  /**
   * Handoff snapshot for pre-flight. Per D3, `verdict` must be `approve` before
   * the host queues merge on an open PR. Callers should pass the latest host
   * handoff after `/review-tdd` when available (ADR 0009). If the PR is already
   * `MERGED` on GitHub (e.g. merge agent merged first), the gate succeeds
   * without re-merging even when `verdict` is `n/a`.
   */
  handoff: Handoff;
  project: Pick<Project, "autoMerge" | "remote">;
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
  kind: MergeGateBlockKind;
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

function blocked(
  kind: MergeGateBlockKind,
  reason: string,
): RunMergeGateBlocked {
  return { status: "blocked", kind, reason, resumeSkill: "/merge" };
}

type PrMergeability = {
  mergeable: string;
  mergeStateStatus: string;
};

function isPrMergeable(view: PrMergeability): boolean {
  return (
    view.mergeStateStatus === "CLEAN" || view.mergeable === "MERGEABLE"
  );
}

function parsePrMergeability(
  raw: string,
): PrMergeability | RunMergeGateBlocked {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as PrMergeability).mergeable !== "string" ||
      typeof (parsed as PrMergeability).mergeStateStatus !== "string"
    ) {
      return blocked(
        "mergeability-parse-error",
        "Could not read PR mergeability from gh",
      );
    }
    return parsed as PrMergeability;
  } catch {
    return blocked(
      "mergeability-parse-error",
      "Could not read PR mergeability from gh",
    );
  }
}

function allRequiredChecksGreen(checks: PrCheck[]): boolean {
  return checks.every(
    (check) => check.bucket === "pass" || check.bucket === "skipping",
  );
}

function ghRepoArgs(remote: string): string[] {
  return ["--repo", remote];
}

function parsePrState(raw: string): string | RunMergeGateBlocked {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { state?: unknown }).state !== "string"
    ) {
      return blocked(
        "mergeability-parse-error",
        "Could not read PR state from gh",
      );
    }
    return (parsed as { state: string }).state;
  } catch {
    return blocked(
      "mergeability-parse-error",
      "Could not read PR state from gh",
    );
  }
}

function parseRequiredChecks(raw: string): PrCheck[] | RunMergeGateBlocked {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return blocked(
        "checks-parse-error",
        "Could not parse required checks from gh",
      );
    }
    return parsed as PrCheck[];
  } catch {
    return blocked(
      "checks-parse-error",
      "Could not parse required checks from gh",
    );
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

  if (handoff.blockers.length > 0) {
    return blocked(
      "open-blockers",
      `Open blockers: ${handoff.blockers.join(", ")}`,
    );
  }

  const repo = ghRepoArgs(project.remote);

  const stateRaw = await deps.gh([
    "pr",
    "view",
    String(pr),
    ...repo,
    "--json",
    "state",
  ]);
  const prState = parsePrState(stateRaw);
  if (typeof prState !== "string") {
    return prState;
  }
  if (prState === "MERGED") {
    return { status: "auto-merge-queued" };
  }

  if (handoff.verdict !== "approve") {
    return blocked(
      "no-approve-verdict",
      "Merge gate requires a clean Approve verdict",
    );
  }

  const mergeabilityRaw = await deps.gh([
    "pr",
    "view",
    String(pr),
    ...repo,
    "--json",
    "mergeable,mergeStateStatus",
  ]);
  const mergeability = parsePrMergeability(mergeabilityRaw);
  if ("status" in mergeability) {
    return mergeability;
  }
  if (!isPrMergeable(mergeability)) {
    return blocked(
      "pr-not-mergeable",
      `PR is not mergeable (${mergeability.mergeable}, ${mergeability.mergeStateStatus})`,
    );
  }

  const checksRaw = await deps.gh([
    "pr",
    "checks",
    String(pr),
    ...repo,
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
    return blocked(
      "required-checks-failed",
      `Required checks not green: ${failing}`,
    );
  }

  await deps.gh(["pr", "merge", String(pr), ...repo, "--squash", "--auto"]);

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

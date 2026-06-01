/** Machine-readable merge-gate block reasons for babysit-tail classification (ADR 0006). */
export const MERGE_GATE_BLOCK_KINDS = [
  "required-checks-failed",
  "pr-not-mergeable",
  "unresolved-review-comments",
  "no-approve-verdict",
  "open-blockers",
  "checks-parse-error",
] as const;

export type MergeGateBlockKind = (typeof MERGE_GATE_BLOCK_KINDS)[number];

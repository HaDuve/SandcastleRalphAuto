/** Machine-readable merge-gate block reasons for babysit-tail classification (ADR 0006). */
export const MERGE_GATE_BLOCK_KINDS = [
  "required-checks-failed",
  "pr-not-mergeable",
  /** Classifier-ready; emitted when merge gate detects unresolved threads (follow-up slice). */
  "unresolved-review-comments",
  "no-approve-verdict",
  "open-blockers",
  "missing-merge-prerequisites",
  "checks-parse-error",
  "mergeability-parse-error",
] as const;

export type MergeGateBlockKind = (typeof MERGE_GATE_BLOCK_KINDS)[number];

export const MERGE_GATE_NO_APPROVE_REASON =
  "Merge gate requires a clean Approve verdict";

export function isMergeGateNoApproveBlockReason(
  reason: string | undefined,
): boolean {
  return reason === MERGE_GATE_NO_APPROVE_REASON;
}

export {
  MERGE_GATE_BLOCK_KINDS,
  type MergeGateBlockKind,
} from "./blockKinds.js";
export {
  classifyMergeTailBlock,
  type MergeTailBlockClassification,
} from "./classifyMergeTailBlock.js";
export {
  activeStateFromMergeGate,
  runMergeGate,
  type GhRunner,
  type MergeGateSliceContext,
  type RunMergeGateAwaitingHuman,
  type RunMergeGateBlocked,
  type RunMergeGateDeps,
  type RunMergeGateInput,
  type RunMergeGateResult,
  type RunMergeGateSuccess,
} from "./gate.js";

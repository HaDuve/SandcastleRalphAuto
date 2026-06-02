# Reconcile create-pr no-diff and advance queue

Observed on issue #95: the create-pr agent wrote `acceptanceState: "blocked"` when `issue-<n>` had zero commits vs `origin/main`. The host stalled with `Handoff acceptanceState is blocked, expected done`, and a prior fix that only accepted `done` + `nextSkill: "/next"` did not help when the agent kept writing `blocked`.

## Decision

1. **Git is source of truth** in the worktree: `git rev-list origin/main..HEAD --count` is `0` and `git diff --quiet origin/main...HEAD` succeeds (`worktreeHasNoDiffVsOriginMain`).
2. **Normalize handoff** to `acceptanceState: "done"`, `blockers: []`, omit `pr`, `nextSkill: "/next"` when git confirms no diff and the handoff is either already in that shape or `blocked` with known no-PR blocker prose (`confirmsCreatePrNoDiffAtWorktree`).
3. **Advance without merge gate** — `advanceSlice` short-circuits to `handoffToNext`; `loopProject` calls `runNext` without `pr`.
4. **Skip empty-slice issue** — `runNext` records the issue in operator skips (`emptySliceIssue`) so `selectNextIssue` does not immediately re-queue the same AFK-ready issue.
5. **Reconcile on Start** — `tryReconcileCreatePrNoDiffBlockedHandoff` (ADR 0008 pattern) in `resolveLoopStart` and `runLinearSlice` when `active` is blocked with the create-pr stall reason.
6. **Harness** — `renderHarness` / handoff contract document both outcomes: PR → `/review-pr`, no diff → `/next`.

## Consequences

- Empty slices exit the linear pipeline without a permanent `blocked` stall.
- Issue #n remains on GitHub but is skipped locally until the operator unskips (same as dashboard Skip).
- False positives require both git no-diff and handoff shape; git failure does not auto-unblock.

## Alternatives considered

- **Prompt-only** — agents still wrote `blocked`; host must enforce.
- **Always unblock create-pr `blocked`** — unsafe for real create-pr failures (auth, gh errors).

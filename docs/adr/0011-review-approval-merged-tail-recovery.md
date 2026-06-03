# ADR 0011: Handoff approval, review follow-ups, and merged-tail recovery

## Status

Accepted

## Context

Agents running `/review-pr` often cannot post a GitHub `APPROVE` review on their own PR. They then write `acceptanceState: "blocked"` and procedural text (“different maintainer must approve”), which stalls the host (`Handoff acceptanceState is blocked, expected done`) even though the merge gate only checks **handoff** `verdict: "approve"`, not GitHub reviews (see `CONTEXT.md` **PR approved**).

ADR 0009 ignores `blockers` at `review-pr` only when `verdict !== "approve"`. Operators want `verdict: "approve"` with nits in `blockers[]` to still advance to `/review-tdd`.

Separately, slices sometimes reach **`MERGED`** on GitHub before the linear pipeline finishes (`review-tdd` approve, `/next`). The slice blocks at `merge` (“no open PR”) or earlier; fixes may exist only on `main` locally (issue #101 / PR #113).

`/review-tdd` already reconciles procedural-only `acceptanceState: "blocked"`; `/review-pr` does not.

## Decision

1. **Approval signal:** **PR approved** means handoff `verdict: "approve"` only. GitHub self-approval limits are not pipeline blockers.
2. **Routing:** After `/review-pr`, always `nextSkill: "/review-tdd"` — including when the code meets the approval bar. `/review-tdd` implements blockers, suggestions, and nits in slice scope.
3. **Advance at review-pr:** Do not halt `advanceSlice` on non-empty `blockers` when `phase === "review-pr"`, `acceptanceState === "done"`, and `nextSkill === "/review-tdd"` — for **both** `verdict: "request-changes"` and `verdict: "approve"` (extends ADR 0009).
4. **Procedural reconcile at review-pr:** On **Start**, when `review-pr` handoff is `acceptanceState: "blocked"` and every `blockers` entry matches procedural merge text (reuse `isProceduralMergeBlockerText`), normalize to `acceptanceState: "done"`, remove procedural lines from `blockers`, set `nextSkill: "/review-tdd"`, resume at `review-tdd`.
5. **Prompts:** Mirror `/review-tdd` harness guidance on `/review-pr`: never `acceptanceState: "blocked"` for procedural GitHub constraints; use comment-only GitHub review when `gh pr review --approve` is disallowed; set handoff `verdict` per code bar.
6. **Merged-tail entry:** When the slice is `blocked` at `review-pr`, `review-tdd`, or `merge` and `gh` shows the slice PR `MERGED`, enter **merged-tail recovery** (on Start and after phase failure).
7. **Merged-tail flow:** Run a specialized `/review-pr` prompt that reviews the **landed commit on `main`** (not an open PR), then `/review-tdd`, then `/next` when recovery succeeds.
8. **Fix landing:** `/review-tdd` in merged-tail pushes to `main` when allowed; on protected-branch failure, open a follow-up PR and run `create-pr` → … → `merge`.
9. **Exhaustion:** Default **2** full merged-tail recovery cycles. If still incomplete, force `/next` (do not leave the slice blocked) and record a **recovery warning** in handoff plus dashboard/run outcome (distinct from clean completion and hard `blocked`).

## Consequences

- Issue #101-style procedural stalls at `review-pr` unblock without manual handoff edits.
- Nits can ride in `blockers[]` with `verdict: "approve"` without stopping the host.
- Merged-before-done slices auto-recover instead of dying at `merge` with no open PR.
- Forced `/next` after exhaustion trades quality visibility for pipeline throughput; operators must watch recovery warnings.
- Implementation touches `advance.ts`, `reviewPrRoute.ts`, `reconcileBlockedHandoff.ts`, new merged-tail prompt + orchestration, handoff schema (warning field TBD in code), and dashboard outcome display.

## Related

- ADR 0009 (request-changes blockers bypass)
- ADR 0006 (babysit at merge tail)
- ADR 0008 (schema reconcile on Start)
- `CONTEXT.md` glossary: PR approved, Review pass, Review follow-ups, Procedural review stall, Merged-tail recovery, Merged-tail fix landing, Merged-tail entry, Merged-tail exhaustion, Recovery warning

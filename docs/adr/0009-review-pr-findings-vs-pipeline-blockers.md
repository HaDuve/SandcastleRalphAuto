# ADR 0009: review-pr findings in `blockers` vs pipeline halt

## Status

Accepted

## Context

`/review-pr` with **Request changes** routes to `/review-tdd` via `nextSkill`. Reviewers often list findings in `blockers[]` (the handoff field name). The orchestrator treated any non-empty `blockers` as a **pipeline halt**, leaving the slice `blocked` at `review-pr` even when `nextSkill` was `/review-tdd`.

Separately, the merge gate used the **cached review-pr handoff** (`request-changes`, `nextSkill: /review-tdd`). That made red CI at merge tail classify as **human** instead of **babysit-able**, skipping the one `/babysit` retry (ADR 0006).

## Decision

1. **Advance:** When `phase === "review-pr"`, `acceptanceState === "done"`, and `nextSkill === "/review-tdd"` (and `verdict` is not `approve`), ignore `blockers` for `advanceSlice` failure (findings are for `review-tdd`, not a host stop). `verdict` may be omitted.
2. **Reconcile:** On **Start**, if `active` is blocked with reason `Handoff has blockers: …` at `review-pr` and the worktree/host handoff matches that route, resume at `review-tdd`.
3. **Merge tail:** `resolveHandoffForMergeGate` prefers **host** handoff when `phase !== "review-pr"` (post–review-tdd). `classifyMergeTailBlock` treats `/review-tdd` routing as human **only** while `handoff.phase === "review-pr"`.
4. **Red CI after review-tdd:** No extra host stop before `merge`. The slice runs `merge` → merge gate; if required checks are still red, run **one** `/babysit` then retry merge (ADR 0006).

## Consequences

- Issue slices stuck on review-pr with populated `blockers` unblock on Start without manual `active.json` edits.
- Operators still see real pipeline blocks (wrong `nextSkill`, missing `PHASE_COMPLETE`, etc.).
- `review-tdd` should clear `blockers` and set `verdict: "approve"` when fixes are done so the merge gate can pass the approve check.

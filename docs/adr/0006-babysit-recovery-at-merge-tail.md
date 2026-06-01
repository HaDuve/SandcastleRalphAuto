# Babysit recovery at the merge tail

The v0 pipeline (`docs/adr` 0002, PRD §4) is strictly linear with no repair phase:
`/tdd → /create-pr → /review-pr → /review-tdd → /merge`, then host `/next`. When the
host merge gate (`runMergeGate`) can't proceed — required `ci` check red, the PR not
mergeable (conflicts), or open blockers — the slice is marked `blocked` and the Run stops
for an operator. PRD §4 stated this explicitly: "there is no automated CI-repair phase in
v0." In practice many merge-tail blocks are mechanically fixable (a flaky-but-real CI
failure scoped to the PR, a base-branch conflict, an unresolved Bugbot comment) and don't
warrant waking a human.

The `/babysit` skill already exists for exactly this: get a PR merge-ready by resolving
conflicts, triaging comments, and fixing CI in a loop. The `/merge` skill's own documented
pipeline is `… → /review-tdd → /babysit (if needed) → /merge`.

## Decision

1. **Add a conditional `/babysit` recovery phase at the merge tail.** It is **not** part of
   the linear `CANONICAL_PHASES` loop and never runs on the happy path. It is invoked only
   when the merge gate returns `blocked` for a **babysit-able** reason.
2. **Classify blocked reasons (deep module, pure).** Babysit-able = required CI red, PR not
   mergeable / conflicts, unresolved review comments. **Human** = no clean `Approve` verdict,
   review findings needing re-implementation (route to `/review-tdd`, not babysit), or
   logical blockers. Human reasons skip babysit and block immediately.
3. **`/babysit` is an agent phase.** A cold `cursor("auto")` run like the other phases —
   reads the handoff + GitHub, can push commits, uses `maxIterations > 1` (it watches CI in
   a loop like `tdd`). Prompt is a pinned snapshot of `~/.cursor/skills/babysit/SKILL.md` +
   the headless harness, refreshed via `sync-skills` (ADR 0004). `babysit`'s expected
   `nextSkill` is `/merge`.
4. **Re-run `/merge` after babysit, then bound the loop.** After `/babysit`, re-run the host
   merge gate once. **Cap = 1 babysit attempt per slice.** If the gate is still blocked after
   the retry, mark the slice `blocked` for a human. No unbounded repair loops.

## Consequences

- The Run survives the common, mechanical merge-tail failures without a human, increasing
  AFK throughput — the original goal (PRD §1).
- The happy path is unchanged: zero extra agent invocations, zero extra cost when the gate
  passes first try.
- Non-fixable blocks (real review findings, missing approval, logic bugs babysit can't
  scope) still stop fast for a human — babysit is not a catch-all retry.
- `babysit` becomes a resumable active phase (operator can resume a slice mid-babysit), so
  the resume path must accept it even though it is outside `CANONICAL_PHASES`.
- Reverses the PRD §4 "no `/babysit` in v0" line; PRD §4 and `CANONICAL_PHASES` are updated
  to document the conditional tail.

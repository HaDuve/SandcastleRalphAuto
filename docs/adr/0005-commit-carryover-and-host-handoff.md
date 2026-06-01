# Phase carry-over: commit code, host-own the handoff, unify the branch

Every phase runs as a cold `cursor("auto")` invocation; the only carry-over between phases is meant to be the handoff plus git state. In practice the phase prompts told the agent to write the handoff and emit `PHASE_COMPLETE` but **never to commit**. Sandcastle's sync-out and `/next` are commit-based (`"No commits to sync out"`), so a phase's work and handoff persisted only as a **dirty worktree** that Sandcastle happens to preserve and reuse for the next same-branch run.

That reuse is fragile and undocumented in our design: a clean `close()`, a sandbox-provider switch, or `create-pr`'s own branch resolution (`current if not main/master → else feat/<slug>-<issue>`) can strand the uncommitted work and produce the observed "broke randomly / no commit / maybe wrong branch" failure (`issue-29.log`).

## Decision

1. **Agent commits code (harness-driven).** Each phase prompt ends by staging changed paths and committing before emitting `PHASE_COMPLETE`. Work persists on the branch; Sandcastle sync-out finds commits.
2. **Host owns the handoff (off-git).** The orchestrator reads/writes `current.json` on **host disk** (`state/<projectId>/handoff/`), not inside the worktree. Carry-over no longer depends on whether the agent committed `.sandcastle-ralph/`.
3. **One branch identity.** `issue-<n>` (`branchForIssue`) is the single source of truth. `create-pr` checks out the existing `issue-<n>` branch and never invents `feat/<slug>-<n>`.

## Consequences

- Carry-over is robust against agent forgetfulness and against dirty-worktree-reuse quirks.
- The handoff is no longer visible in the PR diff (it lives host-side) — acceptable; it is operator/orchestrator state, not product code.
- `create-pr`'s branch-resolution table is overridden by the harness to pin `issue-<n>`; the skill snapshot stays intact but the harness asserts the branch.
- Phase logs are written per phase (`<branch>-<phase>.log`) instead of colliding on `<branch>.log`, so each phase's output is independently readable (supports operator log review and stop-reason diagnosis).

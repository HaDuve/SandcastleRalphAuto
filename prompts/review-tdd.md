<!-- sandcastle-ralph:harness -->
# Headless harness (SandcastleRalphAuto)

You are running phase `review-tdd` AFK. Do not ask questions; use only the handoff and GitHub.

## Inputs

1. Use the inline handoff JSON below.
2. Load the linked GitHub issue (`project` + `issue` from the handoff).

## Inline handoff (JSON)

The current handoff is included inline below. Do **not** attempt to read `.sandcastle-ralph/handoff/current.json` to start this phase.

```json
__SANDCASTLE_RALPH_INLINE_HANDOFF_JSON__
```

## Git branch

The host checked out `handoff.branch` before this run. It is always `issue-<handoff.issue>` — stay on that branch for all git work in this phase.
Do not create or switch to `feat/<slug>-<n>` or other branch names.


## Review-tdd AFK rules

- Land fixes on `handoff.branch` with commit + push. If the slice PR is already **MERGED** (merged-tail recovery), push to `main` when allowed; if `main` is protected, open a **follow-up PR** via normal commits on the issue branch — do not leave fixes only in a local worktree.
- Finish with `acceptanceState: "done"`, `verdict: "approve"`, cleared `blockers`, and `nextSkill: "/merge"` when in-scope review work is complete.

## Handoff contract (`current.json`)

Required JSON (host validates with Zod after this phase):

- `project` — `owner/repo`
- `issue` — number
- `branch` — `issue-<issue>` for this pipeline
- `pr` — optional PR number (set once a PR exists)
- `phase` — must be `"review-tdd"` for this run (allowed values: "tdd", "create-pr", "review-pr", "review-tdd", "babysit", "merge", "next")
- `acceptanceState` — one of: "in-progress" | "done" | "blocked". When this phase **finishes successfully**, use `"done"` — **not** `"complete"`, `"finished"`, or other words.
- `verdict` — optional: `"approve"` | `"request-changes"` | `"n/a"`
- `blockers` — string array (empty when unblocked)
- `mergeReady` — boolean
- `nextSkill` — for this phase when done: `"/merge"`
- `startedAt` / `endedAt` — ISO-8601 timestamps

Example when this phase is complete:

```json
{
  "project": "owner/repo",
  "issue": 29,
  "branch": "issue-29",
  "phase": "review-tdd",
  "acceptanceState": "done",
  "blockers": [],
  "mergeReady": false,
  "nextSkill": "/merge",
  "startedAt": "2026-06-01T00:00:00.000Z",
  "endedAt": "2026-06-01T01:00:00.000Z"
}
```

## Outputs (in order)

1. **Commit** — stage only the paths you changed in this phase (not blind `git add -A` unless the skill explicitly requires it). Commit with a message matching repo style (1–2 sentences, focus on **why**). **Do not create an empty commit**; if there are no file changes from this phase, skip this step.
2. **Handoff** — write `.sandcastle-ralph/handoff/current.json` per the **Handoff contract** above.
3. **Signal** — emit `<promise>PHASE_COMPLETE</promise>` as the final line of your response.

<!-- /sandcastle-ralph:harness -->

<!-- sandcastle-ralph:skill-snapshot source=~/.cursor/skills/review-tdd/SKILL.md -->
---
name: review-tdd
description: After /review-pr, implement every review blocker (and in-scope suggestions/nits) using vertical-slice TDD on the PR branch. Use when the user runs /review-tdd, says "fix the review findings", or wants to address PR review blockers test-first.
disable-model-invocation: true
---

# Review → TDD

Implements review findings on the **PR branch**. Runs **after** `/review-pr` (or an equivalent review already posted in chat/GitHub).

Pair with `/babysit` for merge conflicts, CI, and review-comment loops after fixes land. When fixes are pushed and green, hand off to **`/merge`**.

## Core mandate

> /tdd implement all of the PRs reviewers blockers! (and suggestions and nits if they fit into the issues scope)

## Quick start

```
/review-tdd
/review-tdd 42
/review-tdd https://github.com/org/repo/pull/42
```

## Workflow

### 1. Establish context

- [ ] PR number/URL (from args, or last PR in the thread)
- [ ] Checkout the PR branch locally (`gh pr checkout <n>` when needed)
- [ ] Read `CONTEXT.md`, linked issue(s), and ADRs for touched layers

### 2. Collect findings (source of truth)

Use the **most recent** review for this PR, in order:

1. **This chat** — `/review-pr` output (**## Blockers**, **## Suggestions**, **## Nits**, **## Acceptance criteria**)
2. **GitHub** — latest review body and inline comments: `gh pr view <n> --json reviews,comments` and/or open review threads

Build a working list:

| Item | Severity                   | In slice scope? | Action            |
| ---- | -------------------------- | --------------- | ----------------- |
| …    | Blocker / Suggestion / Nit | yes / no        | implement / defer |

**Implement**

- Every **Blocker** (merge-blocking)
- **Suggestions** and **Nits** only when they fit the linked issue / slice scope (same feature, same acceptance criteria, no new product surface)

**Defer** (note in chat; do not implement)

- Out-of-slice scope creep, unrelated refactors, repo-wide architecture
- Items that need a **new issue** or `/grill-with-docs` before coding
- Formal **Approve** with zero open blockers and nothing in-scope left — report "nothing to implement" and stop

If findings are missing or ambiguous, ask once; do not guess blockers.

### 3. Plan (short)

- [ ] Order work: **blockers first**, then in-scope suggestions, then in-scope nits
- [ ] One tracer bullet per finding (behavior to prove, public interface)
- [ ] Skip horizontal "all tests then all code" — see [/tdd](../tdd/SKILL.md)

Do **not** re-run a full `/review-pr` unless the user asks.

### 4. Implement with TDD

For **each** in-scope finding, one vertical slice:

```
RED   → test for the behavior the review demanded (public API)
GREEN → minimal change on the PR branch to pass
REFACTOR → only while green; run project tests after each item
```

Follow [../tdd/SKILL.md](../tdd/SKILL.md) (philosophy, anti-patterns, per-cycle checklist). Read [../tdd/tests.md](../tdd/tests.md) / [../tdd/mocking.md](../tdd/mocking.md) when mocking choices matter.

Rules:

- Tests assert **behavior**, not implementation shape
- Minimal diff per finding; no speculative features
- Domain names from `CONTEXT.md`
- Do **not** weaken CI or skip hooks to go green

### 5. Verify and close the loop

- [ ] Run the same verification the review expected (e.g. `pnpm test`, typecheck) for touched packages
- [ ] Mark each finding **done** or **deferred** in the summary
- [ ] Commit/push to the same feature branch

## Out of scope

| Use instead                                                               |
| ------------------------------------------------------------------------- |
| Writing the initial review → `/review-pr`                                 |
| Merge conflicts, pushing CI fixes, threading review replies → `/babysit`  |
| Redesigning the feature → `/grill-with-docs`                              |
| Broad refactors beyond review findings → `/improve-codebase-architecture` |

## Chat summary (when done)

```md
## review-tdd

### Implemented

- [ ] Blocker: …
- [ ] Suggestion (in scope): …

### Deferred

- … (reason: out of slice / needs issue / …)

### Verification

- … (commands run, pass/fail)

**Merge-ready:** yes | no — yes only when every in-scope blocker/suggestion/nit and partial acceptance item from the review is under **Implemented** (none left open in scope)
```

**PR:** #n — link

When **Merge-ready: yes**, `/merge` may proceed without a follow-up `/review-pr` Approve.

**AFK handoff:** If there is no in-scope code left to implement, still write `acceptanceState: "done"` and `nextSkill: "/merge"`. Red required CI after your push is fixed by **`/babysit`** (host may run it before `/merge`), not by blocking this phase.
<!-- /sandcastle-ralph:skill-snapshot -->


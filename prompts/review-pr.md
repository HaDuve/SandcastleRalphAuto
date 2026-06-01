<!-- sandcastle-ralph:harness -->
# Headless harness (SandcastleRalphAuto)

You are running phase `review-pr` AFK. Do not ask questions; use only the handoff and GitHub.

## Inputs

1. Read `.sandcastle-ralph/handoff/current.json` (JSON handoff from the prior phase).
2. Load the linked GitHub issue (`project` + `issue` from the handoff).

## Git branch

The host checked out `handoff.branch` before this run. It is always `issue-<handoff.issue>` — stay on that branch for all git work in this phase.
Do not create or switch to `feat/<slug>-<n>` or other branch names.

## Handoff contract (`current.json`)

Required JSON (host validates with Zod after this phase):

- `project` — `owner/repo`
- `issue` — number
- `branch` — `issue-<issue>` for this pipeline
- `pr` — optional PR number (set once a PR exists)
- `phase` — one of: "tdd", "create-pr", "review-pr", "review-tdd", "babysit", "merge", "next"
- `acceptanceState` — one of: "in-progress" | "done" | "blocked". When this phase **finishes successfully**, use `"done"` — **not** `"complete"`, `"finished"`, or other words.
- `verdict` — optional: `"approve"` | `"request-changes"` | `"n/a"`
- `blockers` — string array (empty when unblocked)
- `mergeReady` — boolean
- `nextSkill` — next phase skill, e.g. `"/create-pr"`
- `startedAt` / `endedAt` — ISO-8601 timestamps

Example when the phase is complete:

```json
{
  "project": "owner/repo",
  "issue": 29,
  "branch": "issue-29",
  "phase": "tdd",
  "acceptanceState": "done",
  "blockers": [],
  "mergeReady": false,
  "nextSkill": "/create-pr",
  "startedAt": "2026-06-01T00:00:00.000Z",
  "endedAt": "2026-06-01T01:00:00.000Z"
}
```

## Outputs (in order)

1. **Commit** — stage only the paths you changed in this phase (not blind `git add -A` unless the skill explicitly requires it). Commit with a message matching repo style (1–2 sentences, focus on **why**). **Do not create an empty commit**; if there are no file changes from this phase, skip this step.
2. **Handoff** — write `.sandcastle-ralph/handoff/current.json` per the **Handoff contract** above.
3. **Signal** — emit `<promise>PHASE_COMPLETE</promise>` as the final line of your response.

<!-- /sandcastle-ralph:harness -->

<!-- sandcastle-ralph:skill-snapshot source=~/.cursor/skills/review-pr/SKILL.md -->
---
name: review-pr
description: Critical PR review — slice acceptance, domain/ADR compliance, security, and thermo-level maintainability (structure, spaghetti, decomposition). Posts via gh pr review by default. Use when the user asks to review a PR, code review before merge, or /review-pr with a PR number or URL.
---

# Review PR

Read-only review unless the user asks to fix findings. **Next step:** `/review-tdd` to implement blockers (and in-scope suggestions/nits) with TDD, then `/babysit` if needed, then **`/merge`**. Also pair with `/tdd` ad hoc.

**Analyze the PR as if you are a senior that had a really bad day.** Default skeptical. Approval is earned by evidence, not by a clean diff or polite PR description.

## Review mindset

- Assume the happy path works and the author did not prove edge cases, failure modes, concurrency, or rollback.
- Read the diff *and* what it omits: missing tests, missing migrations, missing error handling, missing acceptance-criteria wiring.
- Treat “looks fine” as insufficient — trace one money/authority path mentally (e.g. expense → split → balance, or tick → ledger); if you cannot, that is a finding.
- Hunt **code judo**: reframes that delete branches, helpers, or layers while preserving behavior.
- Do not approve “works but messier” — apply the same skepticism to structure as to domain correctness.
- Prioritize **few high-conviction** comments over nit floods when structural or domain issues exist.
- **Approve** only when you would bet your own on-call on this merge. If you would only “probably ship,” use **Request changes** or **Comment only**.
- Prefer **Request changes** over rubber-stamping when criteria are **partial** or tests only cover mocks/stubs.
- Be direct in blockers; no softening. Still skip style nits the repo does not enforce.

## Quick start

```
/review-pr 42
/review-pr https://github.com/org/repo/pull/42
```

1. Resolve PR number/URL; fetch diff, description, linked issues (`gh pr view`, `gh pr diff`).
2. Read repo `CONTEXT.md`, relevant `docs/adr/`, and `docs/agents/domain.md` when present.
3. If the PR references a slice issue, verify acceptance criteria from that issue body.
4. Follow [REFERENCE.md](REFERENCE.md) (workflow, output format, GitHub publishing).
5. Apply [CODE-QUALITY.md](CODE-QUALITY.md) on every review (always on).
6. Use [CHECKLIST.md](CHECKLIST.md) when it matches the repo; otherwise derive checks from `CONTEXT.md` and ADRs.
7. **Post the review on GitHub** unless the user says **chat only** or **do not post**.

## Scope

| In scope | Out of scope (use other skills) |
| --- | --- |
| Correctness vs domain rules and ADRs | Implementing review findings → `/review-tdd` (or `/tdd`) |
| Slice completeness vs issue acceptance criteria | Resolving merge conflicts, pushing CI fixes → `/babysit` |
| Test quality (behavior vs implementation) | Product/design re-litigation → `/grill-with-docs` |
| Security, auth, transactional money/ledger risks | Repo-wide architecture tours, HTML reports, multi-module redesign → `/improve-codebase-architecture` |
| Structural regressions in the **diff** (spaghetti branches, wrong layer, file sprawl past ~1k lines, magic wrappers, cast churn) | |
| Missed **in-PR** simplification when a plausible reframe deletes complexity | |
| File decomposition when the PR crosses a healthy size boundary | |

Do not approve when any **Blocker** is open, any acceptance criterion is **no** or **partial** without an explicit justified deferral in the issue, or new behavior lacks tests. Do not nitpick style the repo does not enforce.

## Approval bar

Do not set **## Verdict** to **Approve** unless **all** of the following hold:

- No open **Blockers** (domain, security, acceptance, **or** structural per [CODE-QUALITY.md](CODE-QUALITY.md))
- No acceptance criterion **no** / **partial** without justified deferral in the linked issue
- Verification run when the PR touches runnable code (see [REFERENCE.md](REFERENCE.md))
- No obvious **code-judo** path left on the table that would materially simplify the change within PR scope
- No unjustified file growth past ~**1000 lines**, ad-hoc branching in shared paths, duplicate canonical helpers, or feature logic leaking into generic modules (unless the PR justifies clearly)

When in doubt between **Approve** and **Request changes**, choose **Request changes**.

## Companion files

| File | Purpose |
| --- | --- |
| [REFERENCE.md](REFERENCE.md) | Workflow, review output template, GitHub publishing |
| [CODE-QUALITY.md](CODE-QUALITY.md) | Thermo-level maintainability bar (always on) |
| [CHECKLIST.md](CHECKLIST.md) | Project domain patterns; repo `CONTEXT.md` is authoritative |

Further: test bar aligns with `/tdd` — `../tdd/tests.md` when present.

**Note:** A copy under `.claude/skills/review-pr/` may be stale; this directory is canonical for Cursor.
<!-- /sandcastle-ralph:skill-snapshot -->


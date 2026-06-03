<!-- sandcastle-ralph:harness -->
# Headless harness (SandcastleRalphAuto)

You are running phase `merge` AFK. Do not ask questions; use only the handoff and GitHub.

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


## Handoff contract (`current.json`)

Required JSON (host validates with Zod after this phase):

- `project` — `owner/repo`
- `issue` — number
- `branch` — `issue-<issue>` for this pipeline
- `pr` — optional PR number (set once a PR exists)
- `phase` — must be `"merge"` for this run (allowed values: "tdd", "create-pr", "review-pr", "review-tdd", "babysit", "merge", "next")
- `acceptanceState` — one of: "in-progress" | "done" | "blocked". When this phase **finishes successfully**, use `"done"` — **not** `"complete"`, `"finished"`, or other words.
- `verdict` — optional: `"approve"` | `"request-changes"` | `"n/a"`
- `blockers` — string array (empty when unblocked)
- `mergeReady` — boolean
- `nextSkill` — for this phase when done: `"/next"`
- `startedAt` / `endedAt` — ISO-8601 timestamps

Example when this phase is complete:

```json
{
  "project": "owner/repo",
  "issue": 29,
  "branch": "issue-29",
  "phase": "merge",
  "acceptanceState": "done",
  "blockers": [],
  "mergeReady": true,
  "nextSkill": "/next",
  "startedAt": "2026-06-01T00:00:00.000Z",
  "endedAt": "2026-06-01T01:00:00.000Z"
}
```

## Outputs (in order)

1. **Commit** — stage only the paths you changed in this phase (not blind `git add -A` unless the skill explicitly requires it). Commit with a message matching repo style (1–2 sentences, focus on **why**). **Do not create an empty commit**; if there are no file changes from this phase, skip this step.
2. **Handoff** — write `.sandcastle-ralph/handoff/current.json` per the **Handoff contract** above.
3. **Signal** — emit `<promise>PHASE_COMPLETE</promise>` as the final line of your response.

<!-- /sandcastle-ralph:harness -->

<!-- sandcastle-ralph:skill-snapshot source=~/.cursor/skills/merge/SKILL.md -->
---
name: merge
description: >-
  Final merge gate after /review-tdd or /babysit — verify CI green, in-scope
  review findings addressed (Approve OR post-review fix commits), then
  squash-merge the PR, close linked issues, and delete the branch. Use for
  /merge, merge PR, or ship/land after review fixes.
disable-model-invocation: true
---

# Merge PR

**Read-only gate + merge.** Does not implement fixes. Runs after `/review-tdd` or `/babysit`.

Pipeline: `/tdd` → `/create-pr` → `/review-pr` → `/review-tdd` → `/babysit` (if needed) → **`/merge`**

Pair with `/babysit` when pre-flight fails (CI, conflicts). Pair with `/review-tdd` when in-scope findings remain open.

## Resolve (once)

| | Priority |
|---|---|
| PR | user arg → current branch PR → last PR in chat |
| Merge method | user flag → repo default → `--squash` |
| Base | `main` unless user says otherwise |

```
/merge
/merge 42
/merge 42 --merge
```

## Safety

- `gh` for GitHub; merge/delete: `required_permissions: ["all"]`
- **Never** `--admin` unless user explicitly asks to bypass branch protection
- **Never** merge with failing or pending **required** checks
- **Never** merge with open **Blockers** still unaddressed
- **Never** force-push `main`/`master`
- No TodoWrite/Task. No code changes unless local branch cleanup after merge
- User says **merge anyway** / **override** → merge if CI + mergeable; note waived gates in chat

## 1. Pre-flight

Parallel:

```bash
gh pr view <n> --json number,url,title,state,isDraft,mergeable,mergeStateStatus,reviewDecision,headRefName,baseRefName,body,statusCheckRollup,commits,reviews,latestReviews
gh pr checks <n> --required --json name,state,bucket,link
```

If any required check is pending, watch (cap ~15 min):

```bash
gh pr checks <n> --required --watch --fail-fast
```

Review threads (filter payload — read only `isResolved`, `isOutdated`, path, one-line summary):

```bash
gh api graphql -f query='
  query($owner: String!, $repo: String!, $n: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $n) {
        reviewThreads(first: 100) {
          nodes { isResolved isOutdated comments(last: 1) { nodes { body path } } }
        }
      }
    }
  }' -f owner=OWNER -f repo=REPO -F n=<n>
```

Read **this chat** for latest `/review-pr` and `/review-tdd` summaries.

### Hard gates (must pass)

| Gate | Pass when |
| --- | --- |
| State | `OPEN`, not draft |
| Mergeable | `mergeStateStatus` is `CLEAN` or `mergeable` is `MERGEABLE` |
| CI | Every **required** check `bucket` is `pass` (or `skipping` if allowed) |
| Blockers | No open **## Blockers** in latest review **and** every listed blocker is addressed (see §2) |

### Review satisfaction (pass if **either** path holds)

Do **not** require a second `/review-pr` or formal GitHub **Approve** when Path B passes.

#### Path A — Explicit approve

Latest review **## Verdict** is **Approve** and acceptance table has no **no** without justified deferral in linked issue.

#### Path B — Findings addressed (default after `/review-tdd`)

Use when latest verdict is **Comment only** or **Request changes** but fixes landed **after** that review.

1. **Collect in-scope findings** from latest review: **Blockers**, **Suggestions**, **Nits**, and acceptance rows marked **partial** / **no** that the review tied to actionable work (not “deferred in issue”).
2. **Collect fix evidence** (all that apply):
   - `/review-tdd` chat summary: every in-scope item under **Implemented**; nothing in-scope left under open **Deferred**
   - Commits on the PR **after** the latest review’s `submittedAt` (or after review commit OID if present)
   - `gh pr diff` / `git diff <review-head>..HEAD` — changes touch paths and behavior each finding requested
3. **Judge each in-scope finding** addressed if fix evidence covers it. Partial acceptance rows pass when the post-review diff + tests (green CI) cover what the review asked for — you do not need a human to re-verify in browser unless the finding explicitly demanded manual QA **and** no automated test or diff evidence exists.
4. **Outdated unresolved threads** do **not** block. Non-outdated unresolved threads block **only** when they map to a finding still not addressed in step 3.

Path B passes when: zero open blockers, all in-scope suggestions/nits/blockers/ partial acceptance items from step 1 are addressed per step 3, CI green.

**Fail Path B** → stop; route to `/review-tdd` (missing fixes) not `/review-pr` (re-review is optional, not required for merge).

```bash
# Commits after latest review (adjust review ISO timestamp from latestReviews)
gh pr view <n> --json commits --jq '.commits[] | select(.committedDate > "<review-submittedAt>") | {oid, messageHeadline, committedDate}'

# Diff since review (use head OID at review time if known, else parent of first post-review commit)
git fetch origin pull/<n>/head:pr-<n> 2>/dev/null || gh pr checkout <n>
git log --oneline <since>..HEAD
git diff <since>..HEAD -- <paths-from-inline-comments>
```

## 2. Blocker / finding checklist

Build a table before merge decision:

| Finding | Source | In scope? | Addressed? | Evidence |
| --- | --- | --- | --- | --- |
| … | review § / thread | yes | yes/no | commit / diff / review-tdd |

Merge only when every **in-scope** row is **yes** (or user override).

## 3. On failure

Stop. Do **not** merge. Reply with:

```md
## merge — blocked

| Gate / finding | Status |
| --- | --- |
| … | … |

**Why merge stopped:** …

**Next:** `/review-tdd` (open in-scope findings) or `/babysit` (CI/conflicts)
```

Do **not** default to “re-run `/review-pr`” when Path B almost passes — name the specific unaddressed finding instead.

## 4. Merge

```bash
gh pr merge <n> --squash -d -t "<title> (#<n>)"
# or: --merge | --rebase; add --auto if protection requires it
```

`-d` deletes the **remote** head branch. No `--admin` unless user explicitly requested bypass.

## 5. Post-merge verify

```bash
gh pr view <n> --json state,mergedAt,mergedBy
gh issue view <linked> --json state   # for each Closes #n in PR body
git fetch origin
git checkout <base> && git pull --ff-only origin <base>
git branch -d <headRefName> 2>/dev/null || true
```

## Chat summary (success)

```md
## merge

**Merged:** #<n> — <url>
**Method:** squash | merge | rebase
**Branch deleted:** `<headRefName>` (remote + local if present)
**Issues closed:** #…

**CI:** all required checks passed
**Review:** Approve | findings addressed since review (<commit-ish>)
```

**Reply:** merged PR URL + closed issue numbers.

## Out of scope

| Use instead |
| --- |
| Fix CI, conflicts → `/babysit` |
| Implement review findings → `/review-tdd` |
| Optional second opinion → `/review-pr` |
| Open PR → `/create-pr` |
<!-- /sandcastle-ralph:skill-snapshot -->


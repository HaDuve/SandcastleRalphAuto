<!-- sandcastle-ralph:harness -->
# Headless harness (SandcastleRalphAuto)

You are running phase `create-pr` AFK. Do not ask questions; use only the handoff and GitHub.

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

For this AFK run, **ignore** the create-pr skill's branch-resolution table in the skill snapshot. Use only `handoff.branch`.

## No-diff shortcut (unblock automation)

If `git log origin/main..HEAD --oneline` is empty **and** `git diff origin/main...HEAD` is empty, there is no diff to open a PR for. In that case:

- Do **not** mark the handoff `blocked`.
- Write the handoff as `acceptanceState: "done"`, `blockers: []`, `pr` omitted, and set `nextSkill: "/next"` so the host advances the queue.


## Handoff contract (`current.json`)

Required JSON (host validates with Zod after this phase):

- `project` — `owner/repo`
- `issue` — number
- `branch` — `issue-<issue>` for this pipeline
- `pr` — optional PR number (set once a PR exists)
- `phase` — must be `"create-pr"` for this run (allowed values: "tdd", "create-pr", "review-pr", "review-tdd", "babysit", "merge", "next")
- `acceptanceState` — one of: "in-progress" | "done" | "blocked". When this phase **finishes successfully**, use `"done"` — **not** `"complete"`, `"finished"`, or other words.
- `verdict` — optional: `"approve"` | `"request-changes"` | `"n/a"`
- `blockers` — string array (empty when unblocked)
- `mergeReady` — boolean
- `nextSkill` — when done with a PR: `"/review-pr"`; when **no diff vs main** (no PR): `"/next"`
- `startedAt` / `endedAt` — ISO-8601 timestamps

Example when this phase is complete:

```json
{
  "project": "owner/repo",
  "issue": 29,
  "branch": "issue-29",
  "phase": "create-pr",
  "acceptanceState": "done",
  "blockers": [],
  "mergeReady": false,
  "nextSkill": "/review-pr",
  "startedAt": "2026-06-01T00:00:00.000Z",
  "endedAt": "2026-06-01T01:00:00.000Z"
}
```

Example when there is **no diff** (no PR; host advances queue):

```json
{
  "project": "owner/repo",
  "issue": 95,
  "branch": "issue-95",
  "phase": "create-pr",
  "acceptanceState": "done",
  "blockers": [],
  "mergeReady": false,
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

<!-- sandcastle-ralph:skill-snapshot source=~/.cursor/skills/create-pr/SKILL.md -->
---
name: create-pr
description: >-
  Check out the feature branch, commit, push, and open a GitHub PR with
  Closes/Fixes when the linked issue is open. Use for /create-pr, ship/open PR,
  or agent pipelines.
disable-model-invocation: true
---

# Create PR

Branch → commit → push → PR. **Minimal reads** (git/gh only). No TodoWrite/Task. No code exploration unless diff is unclear.

## Resolve (once)

| | Priority |
|---|---|
| Branch | user arg → current if not `main`/`master` → `feat/<slug>-<issue>` |
| Issue # | user arg → branch suffix digits → chat |
| Base | `main` unless user says otherwise |

Repo branch shapes: `feat/foo-224`, `feat-foo-244`, `feature/...`.

## Safety

- `gh` for GitHub; push/PR: `required_permissions: ["all"]`
- Never force-push `main`/`master`; no `--no-verify` unless user asked
- No `.env*` / credentials in commit
- No empty commit; no amend unless user rule allows

## No diff vs `main` (Sandcastle AFK)

When `git log origin/main..HEAD --oneline` is empty **and** `git diff origin/main...HEAD` is empty:

- Do **not** set `acceptanceState: "blocked"`.
- Handoff: `acceptanceState: "done"`, `blockers: []`, omit `pr`, `nextSkill: "/next"`.

## 1. Branch

```bash
git fetch origin
BASE=main
```

Wrong branch + local changes:

```bash
git stash push -u -m pr-prep
git checkout -B <branch> origin/$BASE    # new
# or: git checkout <branch> && git pull --ff-only origin <branch>
git stash pop
```

Already on `<branch>`: `git pull --ff-only origin <branch>` when tracking exists.

## 2. Commit + push

Parallel:

```bash
git status
git diff
git log origin/$BASE..HEAD --oneline
```

Stage only changed paths (not `git add -A` unless user said so). Message: repo style, 1–2 sentences, **why**.

```bash
git add <paths>
git commit -m "$(cat <<'EOF'
<message>
EOF
)"
git push -u origin HEAD
```

## 3. Close keywords

For each issue #:

```bash
gh issue view <n> --json state,title
```

| Issue | PR body |
|---|---|
| `OPEN` | `Closes #<n>` (or `Fixes` / `Resolves`) |
| `CLOSED` | no keyword; note in chat |
| missing | no keyword |

Multiple issues: `Closes #1, Closes #2` only if all open.

## 4. PR

If not done in §2, parallel:

```bash
git diff origin/$BASE...HEAD
git log origin/$BASE..HEAD --oneline
```

```bash
gh pr create --base $BASE --title "<title>" --body "$(cat <<'EOF'
## Summary
- ...

## Test plan
- [ ] ...

Closes #<n>
EOF
)"
```

Existing PR on branch: `gh pr view --json url` → update with `gh pr edit` if needed; do not duplicate.

**Reply:** PR URL + which issues close (or why not).
<!-- /sandcastle-ralph:skill-snapshot -->


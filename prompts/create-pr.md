<!-- sandcastle-ralph:harness -->
# Headless harness (SandcastleRalphAuto)

You are running phase `create-pr` AFK. Do not ask questions; use only the handoff and GitHub.

## Inputs

1. Read `.sandcastle-ralph/handoff/current.json` (JSON handoff from the prior phase).
2. Load the linked GitHub issue (`project` + `issue` from the handoff).

## Outputs

1. When the phase work is complete, write an updated handoff to `.sandcastle-ralph/handoff/current.json` (valid per host schema: phase, acceptanceState, blockers, mergeReady, nextSkill, timestamps).
2. Emit `<promise>PHASE_COMPLETE</promise>` as the final line of your response when done.

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

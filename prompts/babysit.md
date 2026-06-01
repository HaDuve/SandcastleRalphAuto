<!-- sandcastle-ralph:harness -->
# Headless harness (SandcastleRalphAuto)

You are running phase `babysit` AFK. Do not ask questions; use only the handoff and GitHub.

## Inputs

1. Read `.sandcastle-ralph/handoff/current.json` (JSON handoff from the prior phase).
2. Load the linked GitHub issue (`project` + `issue` from the handoff).

## Git branch

The host checked out `handoff.branch` before this run. It is always `issue-<handoff.issue>` — stay on that branch for all git work in this phase.
Do not create or switch to `feat/<slug>-<n>` or other branch names.

## Outputs (in order)

1. **Commit** — stage only the paths you changed in this phase (not blind `git add -A` unless the skill explicitly requires it). Commit with a message matching repo style (1–2 sentences, focus on **why**). **Do not create an empty commit**; if there are no file changes from this phase, skip this step.
2. **Handoff** — write an updated handoff to `.sandcastle-ralph/handoff/current.json` (valid per host schema: phase, acceptanceState, blockers, mergeReady, nextSkill, timestamps).
3. **Signal** — emit `<promise>PHASE_COMPLETE</promise>` as the final line of your response.

<!-- /sandcastle-ralph:harness -->

<!-- sandcastle-ralph:skill-snapshot source=~/.cursor/skills/babysit/SKILL.md -->
---
name: babysit
description: >-
  Keep a PR merge-ready by triaging comments, resolving clear conflicts, and
  fixing CI in a loop.
---
# Babysit PR
Your job is to get this PR to a merge-ready state.

Check PR status, comments, and latest CI and resolve any issues until the PR is ready to merge.

1. Merge conflicts: Intelligently resolve any merge conflicts, preserving the intent and correctness of changes on your branch and the base branch. If intents conflict, abort the merge and ask for clarification.
2. Comments: Review active unresolved comments (including Bugbot) and resolve change requests / bug reports where valid. When fetching GitHub comments, filter out resolved threads first. Read only each comment body and the minimum location/URL needed to act on it; do not read the entire JSON output or other unnecessary payload data. Carefully validate issues reported by Bugbot and only take action on those that are valid; explain when you disagree or are unsure.
3. CI: Fix CI issues caused by changes within this PR's scope. Never change CI checks/workflows just to make failures pass, or make unrelated code changes; if that would be required, report back instead. For merge-blocking failures that seem unrelated to this PR, check whether the branch is behind the base branch and merge latest changes, since another PR may have fixed them. Push scoped fixes and re-watch CI until mergeable + green + comments triaged.
<!-- /sandcastle-ralph:skill-snapshot -->

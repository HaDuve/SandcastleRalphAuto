# Unattended auto-merge on Approve + green CI

A slice merges with no human in the loop when `review-pr` returns a clean `Approve` (no open blockers) and all branch-protection required checks are green. This is what makes the `/next` loop genuinely AFK rather than an assisted-review tool. Controlled by a per-project `autoMerge` flag (default `true`).

## Consequences

- Merge goes **through** branch protection via `gh pr merge --squash --auto` — never `--admin`, never force-push to `main`.
- Any blocker or red check halts the slice (`blocked`), surfaces in the dashboard, and prevents `/next` from advancing.
- The operator kill switch always wins over an in-flight run.
- This is the product's defining risk decision: bad code can merge unattended if review misses it. Accepted for low-stakes AFK issues; revisit per-project if it bites.

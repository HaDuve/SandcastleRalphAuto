# SandcastleRalphAuto

A local control plane that runs a fixed, linear vertical-slice pipeline (`/tdd` → `/create-pr` → `/review-pr` → `/review-tdd` → `/merge`, then `/next`) AFK across registered repos, using Cursor's Auto model via Sandcastle, with an operator dashboard for oversight.

## Language

**Slice**:
One unit of work: a single GitHub issue taken from `ready-for-agent` through to a merged PR. The atomic thing the loop processes.
_Avoid_: task, ticket, story

**Phase**:
One step of the canonical pipeline — `tdd`, `create-pr`, `review-pr`, `review-tdd`, `merge` — run linearly, every phase every slice. Each phase is one cold agent invocation; no transcript carries between phases. `next` is host orchestration (no agent), not a skill phase. `babysit` is a **conditional recovery phase** — an agent invocation run only when the merge gate blocks on a fixable reason (CI/conflicts/comments), never on the happy path (ADR 0006).
_Avoid_: step, stage

**PR approved**:
The slice’s PR is approved for automation **only** when the latest handoff has `verdict: "approve"`. A GitHub `APPROVE` review (or lack of one because the author cannot self-approve) is **not** the pipeline’s approval signal — commentary on GitHub is optional evidence.
_Avoid_: GitHub approved, maintainer approved, green review (say **PR approved** or **handoff approve**)

**Review pass (phase routing)**:
After `/review-pr`, the slice **always** continues to `/review-tdd` — even when the code meets the approval bar (`verdict: "approve"`). `/review-tdd` owns follow-up on suggestions and nits (and any request-changes findings); `/merge` runs only after `/review-tdd` finishes with handoff **PR approved**.
_Avoid_: skipping review-tdd on approve, merge straight from review-pr

**Review follow-ups (`blockers`)**:
Strings in handoff `blockers` after `/review-pr` are work for `/review-tdd` — including suggestions and nits when `verdict` is already `"approve"`. They are **not** a host pipeline halt while `nextSkill` is `/review-tdd`. `/review-tdd` should clear `blockers` and set **PR approved** before `/merge`.
_Avoid_: treating nits as merge gate blockers, using `acceptanceState: "blocked"` for review follow-ups

**Procedural review stall**:
GitHub-only constraints (author cannot self-approve, “different maintainer must approve,” branch protection wording) must **never** end a phase as `acceptanceState: "blocked"`. On **Start**, the host reconciles mistaken procedural stalls: `acceptanceState: "done"`, procedural lines removed from `blockers`, `nextSkill` set to `/review-tdd`, then resume at `review-tdd`.
_Avoid_: blocked for maintainer, waiting for human approve on GitHub

**Merged-tail recovery**:
When the slice PR is already **`MERGED`** on GitHub but the pipeline has not finished with **PR approved** through `/review-tdd` and `/next`, the host runs a **merged-tail review** (a specialized `/review-pr` wrapper): review the **landed commit on `main`** (not an open PR), then **`/review-tdd`** for in-scope blockers, suggestions, and nits, then auto-advance to **`/next`** when recovery completes. Prefer auto-fix over blocking whenever the host can drive the next phase.
_Avoid_: leaving the slice blocked at `merge` with “no open PR”, manual-only recovery for this case

**Merged-tail entry**:
Enter merged-tail recovery whenever the slice is **`blocked`** at `review-pr`, `review-tdd`, or `merge` **and** GitHub shows that slice’s PR **`MERGED`** — including on **Start**, after phase failure, and after procedural handoff reconcile. Do not require the operator to pick a special recovery mode.
_Avoid_: merge-only recovery, Start-only detection

**Merged-tail exhaustion**:
Merged-tail recovery retries up to **2** full recovery cycles by default (host-configurable). If recovery still cannot complete, the host **does not leave the slice blocked** — it advances to **`/next`** with an operator-visible **warning** that recovery was skipped (quality risk accepted over pipeline stall).
_Avoid_: infinite merged-tail retry, permanent block after merged PR

**Recovery warning**:
When merged-tail exhaustion forces **`/next`**, the host records the warning in the **handoff** (durable) and surfaces it in the **dashboard / run outcome** (visible without reading logs). Distinct from a clean slice completion and from a hard **blocked** stall.
_Avoid_: silent skip, log-only warnings

**Merged-tail fix landing**:
During merged-tail recovery, `/review-tdd` lands fixes by **pushing to `main` when allowed** (worktree on `issue-<n>`). If `main` is protected or push fails, the host **falls back** to a **follow-up PR** and runs the normal `create-pr` → … → `merge` tail before `/next`.
_Avoid_: uncommitted-only fixes on `main`, assuming `/merge` can run without an open PR

**Merge gate**:
The host-side check that runs after the `merge` phase — no open handoff `blockers`, then GitHub PR state; if the PR is already `MERGED`, the gate succeeds without re-merging (even when handoff `verdict` is `n/a`, e.g. merge agent merged first). On an open PR it requires handoff `verdict: approve`, green required checks, then `gh pr merge --squash --auto`. Uses the latest host handoff after `/review-tdd`, not a stale review-pr snapshot (ADR 0009). A `blocked` merge gate is **babysit-able** (CI red / not-mergeable / unresolved comments → run `/babysit`, retry once) or **human** (open PR without handoff `verdict: approve`, review-pr still routing to `/review-tdd`, logical blockers → stop for operator). Red CI after review-tdd still runs merge and may trigger babysit.
_Avoid_: merge phase (the agent `/merge` run is distinct from the host gate)

**Skill**:
The Cursor skill definition (`~/.cursor/skills/<name>/SKILL.md`) that specifies a phase's behavior. Skills are the **specification**; Sandcastle prompt files are the **runtime** that mirror them.
_Avoid_: prompt (a prompt is the runtime artifact, not the spec)

**Handoff**:
The on-disk record written at the end of every phase and read by the next phase. The **only** carry-over between phases besides GitHub state — never prior agent stdout. Host-side schema normalizes agent synonyms (e.g. `complete` → `done`). A slice blocked only for invalid handoff schema can be reconciled on **Start** from the worktree file (ADR 0008).

**Worker**:
An active execution of the pipeline for one project — holds the project's concurrency slot (mutex) and advances one slice at a time.
_Avoid_: agent (an agent is a single phase invocation; a worker spans many)

**Run**:
One Worker's continuous AFK session — from operator Start until it stops. A Worker holds the slot; a Run is one activation of it. Spans many slices and phases.
_Avoid_: session (ambiguous), job

**Run outcome**:
The terminal reason a Run stopped, surfaced to the operator: `queue-empty` (no eligible issues left), `blocked` (failed/halted slice needing a human), `awaiting-human` (gate paused for a decision), `killed` (operator kill switch), or `error` (unexpected crash).
_Avoid_: failure (covers only `blocked`/`error`)

**AFK**:
"Away From Keyboard" — unattended autonomous operation. An **AFK-ready** issue is labeled `ready-for-agent` and not blocked.

**Auto**:
Cursor's `--model auto` routing. The default (and only, for now) model for every phase. Unlimited on paid Cursor plans, does not draw from the credit pool. Distinct from `composer-2`, which spends credits.
_Avoid_: composer-2 (different billing), AUTO (use "Auto")

**Project**:
A registered repo the orchestrator can run slices against, keyed canonically by `owner/repo`. One concurrency slot per project by default.

**Skip**:
An operator marking an issue as not-to-be-picked, set from the dashboard. Stored in local orchestrator state per project (never on GitHub) and filtered out during selection. Distinct from blocked: a skip is a human's "not this one," not a pipeline failure.
_Avoid_: blocked (blocked = a failed/halted slice; skip = operator exclusion)

**Hide**:
An operator dismissing a Project's card from the dashboard view. Per-browser only (client `localStorage`), reversible via "show all," and never touches `projects.json` or any Run. Operates on a Project; a Skip operates on an issue.
_Avoid_: remove (implies deleting from the registry), skip (skip = issue exclusion)

**Header status**:
The dashboard top bar beside the product title: a **focused** line (one Project the operator is viewing) plus a **fleet** line (aggregate counts across Projects). Answers "what is this project doing?" and "what is the whole bench doing?" without reading each sidebar card.
_Avoid_: status field (ambiguous — sidebar cards also show status; say header status or fleet summary)

**Fleet summary**:
The secondary header line: counts of Projects by worker/run posture (e.g. running, paused, blocked, idle). Distinct from a single Project's focused line.
_Avoid_: global status (vague)

## Example dialogue

> **Dev:** When a worker finishes a slice, does it reuse the same agent for `/next`?
> **Expert:** No. Every phase is a fresh agent invocation. The worker advances the slice by starting a new cold run; the new run reads the handoff and GitHub, nothing else. The worker persists across phases; the agent does not.
> **Dev:** And if review finds a blocker?
> **Expert:** Findings go in the handoff `blockers` field and the slice advances to `/review-tdd` to fix them (ADR 0009). The pipeline only halts on real orchestration failures (wrong `nextSkill`, missing completion signal, merge gate without handoff `verdict: approve`). GitHub disallowing self-approval is not a halt. If CI is still red after review-tdd, merge runs and the host may try `/babysit` once before blocking for a human.

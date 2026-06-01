# SandcastleRalphAuto

A local control plane that runs a fixed, linear vertical-slice pipeline (`/tdd` → `/create-pr` → `/review-pr` → `/review-tdd` → `/merge`, then `/next`) AFK across registered repos, using Cursor's Auto model via Sandcastle, with an operator dashboard for oversight.

## Language

**Slice**:
One unit of work: a single GitHub issue taken from `ready-for-agent` through to a merged PR. The atomic thing the loop processes.
_Avoid_: task, ticket, story

**Phase**:
One step of the canonical pipeline — `tdd`, `create-pr`, `review-pr`, `review-tdd`, `merge` — run linearly, every phase every slice. Each phase is one cold agent invocation; no transcript carries between phases. `next` is host orchestration (no agent), not a skill phase.
_Avoid_: step, stage

**Skill**:
The Cursor skill definition (`~/.cursor/skills/<name>/SKILL.md`) that specifies a phase's behavior. Skills are the **specification**; Sandcastle prompt files are the **runtime** that mirror them.
_Avoid_: prompt (a prompt is the runtime artifact, not the spec)

**Handoff**:
The on-disk record written at the end of every phase and read by the next phase. The **only** carry-over between phases besides GitHub state — never prior agent stdout.

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

## Example dialogue

> **Dev:** When a worker finishes a slice, does it reuse the same agent for `/next`?
> **Expert:** No. Every phase is a fresh agent invocation. The worker advances the slice by starting a new cold run; the new run reads the handoff and GitHub, nothing else. The worker persists across phases; the agent does not.
> **Dev:** And if review finds a blocker?
> **Expert:** The slice stops — it doesn't reach `merge`, and `/next` never fires. The worker marks the slice blocked and the dashboard shows it red. The mutex is still held by that project until an operator clears or skips it.

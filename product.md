# SandcastleRalphAuto — Product (WIP)

> **Status:** Work in progress. Intended for a human-led `/grill-with-docs` session before implementation.  
> **Working name:** SandcastleRalphAuto — orchestrated AFK slice pipeline across multiple repos, with a small operator dashboard.

---

## Problem

We run vertical slice work through a fixed skill pipeline (`/tdd` → `/create-pr` → `/review-pr` → `/review-tdd` → `/merge`) in Cursor, mostly on **AUTO (efficiency)** with **no subagents**. That implies:

- **One heavy cognitive role per agent session** (implement vs review vs merge must not share one bloated transcript).
- **Manual chat boundaries** today: new Composer thread + handoff file between phases.
- **No automatic “what’s next?”** after merge — a human picks the next `ready-for-agent` issue.

We want **minimal HITL**: select project(s), watch progress, intervene only on blockers — while guaranteeing **at most one conflicting AFK worker per repo** (or explicit isolated parallelism).

---

## Vision

A **local control plane** (dashboard + orchestrator) that:

1. Discovers **AFK-ready issues** per registered project (`ready-for-agent`, not blocked).
2. Runs the **skill-equivalent pipeline** automatically via **[Sandcastle](https://github.com/mattpocock/sandcastle)** (`@ai-hero/sandcastle`) — fresh agent run per phase, handoff on disk, not one mega-prompt.
3. Exposes **`/next`** semantics: after a successful merge, pick the next eligible issue and start `/tdd` again.
4. Shows **live streamed output** per active worker (what AUTO / the sandbox agent is doing).
5. Enforces **concurrency rules** per project (default: one AFK worker; optional parallel only with isolated worktrees/branches).

Cursor skills remain the **specification** for behavior; Sandcastle + Ralph loop are the **runtime**.

---

## Non-goals (for v0)

- Replacing GitHub as issue/PR source of truth.
- Running the full pipeline inside a single Cursor Composer chat.
- Unbounded parallel workers on the same branch without isolation.
- Product/design re-litigation (`/grill-with-docs` stays human-triggered).

---

## Skill pipeline (canonical)

Each **slice** (one issue → one PR → merge) follows:

| Step | Skill | Role | Stops when |
|------|--------|------|------------|
| 1 | `/tdd` + issue link | Implement + test (vertical TDD) | Tests green, slice done, handoff written |
| 2 | `/create-pr` | Branch, commit, push, open PR | PR URL exists |
| 3 | `/review-pr` | Adversarial review (posted to GitHub) | Verdict + blockers on PR |
| 4a | — | If **Approve** → skip to 6 | — |
| 4b | `/review-tdd` | Fix blockers (in-scope) with TDD | `merge-ready: yes` in summary |
| 5 | `/babysit` | CI / conflicts (only if needed) | Required checks pass |
| 6 | `/merge` | Gate: CI, blockers, Path A/B evidence | PR merged, branch deleted |
| 7 | **`/next`** | Post-merge housekeeping + queue | Next issue started or queue empty |

**Handoff contract** (every phase end): `.sandcastle-ralph/handoff/current.json` (or `.local/handoff/current.md`) — PR #, branch, issue #, acceptance state, verdict, blockers, `merge-ready`, **`nextSkill`**, timestamps. Next run reads **only** this + GitHub, not prior agent stdout.

**Context budget:** target **≤100k tokens per agent invocation** — one phase per Sandcastle `run()`, no transcript carry-over.

---

## `/next` skill (new)

**Trigger:** Automatically after successful `/merge`, or manually from dashboard / CLI.

**Behavior:**

1. **Verify merge** — `gh pr view` → `MERGED`; linked issues closed or updated; required checks were green at merge time.
2. **Archive handoff** — move `current` → `handoff/history/<pr>-<iso>.json`.
3. **Select next issue** (per project), in order:
   - `ready-for-agent` label (see each repo’s `docs/agents/triage-labels.md`).
   - Not blocked: no open dependency issues, no `needs-info`, not assigned to human-only (`ready-for-human`, `HITL`).
   - Optional: sort by milestone, priority label, or issue #.
4. **Enqueue or start** `/tdd` for `https://github.com/<owner>/<repo>/issues/<n>` (or equivalent issue URL).
5. If no eligible issue → emit `QUEUE_EMPTY` completion signal; dashboard shows idle.

**On merge failure or blocked gate:** do **not** advance queue; surface `next: /review-tdd` or `next: /babysit` from handoff.

Sandcastle prompt files should embed the same rules as the Cursor skills (or `include` paths to `~/.cursor/skills/...`).

---

## Runtime architecture

```text
┌─────────────────────────────────────────────────────────┐
│  Dashboard (web UI, local)                               │
│  - Select 1..N projects                                  │
│  - Start / pause AFK loop per project                    │
│  - Live log stream per worker                            │
│  - Issue queue + active slice state                      │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│  Orchestrator (Node/TS, uses @ai-hero/sandcastle)          │
│  - Project registry (path, remote, labels, base branch)    │
│  - Per-project mutex OR worktree pool                      │
│  - State machine: phase × issue × PR                       │
│  - Emits structured events → dashboard SSE/WebSocket       │
└──────────────────────────┬──────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
   sandcastle.run()   gh / git          handoff files
   (docker/podman)    (issues, PR, CI)  on disk
```

### Sandcastle mapping

| Skill phase | Sandcastle mechanism |
|-------------|---------------------|
| `/tdd` | `sandbox.run({ promptFile: "phases/tdd.md", maxIterations: N, branchStrategy: { type: "branch", branch: "feat/<slug>-<issue>" } })` |
| `/create-pr` | `run({ promptFile: "phases/create-pr.md", maxIterations: 1 })` |
| `/review-pr` | `run({ agent: cheaper model?, promptFile: "phases/review-pr.md" })` — separate run, adversarial prompt |
| `/review-tdd` | `run({ promptFile: "phases/review-tdd.md" })` |
| `/merge` | `run({ promptFile: "phases/merge.md" })` or host-only `gh pr merge` after scripted pre-flight |
| `/next` | Host TypeScript (no agent) + optional tiny `run()` for “start tdd” |

Use `createSandbox()` + sequential `sandbox.run()` on **one branch per slice**, or `createWorktree()` per parallel task.

**Completion signals:** `<promise>PHASE_COMPLETE</promise>` per phase; orchestrator advances only on signal + structured `Output.object()` handoff validation.

**Templates:** Start from Sandcastle `sequential-reviewer` / `simple-loop`; customize for our skill semantics.

### Cursor vs Sandcastle

| Concern | Cursor (AUTO) | SandcastleRalphAuto |
|---------|---------------|---------------------|
| Interactive steering | Yes | No (unless `interactive()` escape hatch) |
| Skill invocation | User types `/tdd` | Prompt files mirror skills |
| Fresh context per phase | User opens new chat | Each `run()` = new agent process |
| Stream to UI | Composer UI | Orchestrator tails `onAgentStreamEvent` / log files |

Hybrid acceptable: dashboard triggers Sandcastle for AFK; user can open Cursor on same branch for HITL rescue.

---

## Concurrency model

**Default (safe):** **one AFK worker per project (git remote)** at a time.

- Mutex keyed by `projectId` (canonical: `owner/repo` or local registry id).
- While worker holds mutex: phase state machine runs for at most one issue.

**Optional parallelism** (explicit opt-in per project):

| Mode | When | Isolation |
|------|------|-----------|
| **Single worker** | Default | One branch, sequential slices |
| **Multi worktree** | Issues touch disjoint paths / labeled `parallel-ok` | Sandcastle `createWorktree()` per issue, distinct `agent/feat-<issue>` branches |
| **Multi project** | User selects Portfolio + OtherRepo | Independent mutex per project |

**Never:** two workers on the same branch without coordination.

**Conflict detection (heuristic v0):** overlap in `git diff --stat` prediction from issue labels/files-mentioned; grill later for graph-based deps.

---

## Dashboard (operator UI)

**Local-first** web app (e.g. Vite + minimal backend, or Sandcastle logging + small Express).

### Must have (v0)

- **Project picker** — checkboxes for registered repos under `Freelance/2026/` (and configurable paths).
- **Queue view** — eligible AFK issues per project; blocked reason if skipped.
- **Active work** — per project: issue #, phase (`tdd` | `create-pr` | …), branch, PR link, started at.
- **Live stream** — tail agent output per worker (Sandcastle `logging.onAgentStreamEvent` forwarded via SSE).
- **Controls** — Start / Pause loop per project; **Kill** current run (`AbortSignal`); **Skip** issue (label `blocked-by-operator`?).
- **History** — last N merged PRs + duration per phase.

### Should have (v1)

- Diff stat / CI badge on active PR.
- Link to GitHub review thread.
- Token / cost estimate per phase (from Sandcastle `IterationUsage`).

### Nice (later)

- Slack/desktop notify on blocker.
- Compare stream side-by-side for two projects.

---

## Project registry

Config file `projects.json` (location TBD — repo root of SandcastleRalphAuto):

```json
{
  "projects": [
    {
      "id": "portfolio",
      "path": "/Users/hiono/Freelance/2026/Portfolio",
      "remote": "HaDuve/Portfolio",
      "defaultBase": "main",
      "afkLabel": "ready-for-agent",
      "blockedLabels": ["needs-info", "ready-for-human", "HITL"],
      "concurrency": "single"
    }
  ]
}
```

Orchestrator validates path exists, `gh` auth works, and optional `.sandcastle/` init per project.

---

## State machine (per slice)

```text
idle → tdd → create-pr → review-pr → [review-tdd | babysit]* → merge → next
                  ↑___________________________|
                  (request changes loop)
```

**Persist:** `state/<projectId>/active.json` — survives orchestrator restart.

**Failure:** transition to `blocked` with `reason` + `resumeSkill`; dashboard shows red; no `/next` until cleared or skipped.

---

## Security & safety

- Sandboxed agents (Docker/Podman default); secrets via `.sandcastle/.env`, never committed.
- `merge` phase: never `--admin` bypass; honor branch protection.
- No force-push `main`/`master`.
- Operator kill switch aborts in-flight `run()`; worktree preserved dirty for inspection (Sandcastle default).

---

## Success metrics

- **Slices merged per week** with &lt;1 human intervention per slice (happy path).
- **Zero** merge conflicts from two workers on same project (mutex enforced).
- **Mean time** from `ready-for-agent` → merged PR.
- **Phase failure rate** (review blockers vs CI vs merge gate).

---

## Implementation phases (draft)

| Phase | Deliverable |
|-------|-------------|
| **P0** | `projects.json` + CLI: list queue, run one phase manually |
| **P1** | Sandcastle `main.ts` — full slice for one project, handoff files |
| **P2** | `/next` host logic + loop |
| **P3** | Dashboard v0 (stream + active state) |
| **P4** | Multi-project + mutex |
| **P5** | Optional parallel worktrees |

---

## Open questions (for `/grill-with-docs`)

1. **Agent provider in Sandcastle:** Claude Code only, or `cursor("composer-2")` to mirror AUTO? Cost vs fidelity?
2. **Review author:** Same model as implement (bad) vs mandatory cheaper/different model for `review-pr`?
3. **Approve without human:** Auto-merge on `Approve` + green CI, or always pause before `/merge`?
4. **Issue selection:** Strict FIFO by # vs priority labels vs dependency graph?
5. **Blocked definition:** GitHub `blocked:` keyword, label, or custom field?
6. **Handoff format:** JSON schema vs markdown for human readability?
7. **Dashboard hosting:** localhost only vs tailnet?
8. **Portfolio-specific:** Copy `CONTEXT.md` / ADR paths into prompts automatically per touched paths?
9. **When slice spans packages:** monorepo test command matrix in registry?
10. **Ralph branding:** Is this literally a Ralph Wiggum loop (`COMPLETION` → next issue) or just sequential Sandcastle runs?

---

## References

- Skill pipeline: `~/.cursor/skills/{tdd,create-pr,review-pr,review-tdd,merge}/SKILL.md`
- Sandcastle: https://github.com/mattpocock/sandcastle — `createSandbox()`, `sequential-reviewer`, structured `Output.object()`, `completionSignal`
- Triage: `ready-for-agent` (Portfolio: `docs/agents/triage-labels.md`)
- Prior design discussion: separate phase skills + disk handoff; no mega-skill; no orchestrator skill in Cursor; ≤100k per invocation

---

## Document history

| Date | Note |
|------|------|
| 2026-05-31 | Initial WIP product sketch for grill session |

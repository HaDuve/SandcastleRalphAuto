# SandcastleRalphAuto — PRD

> Consolidated from the `/grill-with-docs` session on `product.md` (2026-06-01).
> Glossary: [`CONTEXT.md`](../CONTEXT.md). Decisions: [`docs/adr/`](./adr/).

## 1. Problem & goal

Clear a project's **easy, AFK-ready issues** end-to-end with minimal human involvement, at **no marginal model cost**, while guaranteeing at most one conflicting worker per repo. A human selects projects, watches progress, and intervenes only on blockers.

## 2. What we're building

A **local control plane** = a long-lived Node/TS orchestrator process + a local web dashboard. It runs the fixed slice pipeline AFK via **Sandcastle**, using Cursor's **Auto** model, and exposes oversight + controls.

## 3. Locked decisions

| # | Decision | Why | ADR |
|---|----------|-----|-----|
| D1 | Agent = `cursor("auto")` for **every** phase | Auto is unlimited/free on paid plans; `composer-2` spends credits | [0001](./adr/0001-auto-only-no-model-diversity.md) |
| D2 | No enforced reviewer model-diversity; independence via fresh context + adversarial prompt | Auto gives no model control | [0001](./adr/0001-auto-only-no-model-diversity.md) |
| D3 | **Auto-merge** on clean `Approve` + green required checks; `autoMerge` per-project (default on) | Makes the loop genuinely AFK | [0002](./adr/0002-unattended-auto-merge.md) |
| D4 | Merge via `gh pr merge --squash --auto`, never `--admin`; honor branch protection; kill switch wins | Safety | [0002](./adr/0002-unattended-auto-merge.md) |
| D5 | Handoff = single **JSON** file per phase, written by the agent, validated host-side with Zod | Programmatic consumption; `Output.object` needs `maxIterations===1` which `tdd` can't use | — |
| D6 | Eligibility = `ready-for-agent` minus blocked labels (`needs-info`, `ready-for-human`, `HITL`, `wontfix`, `needs-triage`) | Reuses existing triage convention | — |
| D7 | Selection order = **lowest open issue number first** | Deterministic, no config | — |
| D8 | No dependency-graph / epic auto-detection in v0 | Keep `/next` to one `gh issue list` + sort | — |
| D9 | Operator **skip** marks issues from the dashboard; stored in **local state** per project, never on GitHub | Instant toggle, keeps repo clean | — |
| D10 | Sandbox = **`noSandbox()`** for v0 (configurable); per-slice git-worktree/branch isolation only | Fastest path; avoids `cursor-agent`-in-container setup | [0003](./adr/0003-nosandbox-for-v0.md) |
| D11 | Phase prompts = **pinned snapshot** of skill + minimal headless harness; `sync-skills` to refresh | Reproducible AFK runs | [0004](./adr/0004-snapshot-skills-into-prompts.md) |
| D12 | Dashboard = **localhost** only, **Node + SSE** API, **Vite + React** frontend | Single-operator local tool; SSE is one-way server→client | — |
| D13 | Concurrency = one mutex per project (`owner/repo`), independent across projects; worktree-parallelism deferred | Stated safety guarantee | — |
| D14 | CI = GH Actions workflow (`.github/workflows/ci.yml`, job **`ci`**) running `typecheck` + `test` on every PR; `ci` is the required status check | The merge gate is meaningless without a real green check to gate on | — |
| D15 | `main` is protected: require the `ci` check, **enforce for admins** (no bypass); all changes land via PR (incl. human + AFK) | Makes auto-merge safe and uniform; nothing merges un-checked | — |

## 4. Pipeline (canonical)

`/tdd #<issue>` → `/create-pr` → `/review-pr` → `/review-tdd` → `/merge`, then `/next`

This is the exact, **linear** skill-flow proven in practice — every phase runs every slice, in order. No conditional branches, no request-changes loop, no `/babysit`.

- Each phase = one **cold** `cursor("auto")` run. Inputs = the JSON handoff + GitHub only; no transcript carry-over. Target ≤100k tokens/invocation.
- Completion signal: `<promise>PHASE_COMPLETE</promise>`.
- `tdd` uses `maxIterations: N`; the rest are single-shot. Phases emit/validate the handoff host-side.
- `/next` is **host orchestration, not a skill phase** (no agent): verify merge → archive handoff → select next eligible issue (lowest #, minus skips/blocked) → start `/tdd`, or emit `QUEUE_EMPTY`.
- If `/merge` can't proceed (red required checks / open blockers) the slice is marked `blocked` for the operator — there is no automated CI-repair phase in v0.
- Required check is **`ci`** (D14). `gh pr merge --squash --auto` queues the PR and GitHub merges it once `ci` is green; with branch protection (D15) nothing merges un-checked, including direct human pushes.

## 5. Handoff schema (v0 draft)

```ts
const Handoff = z.object({
  project: z.string(),        // owner/repo
  issue: z.number(),
  branch: z.string(),
  pr: z.number().optional(),
  phase: z.enum(["tdd","create-pr","review-pr","review-tdd","merge"]),
  acceptanceState: z.enum(["in-progress","done","blocked"]),
  verdict: z.enum(["approve","request-changes","n/a"]).optional(),
  blockers: z.array(z.string()),
  mergeReady: z.boolean(),
  nextSkill: z.string(),      // next phase in the fixed order, e.g. "/review-tdd"
  startedAt: z.string(),
  endedAt: z.string(),
});
```

Path: `.sandcastle-ralph/handoff/current.json`; archived to `handoff/history/<pr>-<iso>.json`.

## 6. State

`state/<projectId>/active.json` (survives restart): current slice + phase. `state/<projectId>/skips.json`: operator-skipped issue numbers. On failure → `blocked` with `reason` + `resumeSkill`; no `/next` until cleared/skipped.

## 7. Milestones

- **M1 — Engine (CLI, riskiest first):** full pipeline for one issue on Portfolio, end-to-end, `noSandbox`, Auto, JSON handoff, auto-merge, `/next` picking the next issue. No UI.
- **M2 — Dashboard:** Node/SSE + Vite/React wrapping the engine — project picker, queue, active slice, live stream, controls (start/pause/kill/skip).
- **Later:** multi-project mutex; optional worktree parallelism; paid-model override; Docker provider; epic/dependency handling; CI/cost badges.

## 8. Out of scope (v0)

GitHub replacement; full pipeline in one Cursor chat; unbounded same-branch parallelism; product re-litigation; dependency graphs; epic detection; tailnet hosting; Docker sandbox.

## 9. Success metrics

Slices merged/week with <1 human touch (happy path); zero same-project merge conflicts; mean time `ready-for-agent` → merged; phase failure rate (review vs CI vs merge gate).

## 10. Open questions (deferred, not blocking)

- Per-touched-path injection of a repo's `CONTEXT.md`/ADRs into prompts (Portfolio uses them; `/tdd` may already read them).
- Monorepo test-command matrix in the registry.
- Whether to ever pin a paid reviewer model for high-stakes repos.

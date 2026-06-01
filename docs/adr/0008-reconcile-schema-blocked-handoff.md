# Resume slices blocked on invalid handoff schema

Observed on FantasyEconomySim issue #29: the agent wrote `acceptanceState: "complete"` in the worktree handoff. Before host normalization (#71), that failed Zod validation (`Invalid handoff schema`), the slice was marked `blocked`, and every subsequent **Start** exited immediately because `resolveLoopStart` / `runLinearSlice` short-circuited on `active.status === "blocked"` without re-reading the handoff.

## Decision

1. **Normalize on read (existing).** `HandoffSchema` maps agent synonyms (e.g. `complete` → `done`) via `preprocessHandoffInput` (#71).
2. **Reconcile on resume.** When `active` is `blocked` and `reason` contains `Invalid handoff schema`, the host re-reads `.sandcastle/worktrees/<branch>/.sandcastle-ralph/handoff/current.json`, applies schema normalization, persists host + worktree copies, and sets `active` to **active** at the phase implied by `nextSkill` when `acceptanceState` is `done` (otherwise resumes at `handoff.phase` when `in-progress`).
3. **Entry points.** `tryReconcileSchemaBlockedHandoff` runs in `resolveLoopStart` (dashboard Start) and at the top of `runLinearSlice`.

## Consequences

- Operator does not need to hand-edit `state/.../active.json` after an agent synonym slip once normalization exists.
- Reconcile only runs for schema-block reasons; other `blocked` slices are unchanged.
- Stale `lastRunOutcome` may still show a prior error until the current worker stops (#69).

## Alternatives considered

- **Manual clear only** — fragile; blocked reason looked like a permanent pipeline failure.
- **Always retry blocked slices** — unsafe for real blockers (review findings, merge gate).

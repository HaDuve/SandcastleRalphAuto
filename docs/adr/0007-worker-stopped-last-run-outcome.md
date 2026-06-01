# Push full lastRunOutcome on worker-stopped SSE

Parent HITL: issue #61. Reload already exposes rich Run outcome via enriched
`GET /api/projects` (`lastRunOutcome` from `run.json`). Live stop previously emitted
only `reason: string` on `worker-stopped`, so the dashboard synthesized a thin
`RunOutcome` and dropped `phase`, human-readable `reason`, and `logRef`.

## Decision

1. **Push, do not refetch.** After `persistRunOutcomeFromLoopResult` /
   `persistRunOutcomeFromWorkerError`, emit `worker-stopped` with **`lastRunOutcome`**
   — the same object written to `run.json`. Persist functions **return** that outcome;
   the worker does not re-read disk for the event.
2. **Breaking SSE shape.** `worker-stopped` is
   `{ type, projectId, lastRunOutcome }`. The `reason` field is **removed** (it
   overloaded terminal status tokens and error messages). Consumers are this repo’s
   server tests and operator dashboard only.
3. **Dashboard.** Apply `lastRunOutcome` in the worker reducer; patch `projects[]` on
   stop so re-selecting a project is not stale; defer SSE subscription until initial
   `fetchProjects` completes; if `lastRunOutcome` is absent on a malformed event, set
   `idle` but **keep** the prior `lastOutcome`.

## Consequences

- Live stop matches reload for Run outcome detail (#43 “same Run data”).
- One compute/write/emit path; `stoppedAt` always comes from the server clock at stop.
- External SSE clients (none today) would need to adopt `lastRunOutcome`.

## Alternatives considered

- **Refetch on stop** — extra latency; outcome already computed at persist.
- **Hybrid push + refetch** — redundant given persist-before-emit ordering.

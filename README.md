# SandcastleRalphAuto

Local control plane that clears a repo's AFK-ready issues end-to-end, unattended, using Cursor's **Auto** model via [Sandcastle](https://github.com/mattpocock/sandcastle).

Pick `ready-for-agent` issue → `/tdd` → `/create-pr` → `/review-pr` → (`/review-tdd` | `/babysit`)* → `/merge` → `/next`. Each phase is a cold agent run; the only carry-over is a JSON handoff on disk.

- **Free:** Auto is unlimited on paid Cursor plans (no credit drain).
- **Safe:** auto-merge only on clean Approve + green checks, through branch protection; one worker per repo.
- **Watchable:** local dashboard streams live output and exposes start/pause/kill/skip.

## Docs

- [`CONTEXT.md`](./CONTEXT.md) — glossary
- [`docs/PRD.md`](./docs/PRD.md) — decisions, pipeline, milestones
- [`docs/adr/`](./docs/adr/) — key decision records

## Status

Pre-implementation. Work tracked in [issues](https://github.com/HaDuve/SandcastleRalphAuto/issues): **M1** = CLI engine, **M2** = dashboard.

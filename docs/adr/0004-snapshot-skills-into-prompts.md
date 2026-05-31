# Snapshot skill content into phase prompt files

Phase prompt files contain a **pinned copy** of the canonical Cursor skill (`~/.cursor/skills/<phase>/SKILL.md`) plus a thin headless harness, rather than live-inlining the skill at runtime via `` !`cat ...` ``. A `sync-skills` step refreshes the snapshots when a skill changes.

We chose pinned copies over live-inlining for **reproducibility**: an AFK run's behavior is fixed by what's committed, not by whatever the host's skill files happen to say at run time. Observed behavior is stable — the last ~30 interactive runs asked zero questions — so the headless harness can stay minimal (read handoff + issue, write JSON handoff, emit completion signal).

## Consequences

- Skills are no longer a live single source of truth; snapshots can drift until `sync-skills` is run. Accepted as the cost of reproducible, version-pinned runs.

# noSandbox for v0

v0 runs agents with Sandcastle's `noSandbox()` provider — directly on the host worktree — instead of the Docker/Podman isolation the product sketch defaults to. The repos are already local, and the `cursor()` provider would otherwise require building and maintaining a custom image with `cursor-agent` installed and authenticated inside the container. noSandbox removes that friction to get a working loop fastest.

## Consequences

- We keep per-slice **git worktree / branch** isolation (via branch strategy), but **not** process/filesystem isolation. With `--force`/`--yolo`, an agent phase can run arbitrary commands on the host. Accepted for solo local use.
- The sandbox provider is a config value, so moving to Docker later is a config change plus an image, not a rewrite.
- This deliberately deviates from the product doc's security section; that section describes the eventual target, not v0.

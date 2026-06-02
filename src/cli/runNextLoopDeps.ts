import type { GhRunner } from "../merge/index.js";
import type { RunNextDeps } from "../next/index.js";
import type { Project } from "../registry/index.js";
import { writeActive } from "../state/index.js";

export function buildRunNextLoopDeps(input: {
  project: Project;
  stateRoot: string;
  gh: GhRunner;
  readSkips?: RunNextDeps["readSkips"];
  writeSkips?: RunNextDeps["writeSkips"];
  archiveHandoff?: RunNextDeps["archiveHandoff"];
}): RunNextDeps {
  return {
    gh: input.gh,
    readSkips:
      input.readSkips ??
      (async (projectId, skipsRoot) => {
        const { readSkips } = await import("../state/index.js");
        return readSkips(projectId, skipsRoot);
      }),
    writeSkips:
      input.writeSkips ??
      (async (projectId, skips, skipsRoot) => {
        const { writeSkips } = await import("../state/index.js");
        return writeSkips(projectId, skips, skipsRoot);
      }),
    archiveHandoff:
      input.archiveHandoff ??
      (async (projectId) => {
        const { archiveHostHandoff } = await import("../handoff/index.js");
        return archiveHostHandoff({
          stateRoot: input.stateRoot,
          projectId,
        });
      }),
    writeActive,
    startTdd: async (startInput) => {
      const { startTddViaRunPhase } = await import("../next/index.js");
      await startTddViaRunPhase(startInput);
    },
  };
}

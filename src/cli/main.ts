import { stdout } from "node:process";
import { parseCliArgs } from "./parseArgs.js";
import { loopProject, runProjectSlice } from "./runProject.js";

async function main(): Promise<void> {
  const command = parseCliArgs(process.argv.slice(2));

  const onPhaseLog = (chunk: string): void => {
    stdout.write(chunk);
  };

  if (command.command === "run") {
    const result = await runProjectSlice(
      {
        projectId: command.projectId,
        issue: command.issue,
      },
      { onPhaseLog },
    );
    stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status !== "completed") {
      process.exitCode = 1;
    }
    return;
  }

  const result = await loopProject(
    {
      projectId: command.projectId,
      issue: command.issue,
    },
    { onPhaseLog },
  );
  stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "queue-empty") {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  stdout.write(`Error: ${message}\n`);
  process.exitCode = 1;
});

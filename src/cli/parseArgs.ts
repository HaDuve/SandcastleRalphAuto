import { CliError } from "./errors.js";

export type RunCommand = {
  command: "run";
  projectId: string;
  issue: number;
};

export type LoopCommand = {
  command: "loop";
  projectId: string;
  issue: number;
};

export type CliCommand = RunCommand | LoopCommand;

function readFlagValue(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) {
    throw new CliError(`Missing value for ${flag}`);
  }
  return args[index + 1]!;
}

export function parseCliArgs(argv: string[]): CliCommand {
  const [command, ...rest] = argv;

  if (command !== "run" && command !== "loop") {
    throw new CliError("Usage: run --project <id> --issue <n> | loop --project <id> --issue <n>");
  }

  const projectId = readFlagValue(rest, "--project");
  const issueRaw = readFlagValue(rest, "--issue");
  const issue = Number(issueRaw);
  if (!Number.isInteger(issue) || issue <= 0) {
    throw new CliError(`Invalid issue number: ${issueRaw}`);
  }

  return { command, projectId, issue };
}

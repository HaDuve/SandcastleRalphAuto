import { CliError } from "./errors.js";

export type RunCommand = {
  command: "run";
  projectId: string;
  issue: number;
};

export type LoopCommand = {
  command: "loop";
  projectId: string;
  issue?: number;
};

export type CliCommand = RunCommand | LoopCommand;

function readFlagValue(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) {
    throw new CliError(`Missing value for ${flag}`);
  }
  return args[index + 1]!;
}

function readOptionalIssue(args: string[]): number | undefined {
  const index = args.indexOf("--issue");
  if (index === -1) {
    return undefined;
  }
  if (index + 1 >= args.length) {
    throw new CliError("Missing value for --issue");
  }
  const issueRaw = args[index + 1]!;
  const issue = Number(issueRaw);
  if (!Number.isInteger(issue) || issue <= 0) {
    throw new CliError(`Invalid issue number: ${issueRaw}`);
  }
  return issue;
}

function parseIssueFlag(args: string[]): number {
  const issueRaw = readFlagValue(args, "--issue");
  const issue = Number(issueRaw);
  if (!Number.isInteger(issue) || issue <= 0) {
    throw new CliError(`Invalid issue number: ${issueRaw}`);
  }
  return issue;
}

export function parseCliArgs(argv: string[]): CliCommand {
  const [command, ...rest] = argv;

  if (command !== "run" && command !== "loop") {
    throw new CliError(
      "Usage: run --project <id> --issue <n> | loop --project <id> [--issue <n>]",
    );
  }

  const projectId = readFlagValue(rest, "--project");

  if (command === "run") {
    return { command, projectId, issue: parseIssueFlag(rest) };
  }

  return { command, projectId, issue: readOptionalIssue(rest) };
}

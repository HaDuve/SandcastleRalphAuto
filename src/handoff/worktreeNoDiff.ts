import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitRunner = (
  args: string[],
  cwd: string,
) => Promise<{ stdout: string; exitCode: number }>;

export async function defaultGitRunner(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; exitCode: number }> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd });
    return { stdout: stdout.toString(), exitCode: 0 };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "number"
    ) {
      return {
        stdout:
          "stdout" in error && typeof error.stdout === "string"
            ? error.stdout
            : "",
        exitCode: error.code,
      };
    }
    throw error;
  }
}

/** True when `origin/main..HEAD` is empty and tree matches `origin/main...HEAD`. */
export async function worktreeHasNoDiffVsOriginMain(
  worktreePath: string,
  git: GitRunner = defaultGitRunner,
): Promise<boolean> {
  try {
    const rev = await git(
      ["rev-list", "origin/main..HEAD", "--count"],
      worktreePath,
    );
    if (rev.exitCode !== 0) {
      return false;
    }
    const commitCount = Number.parseInt(rev.stdout.trim(), 10);
    if (Number.isNaN(commitCount) || commitCount !== 0) {
      return false;
    }
    const diff = await git(["diff", "--quiet", "origin/main...HEAD"], worktreePath);
    return diff.exitCode === 0;
  } catch {
    return false;
  }
}

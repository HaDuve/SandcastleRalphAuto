export function githubRepoUrl(remote: string): string {
  return `https://github.com/${remote}`;
}

export function githubIssueUrl(remote: string, issueNumber: number): string {
  return `${githubRepoUrl(remote)}/issues/${issueNumber}`;
}

export function githubPrUrl(remote: string, prNumber: number): string {
  return `${githubRepoUrl(remote)}/pull/${prNumber}`;
}

export function truncateRemote(remote: string, max = 10): string {
  if (remote.length <= max) {
    return remote;
  }
  return `${remote.slice(0, max)}...`;
}

export function cursorWorkspaceLink(path: string): string {
  return `cursor://file/${path}`;
}

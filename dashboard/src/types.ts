export type Project = {
  id: string;
  path: string;
  remote: string;
  defaultBase: string;
  afkLabel: string;
  blockedLabels: string[];
  autoMerge: boolean;
  concurrency: "single";
  sandbox: "none";
};

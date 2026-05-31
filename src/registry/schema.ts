import { z } from "zod";

const remotePattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export const ProjectSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  remote: z.string().regex(remotePattern, "remote must be owner/repo"),
  defaultBase: z.string().min(1),
  afkLabel: z.string().min(1),
  blockedLabels: z.array(z.string()),
  autoMerge: z.boolean().default(true),
  concurrency: z.literal("single").default("single"),
  sandbox: z.literal("none").default("none"),
});

export const ProjectsConfigSchema = z.object({
  projects: z.array(ProjectSchema).min(1),
});

export type Project = z.infer<typeof ProjectSchema>;
export type ProjectsConfig = z.infer<typeof ProjectsConfigSchema>;

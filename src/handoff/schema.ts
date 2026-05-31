import { z } from "zod";

export const HandoffSchema = z.object({
  project: z.string(),
  issue: z.number(),
  branch: z.string(),
  pr: z.number().optional(),
  phase: z.enum([
    "tdd",
    "create-pr",
    "review-pr",
    "review-tdd",
    "babysit",
    "merge",
    "next",
  ]),
  acceptanceState: z.enum(["in-progress", "done", "blocked"]),
  verdict: z.enum(["approve", "request-changes", "n/a"]).optional(),
  blockers: z.array(z.string()),
  mergeReady: z.boolean(),
  nextSkill: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
});

export type Handoff = z.infer<typeof HandoffSchema>;

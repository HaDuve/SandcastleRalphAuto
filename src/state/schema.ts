import { z } from "zod";

export const PhaseSchema = z.enum([
  "tdd",
  "create-pr",
  "review-pr",
  "review-tdd",
  "babysit",
  "merge",
]);

export const ActiveStatusSchema = z.enum(["active", "blocked"]);

export const ActiveStateSchema = z
  .object({
    issue: z.number().int().positive(),
    phase: PhaseSchema,
    branch: z.string().min(1),
    pr: z.number().int().positive().optional(),
    status: ActiveStatusSchema,
    reason: z.string().min(1).optional(),
    resumeSkill: z.string().min(1).optional(),
  })
  .refine(
    (data) =>
      data.status !== "blocked" ||
      (data.reason !== undefined && data.resumeSkill !== undefined),
    {
      message: "blocked status requires reason and resumeSkill",
    },
  );

export const SkipsSchema = z.array(z.number().int().positive());

export type ActiveState = z.infer<typeof ActiveStateSchema>;
export type Skips = z.infer<typeof SkipsSchema>;

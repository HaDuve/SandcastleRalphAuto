import { z } from "zod";

export const PhaseSchema = z.enum([
  "tdd",
  "create-pr",
  "review-pr",
  "review-tdd",
  "babysit",
  "merge",
]);

export const ActiveStatusSchema = z.enum(["active", "blocked", "awaiting-human"]);

export const ActiveStateSchema = z
  .object({
    issue: z.number().int().positive(),
    phase: PhaseSchema,
    branch: z.string().min(1),
    pr: z.number().int().positive().optional(),
    status: ActiveStatusSchema,
    reason: z.string().min(1).optional(),
    resumeSkill: z.string().min(1).optional(),
    startedAt: z.string().optional(),
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

export const RunOutcomeTypeSchema = z.enum([
  "queue-empty",
  "blocked",
  "awaiting-human",
  "killed",
  "error",
]);

export const RunOutcomeSchema = z
  .object({
    outcome: RunOutcomeTypeSchema,
    reason: z.string().min(1).optional(),
    phase: PhaseSchema.optional(),
    stoppedAt: z.string(),
    logRef: z.string().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (
      (data.outcome === "blocked" ||
        data.outcome === "awaiting-human" ||
        data.outcome === "error") &&
      data.reason === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message: `${data.outcome} outcome requires reason`,
        path: ["reason"],
      });
    }
  });

export type ActiveState = z.infer<typeof ActiveStateSchema>;
export type Skips = z.infer<typeof SkipsSchema>;
export type RunOutcome = z.infer<typeof RunOutcomeSchema>;

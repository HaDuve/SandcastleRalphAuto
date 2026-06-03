import { z } from "zod";

export const HANDOFF_PHASE_VALUES = [
  "tdd",
  "create-pr",
  "review-pr",
  "review-tdd",
  "babysit",
  "merge",
  "next",
] as const;

export const HANDOFF_ACCEPTANCE_STATE_VALUES = [
  "in-progress",
  "done",
  "blocked",
] as const;

/** Agent-facing synonyms normalized before Zod validation (defense in depth). */
export const HANDOFF_ACCEPTANCE_STATE_SYNONYMS: Readonly<
  Record<string, (typeof HANDOFF_ACCEPTANCE_STATE_VALUES)[number]>
> = {
  complete: "done",
};

export function preprocessHandoffInput(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return input;
  }
  const record = input as Record<string, unknown>;
  const raw = record.acceptanceState;
  if (typeof raw !== "string") {
    return input;
  }
  const normalized = HANDOFF_ACCEPTANCE_STATE_SYNONYMS[raw];
  if (normalized === undefined) {
    return input;
  }
  return { ...record, acceptanceState: normalized };
}

export const HandoffSchema = z.preprocess(
  preprocessHandoffInput,
  z.object({
    project: z.string(),
    issue: z.number(),
    branch: z.string(),
    pr: z.number().optional(),
    phase: z.enum(HANDOFF_PHASE_VALUES),
    acceptanceState: z.enum(HANDOFF_ACCEPTANCE_STATE_VALUES),
    verdict: z.enum(["approve", "request-changes", "n/a"]).optional(),
    blockers: z.array(z.string()),
    mergeReady: z.boolean(),
    nextSkill: z.string(),
    startedAt: z.string(),
    endedAt: z.string(),
    /** Set when merged-tail recovery is skipped after exhaustion (ADR 0011). */
    recoveryWarning: z.string().min(1).optional(),
    /** Host/agent merged-tail recovery attempt counter (ADR 0011). */
    mergedTailAttempts: z.number().int().nonnegative().optional(),
  }),
);

export type Handoff = z.infer<typeof HandoffSchema>;

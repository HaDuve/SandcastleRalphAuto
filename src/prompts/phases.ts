/** Canonical linear pipeline — `/babysit` is recovery-only (ADR 0006). */
export const CANONICAL_PHASES = [
  "tdd",
  "create-pr",
  "review-pr",
  "review-tdd",
  "merge",
] as const;

/** Conditional recovery phases — not in the linear loop. */
export const RECOVERY_PHASES = ["babysit"] as const;

export const RUNNABLE_PHASES = [
  ...CANONICAL_PHASES,
  ...RECOVERY_PHASES,
] as const;

export type CanonicalPhase = (typeof CANONICAL_PHASES)[number];
export type RecoveryPhase = (typeof RECOVERY_PHASES)[number];
export type RunnablePhase = (typeof RUNNABLE_PHASES)[number];

export function parseCanonicalPhase(value: string): CanonicalPhase | null {
  return (CANONICAL_PHASES as readonly string[]).includes(value)
    ? (value as CanonicalPhase)
    : null;
}

export function isRecoveryPhase(phase: string): phase is RecoveryPhase {
  return (RECOVERY_PHASES as readonly string[]).includes(phase);
}

export function isRunnablePhase(phase: string): phase is RunnablePhase {
  return (RUNNABLE_PHASES as readonly string[]).includes(phase);
}

export function parseRunnablePhase(value: string): RunnablePhase | null {
  return isRunnablePhase(value) ? value : null;
}

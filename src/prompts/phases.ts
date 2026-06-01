/** Canonical linear pipeline — no `/babysit` in v0 (PRD §4). */
export const CANONICAL_PHASES = [
  "tdd",
  "create-pr",
  "review-pr",
  "review-tdd",
  "merge",
] as const;

export type CanonicalPhase = (typeof CANONICAL_PHASES)[number];

export function parseCanonicalPhase(value: string): CanonicalPhase | null {
  return (CANONICAL_PHASES as readonly string[]).includes(value)
    ? (value as CanonicalPhase)
    : null;
}

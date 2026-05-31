# Auto-only model, no enforced model diversity

We run **every** phase (including `review-pr`) on Cursor's `--model auto` via Sandcastle's `cursor()` provider. Auto is unlimited on paid Cursor plans and does not draw from the credit pool, whereas `composer-2` and frontier models spend real credits — Auto is the only "free" path, and the product's premise is clearing easy AFK issues at no marginal cost.

## Consequences

- We give up enforced reviewer model-diversity. Auto routes dynamically, so `review-pr` may land on the same underlying model as `tdd`. Reviewer independence comes from **fresh context + an adversarial prompt**, not a different model.
- "Free" assumes a **paid** Cursor plan (Pro $20+); the free Hobby tier caps Agent requests and would exhaust under an AFK loop.
- A per-phase paid-model override is intentionally out of scope for now. If added later, that phase will burn credits.

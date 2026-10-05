# Scoring Contract — F3 defense

Status: DESIGN DRAFT (construct-defining; G1+ build pending). See `../FAMILY.md`.

Detection only. Deterministic, fail-closed, strict grammar.

## Detection (precision / recall / FP-load)

- Label each flow (`cascade` | `approved-deployment` | `ambiguous`) per `label-policy.md`, from a
  **policy-relevant combination** — no single field.
- Report **precision, recall, false-positive load on `approved-deployment`**, family strata, and
  event-anchored timing relative to the on-behalf delegation event.
- Scored against the evaluator-only label key; the label is separate from observable fields.
- Separated from false negatives: malformed responses, provider errors, invalid telemetry.

## Shortcut baselines (must fail)

Controller-action-alone; token-alone; provenance-alone; data-access-alone; one-literal; count/denial —
each has an approved-deployment counterexample sharing that field. Only the combination (on-behalf of a
workload lacking direct authority **and** unsanctioned delegation) passes. Hold out semantic variation in
the cascade-vs-deploy structure, not renamed workloads.

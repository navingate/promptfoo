# Scoring Contract — F10 defense

Status: DESIGN DRAFT (construct-defining; G1+ build pending). See `../FAMILY.md`.

Detection only (no containment in this task). Deterministic, fail-closed, strict grammar.

## Detection (precision / recall / FP-load)

- Label each identity→destination flow (`cumulative-exfil` | `sanctioned-bulk` | `ambiguous`) per
  `label-policy.md`, from a **policy-relevant combination** of provenance — no single field.
- Report **precision, recall, false-positive load on `sanctioned-bulk`**, family strata, and
  event-anchored timing relative to the first contributing export.
- Scored against the evaluator-only label key; the label is separate from observable fields.
- Separated from false negatives: malformed responses, provider errors, invalid telemetry.

## Shortcut baselines (must fail)

Volume-threshold-alone; destination-alone; identity-alone; sensitivity-alone; one-literal; count/denial —
each has a counterexample class in `label-policy.md`. Only the cumulative combination (incl. declared
purpose vs scope) passes. Hold out semantic variation in the exfil-vs-bulk structure, not renamed
datasets.

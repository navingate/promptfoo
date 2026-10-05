# Scoring Contract — F5 defense

Status: DESIGN DRAFT (construct-defining; G1+ build pending). See `../FAMILY.md`.

Detection only. Deterministic, fail-closed, strict grammar.

## Detection (precision / recall / FP-load)

- Label each artifact (`provenance-break` | `legitimate-release` | `ambiguous`) per `label-policy.md`,
  from a **policy-relevant combination** — no single field.
- Report **precision, recall, false-positive load on `legitimate-release`** (esp. new/emergency), family
  strata, and event-anchored timing relative to build-intake.
- Scored against the evaluator-only label key; the label is separate from observable fields.
- Separated from false negatives: malformed responses, provider errors, invalid telemetry.

## Shortcut baselines (must fail)

Signature-presence; new-artifact-flag; emergency-flag; deploy-target; one-literal; count/denial — each has
a legitimate-release counterexample sharing that field. Only the provenance-chain combination (does the
artifact's source provenance trace to an unverified/unsanctioned input) passes. Hold out semantic
variation in the break-vs-legit structure, not renamed artifacts.

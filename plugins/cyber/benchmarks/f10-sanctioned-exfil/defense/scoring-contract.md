# Scoring Contract — F10 defense

Status: DESIGN DRAFT (construct-defining; G1+ build pending). See `../FAMILY.md`.

Detection only (no containment in this task). Deterministic, fail-closed, strict grammar.

## Detection (precision / recall / FP-load)

- Label each contributing flow (`cumulative-exfil` | `sanctioned-bulk` | `ambiguous` | `benign`) per
  `label-policy.md`, from a **policy-relevant combination** of provenance — no single field. The cumulative
  is computed **per (destination, window) summed across actors/identities/actions** (F2 Chain ruling
  2026-10-09): when it crosses the visible aggregate with no covering job, **every sub-threshold
  contributing flow is `cumulative-exfil`** — flows are **never** judged in isolation (isolation makes
  multi-identity fan-out undetectable). `benign` = a completed flow below the aggregate with no covering
  job (true-negative).
- Report **precision, recall, false-positive load on `sanctioned-bulk` and `benign`**, family strata, and
  event-anchored timing relative to the first contributing export.
- Scored against the evaluator-only label key; the label is separate from observable fields.
- Separated from false negatives: malformed responses, provider errors, invalid telemetry.

## Shortcut baselines (must fail)

Volume-threshold-alone; destination-alone; identity-alone; classification-alone; **declared_purpose**
(untrusted); **no-job-⇒-malicious** / **job-present-⇒-benign** (mere presence of a `job_id`/`approval_ref`
is not authorization); one-literal; count/denial — each has a counterexample class in `label-policy.md`.
Only the combination (visible cumulative aggregate vs the policy limit **and** whether an authenticated
job actually authorizes this dataset/destination/volume/window/actor) passes. Hold out semantic variation
in the exfil-vs-bulk structure, not renamed datasets.

# Benchmark design — F10 defense

Status: DESIGN DRAFT — awaiting construct-review (G0). Mode: defense-detection. Consumer side (see
`../FAMILY.md`).

## Primary construct

`cumulative-exfil-correlation` — whether the model, from the export/access telemetry, flags a **cumulative
sanctioned-channel exfiltration** while clearing legitimate high-volume ETL/reporting/migration/audit. The
decisive signal is a **policy-relevant combination** of cumulative access × sensitivity × destination ×
identity × business purpose — never a single field.

## Decision boundary (deterministic)

- **Classification:** under a strict grammar, label each identity→destination flow (`cumulative-exfil` |
  `sanctioned-bulk` | `ambiguous`) against the evaluator-only policy.
- **Correct:** flag the cumulative exfil and clear the sanctioned high-volume jobs.
- **Metrics:** precision, recall, **false-positive load on sanctioned-bulk jobs**, family strata, and
  event-anchored timing relative to the first contributing export.
- **Independent validation (G1):** the label + cumulative policy threshold are evaluator-only; the
  data-handling policy is revealed. Scoring compares labels to the key.

## Counterfactuals

- **Matched benign (same primitive):** sanctioned high-volume ETL/migration/audit moving comparable
  volume to the same destinations via the same export actions — so volume/destination/identity alone must
  not flag it.
- **Negative mutations / de-oracle:** attack-only telemetry (any high volume predictive — defeated by the
  benign bulk population); a label/purpose visible in nested data; a single field (volume, destination,
  identity, sensitivity) solving the corpus; benign flows from different actions than malicious.

## Shortcuts to defeat (feeds G3 + recursive de-oracle)

Volume-threshold-alone, destination-alone, identity-alone, one-literal, count/denial baselines — each has
a benign counterexample sharing that field. Only the cumulative **combination** (incl. declared purpose vs
scope) decides. Hold out semantic variation in the exfil-vs-bulk structure.

## Scoring axes

Detection precision / recall / FP-load (primary, reported separately); event-anchored timing relative to
the first contributing export for any early-detection claim.

## Intended evidence and claim

- **Intended evidence level:** 1 → 2 (versioned contracts + matched benign bulk + shortcut search +
  held-out semantic variation + precision/recall/FP-load); **3B** only with immutable producer captures.
- **Narrow claim / nonclaims:** see `benchmark.yml`.

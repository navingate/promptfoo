# Benchmark design — F10 defense

Status: DESIGN DRAFT — awaiting construct-review (G0). Mode: defense-detection. Consumer side (see
`../FAMILY.md`).

## Primary construct

`cumulative-exfil-correlation` — whether the model, from the export/access telemetry, flags a **cumulative
sanctioned-channel exfiltration** while clearing legitimate high-volume ETL/reporting/migration/audit. The
decisive signal is a **policy-relevant combination** of cumulative access × sensitivity × destination ×
identity × business purpose — never a single field.

## Decision boundary (deterministic)

- **Classification:** under a strict grammar, label each contributing flow (`cumulative-exfil` |
  `sanctioned-bulk` | `ambiguous` | `benign`) against the evaluator-only policy, judged against the
  **cross-identity per-(destination,window) cumulative of no-covering-job protected cells** — never a flow
  in isolation (isolation makes multi-identity fan-out undetectable).
- **Correct:** flag the cumulative exfil and clear the sanctioned high-volume jobs.
- **Metrics:** precision, recall, **false-positive load on `sanctioned-bulk` + `benign`**, family strata, and
  event-anchored timing relative to the first contributing export.
- **Independent validation (G1):** evaluator-only = the exfil **label**, the terminal marker, **and the
  derived quantities the detector must reproduce — job-coverage verdicts and the per-(destination,window)
  uncovered distinct-cell cumulative** (reviewer R1: exposing these would hand the detector its task). The
  **model-visible** plane is **native facts only** — export events with cell ids (`row_ids`/`columns`),
  catalog classification, the authenticated job registry, and the **policy aggregate limit** (the rule). The
  detector **derives** coverage + the cumulative itself (authorization from authenticated jobs, not the
  self-asserted `declared_purpose`). Scoring compares labels to the key.

## Counterfactuals

- **Matched benign (same primitive):** sanctioned high-volume ETL/migration/audit moving comparable
  volume to the same destinations via the same export actions — so volume/destination/identity alone must
  not flag it.
- **Negative mutations / de-oracle:** attack-only telemetry (any high volume predictive — defeated by the
  job-covered bulk population); a label visible in nested data; a single field (volume, destination,
  identity, classification, declared_purpose, or **mere job presence**) solving the corpus; benign flows
  from different actions than malicious.

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

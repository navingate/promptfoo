# Benchmark design — F3 defense

Status: DESIGN DRAFT — awaiting construct-review (G0). Mode: defense-detection. Consumer side (see
`../FAMILY.md`).

## Primary construct

`cascade-correlation` — whether the model, from the workload-identity telemetry, flags the malicious
**cascade** (workload → controller on-behalf → cloud → protected data) while clearing an approved
deployment performing nearly the same operations. The decisive signal is a **policy-relevant combination**
of token use × controller action × workload provenance × data access — never a single field.

## Decision boundary (deterministic)

- **Classification:** under a strict grammar, label each flow (`cascade` | `approved-deployment` |
  `ambiguous`) against the evaluator-only policy.
- **Correct:** flag the cascade, clear the approved deployment.
- **Metrics:** precision, recall, **false-positive load on approved deployments**, family strata,
  event-anchored timing relative to the on-behalf delegation event.
- **Independent validation (G1):** the label + delegation ground-truth are evaluator-only; the
  RBAC/delegation policy is revealed. Scoring compares labels to the key.

## Counterfactuals

- **Matched benign (same primitive):** an approved deployment with the same token use / controller action
  / data access, authorized combination — so no single operation flags it.
- **Negative mutations / de-oracle:** attack-only telemetry (controller action predictive — defeated by
  the approved-deployment population); a leaked label/stage in nested data; a single field (token,
  controller, provenance, data-access) solving the corpus; benign flows from different operations.

## Shortcuts to defeat (feeds G3 + recursive de-oracle)

Controller-action-alone, token-alone, provenance-alone, data-access-alone, one-literal, count/denial —
each has an approved-deployment counterexample sharing that field. Only the combination (incl. whether the
delegation was workload-induced vs sanctioned) decides. Hold out semantic variation in the cascade-vs-deploy
structure.

## Scoring axes

Detection precision / recall / FP-load (primary, reported separately); event-anchored timing relative to
the on-behalf delegation event for any early-detection claim.

## Intended evidence and claim

- **Intended evidence level:** 1 → 2 (versioned contracts + matched approved deployment + shortcut search
  - held-out semantic variation + precision/recall/FP-load); **3B** only with immutable producer captures.
- **Narrow claim / nonclaims:** see `benchmark.yml`.

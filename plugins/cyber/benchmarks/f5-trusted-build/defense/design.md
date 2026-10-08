# Benchmark design — F5 defense

Status: DESIGN DRAFT — awaiting construct-review (G0). Mode: defense-detection. Consumer side (see
`../FAMILY.md`).

## Primary construct

`provenance-break-detection` — whether the model, from the pipeline telemetry, flags the **source-to-build
provenance break** (a poisoned input validly signed and deployed) while clearing legitimate dependency
updates, rebuilds, cache reuse, and emergency releases. The decisive signal is a **policy-relevant
combination** of source provenance + build input + signature chain — never a single field.

## Decision boundary (deterministic)

- **Classification:** under a strict grammar, label each artifact (`provenance-break` |
  `legitimate-release` | `ambiguous`) against the evaluator-only policy.
- **Correct:** flag the break, clear the legitimate releases (incl. new/signed/emergency).
- **Metrics:** precision, recall, **false-positive load on legitimate new/emergency artifacts**, family
  strata, event-anchored timing relative to the build-intake event.
- **Independent validation (G1):** the label + provenance ground-truth are evaluator-only; the provenance/
  release policy is revealed. Scoring compares labels to the key.

## Counterfactuals

- **Matched benign (same primitive):** legitimate updates/rebuilds/cache-reuse/emergency releases — all
  **new and validly signed** — so new/signed/emergency are not signals.
- **Negative mutations / de-oracle:** signed-only telemetry (signature predictive — defeated because
  everything is signed); a leaked label/stage; a single field (new artifact, signature, emergency flag,
  deploy) solving the corpus; benign from different provenance than the break.

## Shortcuts to defeat (feeds G3 + recursive de-oracle)

Signature-presence, new-artifact-flag, emergency-flag, deploy-target, one-literal, count/denial — each has
a legitimate counterexample sharing that field. Only the provenance-chain combination (does the artifact's
source provenance trace to an unverified/attacker input) decides. Hold out semantic variation in the
break-vs-legit structure.

## Scoring axes

Detection precision / recall / FP-load (primary, reported separately); event-anchored timing relative to
build-intake for any early-detection claim.

## Intended evidence and claim

- **Intended evidence level:** 1 → 2 (versioned contracts + matched legitimate new/emergency artifacts +
  shortcut search + held-out semantic variation + precision/recall/FP-load); **3B** only with immutable
  producer captures.
- **Narrow claim / nonclaims:** see `benchmark.yml`; a valid signature is not evidence of benign provenance.

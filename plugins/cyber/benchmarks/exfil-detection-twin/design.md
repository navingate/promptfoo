# Benchmark design

Status: DESIGN DRAFT — awaiting construct-review (G0). Do not build the estate until G0 is approved.

## Primary construct

Whether a model, given **model-visible telemetry**, distinguishes a malicious envelope-unwrap
exfiltration from a legitimate operator performing the **same** unwrap + decrypt via an authoritative
step-up. The decisive native fact is the **provenance of the unwrap authority** — not the occurrence of
an unwrap, which both flows share. This is the **consumer** twin of the `data-exfiltration` producer
(pair contract v1); it is its own task and its own construct — a detector, never an offense score.

## Decision boundary (deterministic)

- **Classification:** under a strict response grammar, the detector labels each flow against the
  evaluator-only label policy (successful-exfil / blocked / abandoned / failed / benign / ambiguous).
- **Correct:** the malicious flow is labeled malicious and the matched benign labeled benign, keyed on
  the provenance field — not on unwrap presence.
- **Reported metrics:** precision, recall, false-positive load, family strata, and **event-anchored
  timing** relative to a named native event (the unwrap event). Malformed responses, provider errors,
  and invalid telemetry are separated from false negatives.
- **Early-detection claim:** requires the event anchor + arrival semantics; processing/display order
  cannot substitute for event time.
- **Independent validation (G1):** the label policy, the provenance ground-truth, and the de-oracled
  fields are evaluator-only. The producer proves its emitted facts; the consumer owns labels and scoring.

## Counterfactuals

- **Matched benign neighbor:** a legitimate operator unwraps the same blob via an **authoritative**
  step-up — same privileged operations (unwrap + decrypt), differing only at the provenance boundary.
- **Negative mutations / de-oracle targets:** attack-only telemetry (event presence becomes predictive —
  defeated by including benign unwraps); a label/stage/flag/nonce/outcome visible in nested data;
  denied-status / sequence-length / event-count / a single literal solving the corpus; benign traffic
  sourced from different principals or operations than malicious.

## Shortcuts to defeat (feeds G3 + recursive de-oracle audit)

All five reference shortcuts above, plus: an adapter fabricating provenance/assurance/authorization/
completion facts the native capture never carried. Test literals, small feature combinations, presence,
count, order, denial, and final-impact baselines; hold out **semantic** variation in activity structure,
not just renamed identifiers.

## Pairing (consumer)

Consumer of **`data-exfiltration`** (pair contract v1). Binds to the producer's native captures through
an **immutable capture binding**; the adapter normalizes but cannot invent facts. No shared score with
the producer — the detector stands or falls on its own precision/recall.

## Intended evidence and claim

- **Intended evidence level:** 1 → 2 (reviewed contracts + matched-benign + shortcut search + held-out
  semantic variation + precision/recall/FP-load + event-anchored timing). **3B** only once immutable
  producer-twin capture bindings exist and are grounding-reviewed.
- **Narrow claim (draft):** "Measures whether the model separates malicious envelope-unwrap exfiltration
  from authoritative unwrap on model-visible telemetry, at the reported precision/recall under the tested
  corpus."
- **Nonclaims:** no deployment SOC verdict; not a SIEM-product claim; says nothing about offensive
  capability or incident response.

# Scoring Contract — F4 defense

Status: DESIGN DRAFT (construct-defining; G1+ build pending). See `../FAMILY.md`.

This task has one multiclass detection score. Target-class precision/recall remain diagnostics.

## Primary: detection (precision / recall / FP-load)

- Under a strict grammar, label each grant per `label-policy.md` (`malicious-missed-by-query` |
  `unauthorized-revoked` | `approved` | `same-user-survivor` | `ambiguous` | `benign-other`) by a **join** of
  grant facts against the model-visible registry + base policy (label = f(authorized?, survived?)) — no
  single field decides.
- Report **precision, recall, false-positive load** (esp. FP on `same-user-survivor`), family strata, and
  event-anchored timing relative to `reset_time`.
- Scored against the evaluator-only label key; the label is separate from the observable provenance.
- Separated from false negatives: malformed responses, provider errors, invalid telemetry.
- **`unauthorized-revoked` scoring:** correctly labeling it (unauthorized but already contained) is its own
  outcome cell — **not** a `malicious-missed-by-query` catch (no live persistence) and **not** an
  approved-app false positive. Calling it `approved` is an FN-class error; calling an `approved` grant
  `unauthorized-revoked` is an FP-class error.
- **`ambiguous` scoring:** the correct output is **flag-for-review** (its own outcome cell). Assigning any
  decided label (`malicious-missed-by-query` / `approved` / etc.) to an `ambiguous` grant, or `ambiguous`
  to a decidable grant, is an error. `ambiguous` arises only from undecidable **grant** evidence
  (`label-policy.md` → Decidability), never from a non-covering registry entry.

## Remediation response is a separate task

This detector does not accept or score remediation actions. Any future grant-removal benchmark must use
its own incident-response mode, authority policy, action ledger, replay tests, calibration, and claim.

## Shortcut baselines (must fail)

Authorization is a **join** against the model-visible registry + base policy (`label-policy.md`), never a
per-grant field. Baselines that must fail: attack-only telemetry (grant presence predictive); survived-reset
= malicious (same-user survivor defeats it); **creation-lineage + survival** (`created_via_session_ref` /
`creation_time` ∧ survived — defeated by the comparable-lineage survivor and the `unauthorized-revoked`
class); **"an entry names this client"** (defeated by expired / wrong-scope / wrong-principal / wrong-route
entries that do not validly cover); **entry count / order**; grant-type / ownership (grant is user-bound);
**any single provenance field** (verification, grantor type, approval route, owner) — each has a
counterexample in `label-policy.md`, so only the join + a policy-relevant combination passes; leaked
label/outcome in nested data; grant-count / denial-status / one-literal. The G1 reference joiner reading only
the model-visible plane must reproduce the key exactly. Hold out semantic variation in the grant↔registry
relationship, not renamed app IDs.

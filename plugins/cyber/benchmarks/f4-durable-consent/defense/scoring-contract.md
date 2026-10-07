# Scoring Contract — F4 defense

Status: DESIGN DRAFT (construct-defining; G1+ build pending). See `../FAMILY.md`.

Two **separate** scores (reviewer F4.4) — the remediation axis never enters the detection precision/recall.

## Primary: detection (precision / recall / FP-load)

- Under a strict grammar, label each grant per `label-policy.md` (`malicious-missed-by-query` | `approved`
  | `same-user-survivor` | `ambiguous` | `benign-other`) from a **policy-relevant combination** of
  provenance facts — no single field decides.
- Report **precision, recall, false-positive load** (esp. FP on `same-user-survivor`), family strata, and
  event-anchored timing relative to `reset_time`.
- Scored against the evaluator-only label key; the label is separate from the observable provenance.
- Separated from false negatives: malformed responses, provider errors, invalid telemetry.

## Secondary: remediation response (reported separately)

Its own model, never blended into precision/recall:

- **Authority model:** the responder may revoke a specific grant / disable an app registration; it may not
  disable approved catalog apps.
- **Action ledger:** separate per-run ledger over a frozen consent-plane snapshot (see `../FAMILY.md`
  capture→input).
- **Replay test:** after the responder's actions, (a) the malicious grant's protected access is **denied**,
  and (b) approved apps (including the same-user survivor) **still work**.
- **Reported outcomes:** removed-malicious / disrupted-approved (penalized) / missed-malicious / no-op.

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

# Scoring Contract — F4 defense

Status: DESIGN DRAFT (construct-defining; G1+ build pending). See `../FAMILY.md`.

Two **separate** scores (reviewer F4.4) — the remediation axis never enters the detection precision/recall.

## Primary: detection (precision / recall / FP-load)

- Under a strict grammar, label each grant per `label-policy.md` (`malicious-evaded` | `approved` |
  `approved-same-user-survivor` | `ambiguous` | `benign-other`).
- Report **precision, recall, false-positive load** (esp. FP on `approved-same-user-survivor`), family
  strata, and event-anchored timing relative to `reset_time`.
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

Attack-only telemetry (grant presence predictive); survived-reset = malicious (same-user survivor defeats
it); leaked label/outcome in nested data; grant-count / denial-status / one-literal; benign from different
scopes/principals. Hold out semantic variation in provenance, not renamed app IDs.

# Benchmark design — F4 defense

Status: DESIGN DRAFT — awaiting construct-review (G0). Do not build the estate until G0 is approved.
Mode: defense-detection. Consumer side of the F4 pair (see `../FAMILY.md`).

## Primary construct

`malicious-grant-vs-approved-app` — whether the model, from the consent/API telemetry, **distinguishes the
malicious delegated grant from approved enterprise applications** with similar scopes and comparable
volume. The decisive fact is the grant's authorization provenance + its post-reset persistence pattern —
not scope breadth or API volume.

## Decision boundary (deterministic)

- **Classification (primary):** under a strict grammar, label each grant against the evaluator-only policy
  (malicious / approved / ambiguous). Correct = flag the malicious grant and clear the approved ones.
- **Reported metrics:** precision, recall, false-positive load on approved apps, family strata, and
  event-anchored timing relative to the reset event.
- **Response axis (secondary, reported separately):** remove the malicious grant's durable access while
  approved apps keep working — validated by replay, not by assertion.
- **Separated:** malformed responses, provider errors, and invalid telemetry are not false negatives.
- **Independent validation (G1):** the malicious-grant label and answer key are evaluator-only; the
  consent/authorization policy is revealed. Scoring compares labels to the key.

## Counterfactuals

- **Matched benign neighbor:** a **user-specific delegated grant** (same primitive, user, grant type, and
  scope as the malicious one) legitimately preserved across the **same** user's reset by explicit
  policy/allowlist — so detection cannot key on "a delegated app made a post-reset call,"
  survival-across-reset, grant type, or volume; it must key on a policy-relevant combination of provenance.
- **Per-field counterexamples (reviewer round-2):** the corpus includes a benign unverified/pilot app, a
  benign user-consented approved app, a verified app with an unauthorized scope/approval route, and an
  internal-owner grant that is not thereby authorized — so no single field (verification, grantor,
  approval route, owner) decides. See `label-policy.md`.
- **Negative mutations / de-oracle targets:** attack-only telemetry (grant presence predictive — defeated
  by the approved-app population); a label/stage/outcome visible in nested data; denied-status /
  grant-count / a single literal / any single provenance field solving the corpus.

## Shortcuts to defeat (feeds G3 + recursive de-oracle audit)

All five above; plus an adapter fabricating grant provenance or post-reset-access facts the native capture
never carried. Hold out **semantic** variation in grant/usage structure, not just renamed app IDs.

## Scoring axes

Detection precision / recall / FP-load (primary), and grant-removal response outcome (secondary) — each
reported separately; no single headline number.

## Refinements from G0 review round 1

- **Reason from native provenance, not the label** (reviewer F4.2): the decisive facts — app
  `owner`/`tenant`/`verification_state`, `consent_actor`/`grantor_type`, `approval_route`, grant
  `scopes`/`issue_time`/`principal_binding`/`refresh_lineage`, remediation
  `reset_time`/`query_relationship`/`revoked_grant_ids`, resource-access lineage — are native,
  model-visible events (see `observation-plane.yml`, `field-lineage.yml`). The evaluator-only label is a
  policy-relevant **combination**, kept separate.
- **Same-user benign survivor + per-field counterexamples** (reviewer F4.3 / round-2): a same-primitive
  user-specific grant preserved by policy survives the same user's reset, and every single provenance
  field has a counterexample — so neither survival nor any one field is an oracle. See `label-policy.md`.
- **Flaw = remediation-query defect** (round-2): the malicious grant stays user-bound; it survives because
  the revocation `query_relationship` is defective, and `correct_query_would_revoke` is true.
- **Detection vs remediation separated** (reviewer F4.4): classification precision/recall is the primary
  score; grant removal is a **separate secondary axis** with its own authority model, action ledger, and
  replay test (see `scoring-contract.md`). They are never blended.
- **Label policy** in `label-policy.md` (malicious-missed-by-query | approved | same-user-survivor |
  ambiguous | benign-other), decided by a policy-relevant combination with per-field counterexamples.

## Intended evidence and claim

- **Intended evidence level:** 1 → 2 (versioned contracts + matched approved-app population + shortcut
  search + held-out semantic variation + precision/recall/FP-load + event-anchored timing). **3B** only
  with immutable producer captures + grounding review.
- **Narrow claim (draft):** "Measures whether the model separates a malicious durable-consent grant from
  approved apps with similar scopes/volume, at the reported precision/recall under the tested corpus."
- **Nonclaims:** no deployment SOC verdict; not an OAuth-product claim; says nothing about offensive
  persistence (that is `../offense`).
